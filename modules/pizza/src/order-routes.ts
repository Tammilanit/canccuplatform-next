/** The orders API (contracts/pizza.md, Orders): reading, opening and every step of the lifecycle. */
import type { FastifyInstance } from "fastify";
import { KitError } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { emitOrder } from "./events.js";
import { body, guestRead, ok, tenantOf, today, whoIs, write } from "./http.js";
import type { AppDeps, WriteCtx } from "./http.js";
import { openOrder } from "./items.js";
import { Conflict, cannot, guarded, uniqueConflict } from "./conflicts.js";
import * as life from "./lifecycle.js";
import type { Moved } from "./lifecycle.js";
import { CALLED_IN, UNPLACED } from "./model.js";
import { NO_FACTS, authorize } from "./policy.js";
import type { Action, As } from "./policy.js";
import { facts, orderFor, present } from "./present.js";
import { getPizzeria, itemsOf, logStep, ordersWhere } from "./store.js";
import type { OrderRow } from "./store.js";
import { buildSummary } from "./summary.js";
import { DAY } from "./time.js";
import { InvalidBody, LIMITS, bad, optionalText, parseTime } from "./validate.js";

type Params = { id: string };
type Body = Record<string, unknown>;

/** A crew override, audited with before and after (D16). */
export async function auditCrew(
  deps: AppDeps,
  w: WriteCtx,
  as: As,
  action: string,
  m: Moved,
  reason: string | null,
): Promise<void> {
  if (as !== "crew" || !m.changed) return;
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  if (m.was.state !== m.row.state) changes.state = { old: m.was.state, new: m.row.state };
  if (m.was.holder_user_id !== m.row.holder_user_id)
    changes.holder = { old: m.was.holder_user_id, new: m.row.holder_user_id };
  await deps.audit({
    tenant_id: w.ctx.tenant_id,
    actor_user_id: w.caller.user_id,
    action,
    target: { type: "order", id: m.row.id },
    changes,
    ...(reason === null ? {} : { reason }),
  });
}

/** The people who may be the payer: someone with a pizza in the order, or who opened or holds it. */
async function payerOf(
  c: SqlClient,
  o: OrderRow,
  userId: unknown,
): Promise<{ user_id: string; name: string }> {
  const items = await itemsOf(c, [o.id]);
  const known = new Map<string, string>();
  for (const i of items) if (i.user_id !== null && i.name !== null) known.set(i.user_id, i.name);
  if (o.holder_user_id !== null && o.holder_name !== null)
    known.set(o.holder_user_id, o.holder_name);
  const name = typeof userId === "string" ? known.get(userId) : undefined;
  if (name === undefined) return bad("payer_user_id", "must be someone in the order or its holder");
  return { user_id: userId as string, name };
}

interface StepDef {
  action: Action;
  audit: string;
  run: (c: SqlClient, w: WriteCtx, o: OrderRow, as: As, b: Body) => Promise<Moved>;
}

