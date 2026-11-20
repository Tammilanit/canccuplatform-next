/**
 * The group order's lifecycle (contracts/pizza.md, Lifecycle): open → closed → placed → arrived →
 * done, cancel, reopen and undo, claim, take-over and release. Each step is one conditional UPDATE
 * in the caller's transaction (E1): of two racing requests one changes the row and the other finds
 * it moved on, and is told why or, for a step already taken, gets the order back without a second
 * event (E2). Events go through the outbox in the same transaction (E12).
 */
import { KitError } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { Conflict, cannot, guarded, uniqueConflict } from "./conflicts.js";
import { emitOrder, personOf } from "./events.js";
import type { Emitter } from "./events.js";
import { UNPLACED } from "./model.js";
import type { DoneReason, OrderState } from "./model.js";
import { ORDER_COLUMNS, getOrder, itemsOf, logStep } from "./store.js";
import type { Actor, OrderRow } from "./store.js";

export interface Step {
  c: SqlClient;
  e: Emitter;
  now: Date;
  /** null: the module itself (the scheduler, an archive). */
  actor: Actor | null;
}

export interface Moved {
  row: OrderRow;
  /** False when the step had already been taken: no event was sent. */
  changed: boolean;
  was: { state: OrderState; holder_user_id: string | null; holder_name: string | null };
}

/**
 * The conditional UPDATE: changes the order only while its state is one of `from`; `$1` is the id,
 * `$2` the states, `set` uses `$3…`. Answers the row with what it was, or null when it moved on.
 */
async function update(
  c: SqlClient,
  id: string,
  from: readonly OrderState[],
  set: string,
  values: unknown[] = [],
  extraWhere = "",
): Promise<Moved | null> {
  const { rows } = await c.query(
    `UPDATE pizza_orders SET ${set}, revision = revision + 1
     FROM (SELECT id AS old_id, state AS was_state, holder_user_id AS was_holder, holder_name AS was_holder_name
           FROM pizza_orders WHERE id = $1 FOR UPDATE) old
     WHERE id = old.old_id AND state = ANY($2::text[]) ${extraWhere}
     RETURNING ${ORDER_COLUMNS}, old.was_state, old.was_holder, old.was_holder_name`,
    [id, from, ...values],
  );
  const r = rows[0] as
    | (OrderRow & {
        was_state: OrderState;
        was_holder: string | null;
        was_holder_name: string | null;
      })
    | undefined;
  if (r === undefined) return null;
  const { was_state, was_holder, was_holder_name, ...row } = r;
  return {
    row,
    changed: true,
    was: { state: was_state, holder_user_id: was_holder, holder_name: was_holder_name },
  };
}

async function current(c: SqlClient, id: string): Promise<OrderRow> {
  const o = await getOrder(c, id);
  if (o === null) throw new KitError("No such order.", { status: 404, code: "not_found" });
  return o;
}

const unchanged = (row: OrderRow): Moved => ({
  row,
  changed: false,
  was: { state: row.state, holder_user_id: row.holder_user_id, holder_name: row.holder_name },
});

const actorId = (s: Step) => s.actor?.user_id ?? null;

/** A step to one state: a no-op when the order is already there, a 409 when it cannot get there. */
async function simple(
  s: Step,
  id: string,
  step: string,
  from: readonly OrderState[],
  to: OrderState,
  set: string,
  values: unknown[],
): Promise<Moved> {
  const moved = await update(s.c, id, from, `state = '${to}', ${set}`, values);
  if (moved !== null) return moved;
  const o = await current(s.c, id);
  if (o.state === to) return unchanged(o);
  throw cannot(step, o);
}

export async function close(s: Step, id: string): Promise<Moved> {
  const m = await simple(s, id, "close", ["open"], "closed", "closed_at = $3", [s.now]);
  if (m.changed) {
    await logStep(s.c, id, s.now, s.actor, "closed");
    await emitOrder(s.c, s.e, "pizza.order.closed", m.row, { actor_user_id: actorId(s) });
  }
  return m;
}

export async function reopen(s: Step, id: string): Promise<Moved> {
  const m = await simple(s, id, "reopen", ["closed"], "open", "closed_at = NULL", []);
  if (m.changed) {
    await logStep(s.c, id, s.now, s.actor, "reopened");
    await emitOrder(s.c, s.e, "pizza.order.reopened", m.row, { actor_user_id: actorId(s) });
  }
  return m;
}

