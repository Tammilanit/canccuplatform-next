/**
 * Opening an order and the pizzas in it. A pizza's write first bumps the order's revision with a
 * conditional UPDATE: that takes the order's row lock and checks its state in one step, so joins
 * that race each other and the close are serialised on it (E1), and no pizza lands after the close.
 */
import { KitError } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { emitItem, emitOrder } from "./events.js";
import { newId } from "./ids.js";
import { Conflict, cannot, done, guarded, uniqueConflict } from "./lifecycle.js";
import type { Moved, Step } from "./lifecycle.js";
import type { OrderState } from "./model.js";
import { ORDER_COLUMNS, getItem, getOrder, itemsOf, logStep, ordersWhere } from "./store.js";
import type { Actor, ItemRow, OrderRow } from "./store.js";
import type { ItemInput, Snapshot } from "./validate.js";

const brief = (o: OrderRow) => ({
  id: o.id,
  seq: o.seq,
  pizzeria: { id: o.pizzeria_id, name: o.pizzeria_name },
});

export interface Opening {
  pizzeria: { id: string; name: string };
  closes_at: Date;
  note: string | null;
  day: string;
  max_open: number;
}

/** A new order, its opener holding it; one per pizzeria (D1), N per event (O5), one held each (E14). */
export async function openOrder(s: Step, actor: Actor, input: Opening): Promise<OrderRow> {
  // Opens are serialised per event, so the event's count and the day's numbers stay right.
  await s.c.query(
    `SELECT pg_advisory_xact_lock(hashtext(current_setting('canccu.tenant') || ':pizza-open'))`,
    [],
  );
  const open = await ordersWhere(s.c, `state = ANY($1::text[])`, [["open", "closed"]]);
  const same = open.find((o) => o.pizzeria_id === input.pizzeria.id);
  if (same !== undefined)
    throw new Conflict("another_open", "This pizzeria already has an open order.", {
      open: brief(same),
    });
  if (open.some((o) => o.holder_user_id === actor.user_id))
    throw uniqueConflict("pizza_orders_one_held");
  if (open.length >= input.max_open) {
    throw new Conflict("too_many_open", `At most ${input.max_open} orders may be open at once.`);
  }
  const { rows } = await guarded(
    s.c,
    () =>
      s.c.query(
        `INSERT INTO pizza_orders (id, day, seq, pizzeria_id, pizzeria_name, state, closes_at, note, opened_at,
           opened_by_user_id, holder_user_id, holder_name, claimed_at)
         SELECT $1, $2::date, COALESCE(MAX(seq), 0) + 1, $3, $4, 'open', $5, $6, $7, $8, $8, $9, $7
         FROM pizza_orders WHERE day = $2::date
         RETURNING ${ORDER_COLUMNS}`,
        [
          newId("po"),
          input.day,
          input.pizzeria.id,
          input.pizzeria.name,
          input.closes_at,
          input.note,
          s.now,
          actor.user_id,
          actor.name,
        ],
      ),
    uniqueConflict,
  );
  const o = rows[0] as unknown as OrderRow;
  await logStep(s.c, o.id, s.now, actor, "opened", { pizzeria: input.pizzeria.name });
  await emitOrder(s.c, s.e, "pizza.order.opened", o, { actor_user_id: actor.user_id });
  return o;
}

/** Bumps the order's revision while its state is one of `from`; the row lock for a pizza's write. */
async function lockOrder(
  c: SqlClient,
  id: string,
  from: readonly OrderState[],
  step: string,
): Promise<OrderRow> {
  const { rows } = await c.query(
    `UPDATE pizza_orders SET revision = revision + 1 WHERE id = $1 AND state = ANY($2::text[]) RETURNING ${ORDER_COLUMNS}`,
    [id, from],
  );
  const o = rows[0] as OrderRow | undefined;
  if (o !== undefined) return o;
  const now = await getOrder(c, id);
  if (now === null) throw new KitError("No such order.", { status: 404, code: "not_found" });
  throw cannot(step, now);
}