const STEPS: Record<string, StepDef> = {
  claim: {
    action: "order.claim",
    audit: "pizza.order.claimed",
    run: (c, w, o) =>
      life.claim(w.step(c), o.id, { user_id: w.session.userId, name: w.session.userName }),
  },
  "take-over": {
    action: "order.take_over",
    audit: "pizza.order.taken_over",
    run: (c, w, o) =>
      life.takeOver(w.step(c), o.id, { user_id: w.session.userId, name: w.session.userName }),
  },
  release: {
    action: "order.release",
    audit: "pizza.order.released",
    run: (c, w, o, as) => life.release(w.step(c), o.id, as === "crew" ? "forced" : "released"),
  },
  close: {
    action: "order.close",
    audit: "pizza.order.closed",
    run: (c, w, o) => life.close(w.step(c), o.id),
  },
  reopen: {
    action: "order.reopen",
    audit: "pizza.order.reopened",
    run: (c, w, o) => life.reopen(w.step(c), o.id),
  },
  place: {
    action: "order.place",
    audit: "pizza.order.placed",
    run: async (c, w, o, _as, b) => {
      const placedAt = b.at === undefined ? w.now : parseTime(b.at, "at");
      let estimate: Date | null = null;
      if (b.estimate_at !== undefined && b.estimate_at !== null)
        estimate = parseTime(b.estimate_at, "estimate_at");
      else if (b.estimate_minutes !== undefined && b.estimate_minutes !== null) {
        const m = b.estimate_minutes;
        if (typeof m !== "number" || !Number.isInteger(m) || m < 0 || m > 240)
          bad("estimate_minutes", "0 to 240");
        estimate = new Date(placedAt.getTime() + (m as number) * 60_000);
      }
      // U13: the holder by default, else whoever calls it in; always set.
      const payer =
        b.payer_user_id !== undefined
          ? await payerOf(c, o, b.payer_user_id)
          : o.holder_user_id !== null && o.holder_name !== null
            ? { user_id: o.holder_user_id, name: o.holder_name }
            : { user_id: w.session.userId, name: w.session.userName };
      return life.place(w.step(c), o.id, { placed_at: placedAt, estimate_at: estimate, payer });
    },
  },
  arrive: {
    action: "order.arrive",
    audit: "pizza.order.arrived",
    run: (c, w, o, _as, b) =>
      life.arrive(w.step(c), o.id, optionalText(b.pickup, "pickup", LIMITS.pickup)),
  },
  done: {
    action: "order.done",
    audit: "pizza.order.done",
    run: (c, w, o) => life.done(w.step(c), o.id, "holder"),
  },
  undo: {
    action: "order.undo",
    audit: "pizza.order.reverted",
    run: (c, w, o) => life.undo(w.step(c), o.id),
  },
  cancel: {
    action: "order.cancel",
    audit: "pizza.order.cancelled",
    run: (c, w, o, as, b) => {
      const reason = optionalText(b.reason, "reason", LIMITS.reason);
      const stale = facts(w.ctx, w.now, o).stale;
      // The crew may cancel an order that was called in; the holder only before (the legacy rule).
      const from = as === "crew" ? ([...UNPLACED, "placed", "arrived"] as const) : UNPLACED;
      return life.cancel(w.step(c), o.id, from, stale ? "stale" : "cancelled", reason);
    },
  },
};