/** Called in (U8, U13): the estimate if given, and the payer, who is always set. */
export async function place(
  s: Step,
  id: string,
  input: { placed_at: Date; estimate_at: Date | null; payer: Actor },
): Promise<Moved> {
  const m = await simple(
    s,
    id,
    "place",
    UNPLACED,
    "placed",
    "closed_at = COALESCE(closed_at, $3), placed_at = $4, estimate_at = $5, payer_user_id = $6, payer_name = $7",
    [s.now, input.placed_at, input.estimate_at, input.payer.user_id, input.payer.name],
  );
  if (m.changed) {
    // Called in straight from open: the screens and Notify still hear that it closed.
    if (m.was.state === "open")
      await emitOrder(s.c, s.e, "pizza.order.closed", m.row, { actor_user_id: actorId(s) });
    await logStep(s.c, id, s.now, s.actor, "placed", {
      estimate_at: input.estimate_at,
      payer_user_id: input.payer.user_id,
    });
    await emitOrder(s.c, s.e, "pizza.order.placed", m.row, { actor_user_id: actorId(s) });
  }
  return m;
}

export async function arrive(s: Step, id: string, pickup: string | null): Promise<Moved> {
  const m = await simple(
    s,
    id,
    "arrive",
    ["placed"],
    "arrived",
    "arrived_at = $3, pickup = COALESCE($4, pickup)",
    [s.now, pickup],
  );
  if (m.changed) {
    await logStep(s.c, id, s.now, s.actor, "arrived", { pickup });
    await emitOrder(s.c, s.e, "pizza.order.arrived", m.row, { actor_user_id: actorId(s) }, true);
  }
  return m;
}

export async function done(s: Step, id: string, reason: DoneReason): Promise<Moved> {
  // The timer takes a called-in order straight to done, without "it's here" (the forgotten orders).
  const from: OrderState[] = reason === "timer" ? ["placed", "arrived"] : ["arrived"];
  const m = await simple(s, id, "done", from, "done", "done_at = $3, done_reason = $4", [
    s.now,
    reason,
  ]);
  if (m.changed) {
    await logStep(s.c, id, s.now, s.actor, "done", { reason });
    await emitOrder(s.c, s.e, "pizza.order.done", m.row, { reason, actor_user_id: actorId(s) });
  }
  return m;
}

/** arrived → placed, or placed → closed (which clears the call-in and its payer, keeping the total). */
export async function undo(s: Step, id: string): Promise<Moved> {
  const m = await guarded(
    s.c,
    () =>
      update(
        s.c,
        id,
        ["placed", "arrived"],
        `state = CASE WHEN state = 'arrived' THEN 'placed' ELSE 'closed' END,
         arrived_at = NULL,
         placed_at = CASE WHEN state = 'arrived' THEN placed_at END,
         estimate_at = CASE WHEN state = 'arrived' THEN estimate_at END,
         payer_user_id = CASE WHEN state = 'arrived' THEN payer_user_id END,
         payer_name = CASE WHEN state = 'arrived' THEN payer_name END`,
      ),
    uniqueConflict,
  );
  if (m === null) throw cannot("undo", await current(s.c, id));
  await logStep(s.c, id, s.now, s.actor, "reverted", { from_state: m.was.state });
  await emitOrder(s.c, s.e, "pizza.order.reverted", m.row, {
    from_state: m.was.state,
    actor_user_id: actorId(s),
  });
  return m;
}

/**
 * Cancelled, with the person's words in `reason`; `kind` `stale` for an order from an earlier day
 * (E10). Everyone in it is told (D12). The crew may cancel one that was called in.
 */
export async function cancel(
  s: Step,
  id: string,
  from: readonly OrderState[],
  kind: "cancelled" | "stale",
  reason: string | null,
): Promise<Moved> {
  const m = await simple(
    s,
    id,
    "cancel",
    from,
    "cancelled",
    "cancelled_at = $3, cancel_reason = $4, cancelled_by_user_id = $5",
    [s.now, reason, actorId(s)],
  );
  if (m.changed) {
    await logStep(s.c, id, s.now, s.actor, "cancelled", { kind, reason });
    await emitOrder(
      s.c,
      s.e,
      "pizza.order.cancelled",
      m.row,
      { reason: kind, actor_user_id: actorId(s) },
      true,
    );
  }
  return m;
}