export async function addItem(
  s: Step,
  actor: Actor,
  orderId: string,
  input: ItemInput,
  snap: Snapshot,
  cap: number,
): Promise<{ order: OrderRow; item: ItemRow }> {
  let o: OrderRow;
  try {
    o = await lockOrder(s.c, orderId, ["open"], "add");
  } catch (err) {
    // E3: the order closed while they chose; offer the orders still open.
    if (err instanceof Conflict && err.code === "closed") {
      const others = await ordersWhere(s.c, `state = 'open' AND id <> $1`, [orderId]);
      throw new Conflict("closed", "This order closed. Add it to another open order?", {
        open_orders: others.map(brief),
      });
    }
    throw err;
  }
  const { rows } = await s.c.query(
    `SELECT count(*)::int AS n FROM pizza_items WHERE order_id = $1 AND user_id = $2`,
    [orderId, actor.user_id],
  );
  if (((rows[0] as { n: number } | undefined)?.n ?? 0) >= cap) {
    throw new Conflict("item_limit", `At most ${cap} pizzas per person in one order.`);
  }
  const ins = await s.c.query(
    `INSERT INTO pizza_items (id, order_id, user_id, name, kind, menu_item_id, number, label, description,
       toppings, text, note, comment, price_cents, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
     RETURNING id`,
    [
      newId("pi"),
      orderId,
      actor.user_id,
      actor.name,
      input.kind,
      snap.menu_item_id,
      snap.number,
      snap.label,
      snap.description,
      snap.toppings === null ? null : JSON.stringify(snap.toppings),
      snap.text,
      input.note,
      input.comment,
      snap.price_cents,
      s.now,
    ],
  );
  const item = (await getItem(s.c, (ins.rows[0] as { id: string }).id)) as ItemRow;
  await logStep(s.c, orderId, s.now, actor, "item_added", { item_id: item.id });
  await emitItem(s.c, s.e, "pizza.item.added", o, item, actor.user_id);
  return { order: o, item };
}

/** The states a pizza may change in: its owner while open; the holder and crew until it is done (U14). */
export const EDITABLE_BY_OWNER: readonly OrderState[] = ["open"];
export const EDITABLE_BY_HOLDER: readonly OrderState[] = ["open", "closed", "placed", "arrived"];

export async function editItem(
  s: Step,
  actor: Actor,
  item: ItemRow,
  from: readonly OrderState[],
  input: ItemInput,
  snap: Snapshot,
): Promise<{ order: OrderRow; before: ItemRow; after: ItemRow }> {
  const o = await lockOrder(s.c, item.order_id, from, "edit");
  await s.c.query(
    `UPDATE pizza_items SET kind = $2, menu_item_id = $3, number = $4, label = $5, description = $6,
       toppings = $7, text = $8, note = $9, comment = $10, price_cents = $11, updated_at = $12 WHERE id = $1`,
    [
      item.id,
      input.kind,
      snap.menu_item_id,
      snap.number,
      snap.label,
      snap.description,
      snap.toppings === null ? null : JSON.stringify(snap.toppings),
      snap.text,
      input.note,
      input.comment,
      snap.price_cents,
      s.now,
    ],
  );
  const after = (await getItem(s.c, item.id)) as ItemRow;
  if (item.user_id !== actor.user_id) {
    await logStep(s.c, o.id, s.now, actor, "item_changed", {
      item_id: item.id,
      from: item.label,
      to: after.label,
    });
    // The owner is told when someone else changed their pizza (U14).
    await emitItem(s.c, s.e, "pizza.item.changed", o, after, actor.user_id);
  }
  return { order: o, before: item, after };
}

export async function removeItem(
  s: Step,
  actor: Actor,
  item: ItemRow,
  from: readonly OrderState[],
): Promise<OrderRow> {
  const o = await lockOrder(s.c, item.order_id, from, "edit");
  await s.c.query(`DELETE FROM pizza_items WHERE id = $1`, [item.id]);
  await logStep(s.c, o.id, s.now, actor, "item_removed", { item_id: item.id, label: item.label });
  await emitItem(s.c, s.e, "pizza.item.removed", o, item, actor.user_id);
  return o;
}

/** Ticks one pizza handed out (U4, U9); the last tick makes the order done (`handed_out`). */
export async function handOut(s: Step, item: ItemRow, handedOut: boolean): Promise<Moved | null> {
  await lockOrder(s.c, item.order_id, ["arrived"], "hand_out");
  await s.c.query(`UPDATE pizza_items SET handed_out_at = $2 WHERE id = $1`, [
    item.id,
    handedOut ? s.now : null,
  ]);
  return await doneIfAllHandedOut(s, item.order_id);
}

/** "Everyone got theirs" (the U4 note): one press ticks the whole order. */
export async function handOutAll(s: Step, orderId: string): Promise<Moved> {
  await lockOrder(s.c, orderId, ["arrived"], "hand_out");
  await s.c.query(
    `UPDATE pizza_items SET handed_out_at = COALESCE(handed_out_at, $2) WHERE order_id = $1`,
    [orderId, s.now],
  );
  await logStep(s.c, orderId, s.now, s.actor, "handed_out_all");
  return (await doneIfAllHandedOut(s, orderId)) ?? (await done(s, orderId, "handed_out"));
}

async function doneIfAllHandedOut(s: Step, orderId: string): Promise<Moved | null> {
  const items = await itemsOf(s.c, [orderId]);
  if (items.length === 0 || items.some((i) => i.handed_out_at === null)) return null;
  return await done(s, orderId, "handed_out");
}