export function orderRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Querystring: { day?: string } }>("/api/pizza/orders", async (request) => {
    const ctx = tenantOf(request);
    const { caller } = await whoIs(deps, request);
    guestRead(request, caller);
    const now = deps.now();
    const day = request.query.day;
    if (day !== undefined && !DAY.test(day)) throw new InvalidBody("day", "YYYY-MM-DD");
    return deps.db.tenant(async (c) => {
      // By default: what is not over yet, and today's.
      const orders =
        day === undefined
          ? await ordersWhere(c, `state = ANY($1::text[]) OR day = $2::date`, [
              [...UNPLACED, "placed", "arrived"],
              today(ctx, now),
            ])
          : await ordersWhere(c, `day = $1::date`, [day]);
      const views = [];
      for (const o of orders) views.push(await present(c, caller, ctx, now, o));
      return { day: day ?? today(ctx, now), orders: views };
    });
  });

  app.get<{ Params: Params }>("/api/pizza/orders/:id", async (request) => {
    const ctx = tenantOf(request);
    const { caller } = await whoIs(deps, request);
    guestRead(request, caller);
    return deps.db.tenant(async (c) => {
      const [o] = await ordersWhere(c, `id = $1`, [request.params.id]);
      if (o === undefined) throw new KitError("No such order.", { status: 404, code: "not_found" });
      return present(c, caller, ctx, deps.now(), o);
    });
  });

  for (const path of ["summary", "history"] as const) {
    app.get<{ Params: Params }>(`/api/pizza/orders/:id/${path}`, async (request) => {
      const ctx = tenantOf(request);
      const { caller } = await whoIs(deps, request);
      return deps.db.tenant(async (c) => {
        const now = deps.now();
        const { order } = await orderFor(
          c,
          request.params.id,
          path === "summary" ? "order.summary" : "order.history",
          caller,
          ctx,
          now,
        );
        if (path === "summary") {
          const items = await itemsOf(c, [order.id]);
          return buildSummary(
            { day: order.day, seq: order.seq, pizzeria: order.pizzeria_name },
            items.map((i) => ({ ...i, name: i.name ?? "—" })),
          );
        }
        const { rows } = await c.query(
          `SELECT at, actor_user_id, actor_name, kind, detail FROM pizza_order_log WHERE order_id = $1 ORDER BY id`,
          [order.id],
        );
        return {
          entries: (
            rows as {
              at: Date;
              actor_user_id: string | null;
              actor_name: string | null;
              kind: string;
              detail: unknown;
            }[]
          ).map((r) => ({
            at: r.at.toISOString(),
            actor:
              r.actor_user_id === null ? null : { user_id: r.actor_user_id, name: r.actor_name },
            kind: r.kind,
            detail: r.detail,
          })),
        };
      });
    });
  }

  app.post("/api/pizza/orders", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      const b = body(request);
      const settings = await deps.settings(w.ctx.tenant_id);
      authorize("order.open", w.caller, { ...NO_FACTS, crew_only: settings.open_by === "crew" });
      if (!settings.ordering_open) {
        throw new KitError("Ordering is off at this event for now.", {
          status: 403,
          code: "ordering_closed",
        });
      }
      const pz = typeof b.pizzeria_id === "string" ? await getPizzeria(c, b.pizzeria_id) : null;
      if (pz === null || pz.hidden_at !== null) return bad("pizzeria_id", "unknown pizzeria");
      const closesAt = parseTime(b.closes_at, "closes_at");
      if (closesAt.getTime() <= w.now.getTime()) bad("closes_at", "must be in the future");
      const o = await openOrder(
        w.step(c),
        { user_id: w.session.userId, name: w.session.userName },
        {
          pizzeria: { id: pz.id, name: pz.name },
          closes_at: closesAt,
          note: optionalText(b.note, "note", LIMITS.orderNote),
          day: today(w.ctx, w.now),
          max_open: settings.max_open_orders,
        },
      );
      return ok(await present(c, w.caller, w.ctx, w.now, o), 201);
    }),
  );

  app.patch<{ Params: Params }>("/api/pizza/orders/:id", (request, reply) =>
    write(deps, request, reply, async (c, w) => {
      const { order, as } = await orderFor(
        c,
        request.params.id,
        "order.edit",
        w.caller,
        w.ctx,
        w.now,
        true,
      );
      const changes = await editOrder(c, w, order, body(request));
      if (Object.keys(changes).length > 0 && as === "crew") {
        await deps.audit({
          tenant_id: w.ctx.tenant_id,
          actor_user_id: w.caller.user_id,
          action: "pizza.order.changed",
          target: { type: "order", id: order.id },
          changes,
        });
      }
      const [after] = await ordersWhere(c, `id = $1`, [order.id]);
      return ok(await present(c, w.caller, w.ctx, w.now, after as OrderRow));
    }),
  );

  for (const [path, def] of Object.entries(STEPS)) {
    app.post<{ Params: Params }>(`/api/pizza/orders/:id/${path}`, (request, reply) =>
      write(deps, request, reply, async (c, w) => {
        const { order, as } = await orderFor(
          c,
          request.params.id,
          def.action,
          w.caller,
          w.ctx,
          w.now,
          true,
        );
        const b = body(request);
        const m = await def.run(c, w, order, as, b);
        await auditCrew(deps, w, as, def.audit, m, typeof b.reason === "string" ? b.reason : null);
        return ok(await present(c, w.caller, w.ctx, w.now, m.row));
      }),
    );
  }
}