/** A member takes an order nobody holds; the holder's own claim is a no-op. */
export async function claim(s: Step, id: string, actor: Actor): Promise<Moved> {
  const m = await guarded(
    s.c,
    () =>
      update(
        s.c,
        id,
        UNPLACED,
        "holder_user_id = $3, holder_name = $4, claimed_at = $5",
        [actor.user_id, actor.name, s.now],
        "AND holder_user_id IS NULL",
      ),
    uniqueConflict,
  );
  if (m === null) {
    const o = await current(s.c, id);
    if (o.holder_user_id === actor.user_id) return unchanged(o);
    if (!UNPLACED.includes(o.state)) throw cannot("claim", o);
    throw new Conflict("claimed", `${o.holder_name ?? "Someone"} holds this order.`, {
      holder: o.holder_name,
      since: o.claimed_at?.toISOString() ?? null,
    });
  }
  await logStep(s.c, id, s.now, s.actor, "claimed");
  await emitOrder(s.c, s.e, "pizza.order.claimed", m.row, {
    previous_holder: null,
    actor_user_id: actor.user_id,
  });
  return m;
}

/** The crew takes an order over, held or not (D5). */
export async function takeOver(s: Step, id: string, actor: Actor): Promise<Moved> {
  const m = await guarded(
    s.c,
    () =>
      update(
        s.c,
        id,
        UNPLACED,
        "holder_user_id = $3, holder_name = $4, claimed_at = $5",
        [actor.user_id, actor.name, s.now],
        "AND holder_user_id IS DISTINCT FROM $3",
      ),
    uniqueConflict,
  );
  if (m === null) {
    const o = await current(s.c, id);
    if (o.holder_user_id === actor.user_id) return unchanged(o);
    throw cannot("take_over", o);
  }
  await logStep(s.c, id, s.now, s.actor, "taken_over", {
    previous_holder_user_id: m.was.holder_user_id,
  });
  await emitOrder(s.c, s.e, "pizza.order.claimed", m.row, {
    previous_holder: await personOf(s.e.people, m.was.holder_user_id, m.was.holder_name),
    actor_user_id: actor.user_id,
  });
  return m;
}

/** The holder lets go (`released`), the crew makes them (`forced`), or the timer does (`timeout`). */
export async function release(
  s: Step,
  id: string,
  reason: "released" | "forced" | "timeout",
  opts: { quiet?: boolean } = {},
): Promise<Moved> {
  const m = await update(
    s.c,
    id,
    UNPLACED,
    `holder_user_id = NULL, holder_name = NULL, claimed_at = NULL, auto_released = auto_released OR $3`,
    [reason === "timeout"],
    "AND holder_user_id IS NOT NULL",
  );
  if (m === null) {
    const o = await current(s.c, id);
    if (o.holder_user_id === null && UNPLACED.includes(o.state)) return unchanged(o);
    throw cannot("release", o);
  }
  await logStep(s.c, id, s.now, s.actor, "released", {
    reason,
    previous_holder_user_id: m.was.holder_user_id,
  });
  await emitOrder(s.c, s.e, "pizza.order.released", m.row, {
    // Quiet: they asked to be forgotten, so the event no longer names them.
    previous_holder:
      opts.quiet === true
        ? null
        : await personOf(s.e.people, m.was.holder_user_id, m.was.holder_name),
    reason,
    actor_user_id: actorId(s),
  });
  return m;
}

/**
 * The module's own steps, actor null, for #118's scheduler: `close` at the close time (an empty
 * order is cancelled instead, E9), `release` after 2 h (the legacy rule), `done` by the timer and
 * `cancel` for a forgotten order never called in. True when the order changed.
 */
export async function scheduled(
  c: SqlClient,
  e: Emitter,
  id: string,
  kind: "close" | "release" | "done" | "cancel",
  now: Date,
): Promise<boolean> {
  const s: Step = { c, e, now, actor: null };
  const o = await getOrder(c, id);
  if (o === null) return false;
  try {
    if (kind === "close") {
      if (o.state !== "open") return false;
      const empty = (await itemsOf(c, [id])).length === 0;
      return (empty ? await cancel(s, id, ["open"], "cancelled", null) : await close(s, id))
        .changed;
    }
    if (kind === "release") return (await release(s, id, "timeout")).changed;
    if (kind === "done") return (await done(s, id, "timer")).changed;
    return (await cancel(s, id, UNPLACED, "cancelled", null)).changed;
  } catch (err) {
    if (err instanceof Conflict) return false;
    throw err;
  }
}