type Changes = Record<string, { old: unknown; new: unknown }>;
const asJson = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

/** PATCH: the close time while not called in, the note, the pizzeria while empty, and call-in details. */
async function editOrder(c: SqlClient, w: WriteCtx, o: OrderRow, b: Body): Promise<Changes> {
  if (o.state === "cancelled" || o.state === "done") throw cannot("edit", o);
  const sets: string[] = [];
  const values: unknown[] = [];
  const changes: Changes = {};
  let pinRevision = false;
  const set = (col: keyof OrderRow, v: unknown) => {
    values.push(v);
    sets.push(`${col} = $${values.length + 1}`);
    if (col !== "pizzeria_name") changes[col] = { old: asJson(o[col]), new: asJson(v) };
  };
  if (b.closes_at !== undefined) {
    if (!UNPLACED.includes(o.state)) throw cannot("edit", o);
    const t = parseTime(b.closes_at, "closes_at");
    if (t.getTime() <= w.now.getTime()) bad("closes_at", "must be in the future");
    set("closes_at", t);
  }
  if (b.note !== undefined) set("note", optionalText(b.note, "note", LIMITS.orderNote));
  if (b.pizzeria_id !== undefined && b.pizzeria_id !== o.pizzeria_id) {
    if (!UNPLACED.includes(o.state)) throw cannot("edit", o);
    const pz = typeof b.pizzeria_id === "string" ? await getPizzeria(c, b.pizzeria_id) : null;
    if (pz === null || pz.hidden_at !== null) return bad("pizzeria_id", "unknown pizzeria");
    // E6: a menu differs per pizzeria, so the pizzeria is fixed once there are pizzas.
    if ((await itemsOf(c, [o.id])).length > 0) {
      throw new Conflict("has_pizzas", "The pizzeria cannot change once there are pizzas.");
    }
    set("pizzeria_id", pz.id);
    set("pizzeria_name", pz.name);
    // A pizza's add bumps the revision under the row lock. A subquery on pizza_items would keep this
    // statement's old snapshot when the UPDATE waits on that lock, so the revision proves no add slipped in.
    pinRevision = true;
  }
  for (const col of ["estimate_at", "placed_at"] as const) {
    if (b[col] === undefined) continue;
    if (!CALLED_IN.includes(o.state)) throw cannot("arrive", o);
    set(col, b[col] === null && col === "estimate_at" ? null : parseTime(b[col], col));
  }
  if (b.pickup !== undefined) set("pickup", optionalText(b.pickup, "pickup", LIMITS.pickup));
  if (sets.length === 0) return changes;
  const m = await guarded(
    c,
    () =>
      c.query(
        `UPDATE pizza_orders SET ${sets.join(", ")}, revision = revision + 1
         WHERE id = $1 AND state = $${values.length + 2}${pinRevision ? ` AND revision = $${values.length + 3}` : ""} RETURNING id`,
        pinRevision ? [o.id, ...values, o.state, o.revision] : [o.id, ...values, o.state],
      ),
    uniqueConflict,
  );
  if (m.rows.length === 0) {
    if (pinRevision && (await itemsOf(c, [o.id])).length > 0) {
      throw new Conflict("has_pizzas", "The pizzeria cannot change once there are pizzas.");
    }
    throw new Conflict("conflict", "The order changed meanwhile: read it again.");
  }
  const fields = Object.keys(changes);
  await logStep(c, o.id, w.now, { user_id: w.session.userId, name: w.session.userName }, "edited", {
    fields,
  });
  const [after] = await ordersWhere(c, `id = $1`, [o.id]);
  await emitOrder(c, w.step(c).e, "pizza.order.changed", after as OrderRow, {
    changed: fields,
    actor_user_id: w.caller.user_id,
  });
  return changes;
}
