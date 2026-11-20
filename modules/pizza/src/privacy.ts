/**
 * Personal data (O6; contracts/pizza.md, Data and privacy). Orders, rows, comments, ticks, the
 * holder and the payer name people. Deleting or anonymising takes the names and user ids away and
 * keeps the rows, so counts and totals stay (0027): a row's user id becomes a pseudonym of its own
 * (`anon_…`), which keeps a person's pizzas together and names nobody.
 */
import { randomBytes } from "node:crypto";
import type { SqlClient } from "@canccu/kit";
import { emitItem } from "./events.js";
import type { Emitter } from "./events.js";
import { release } from "./lifecycle.js";
import { UNPLACED } from "./model.js";
import { getOrder, itemsOf, logStep, ordersWhere } from "./store.js";
import type { OrderRow } from "./store.js";

const pseudonym = () => `anon_${randomBytes(9).toString("hex")}`;

/**
 * A person who can no longer collect (E5): their holds on orders not called in are released and
 * their pizzas leave the orders still open; called-in orders keep theirs. `quiet`: for a delete,
 * the events name nobody.
 */
export async function leave(
  c: SqlClient,
  e: Emitter,
  userId: string,
  now: Date,
  quiet = false,
): Promise<void> {
  const s = { c, e, now, actor: null };
  for (const o of await ordersWhere(c, `holder_user_id = $1 AND state = ANY($2::text[])`, [
    userId,
    UNPLACED,
  ])) {
    await release(s, o.id, "released", { quiet });
  }
  for (const o of await ordersWhere(
    c,
    `state = 'open' AND id IN (SELECT order_id FROM pizza_items WHERE user_id = $1)`,
    [userId],
  )) {
    const theirs = (await itemsOf(c, [o.id])).filter((i) => i.user_id === userId);
    await c.query(`DELETE FROM pizza_items WHERE order_id = $1 AND user_id = $2`, [o.id, userId]);
    await c.query(`UPDATE pizza_orders SET revision = revision + 1 WHERE id = $1`, [o.id]);
    const after = (await getOrder(c, o.id)) as OrderRow;
    await logStep(c, o.id, now, null, "items_removed", { count: theirs.length });
    for (const i of theirs) {
      await emitItem(
        c,
        e,
        "pizza.item.removed",
        after,
        quiet ? { ...i, user_id: null, name: null } : i,
        null,
      );
    }
  }
  // No longer told as the crew: a member who left holds no right here.
  await c.query(`DELETE FROM pizza_crew WHERE user_id = $1`, [userId]);
}

/** Everything about one person at this event, anonymised (the privacy delete, a deleted user). */
export async function forgetUser(
  c: SqlClient,
  e: Emitter,
  userId: string,
  now: Date,
): Promise<void> {
  await leave(c, e, userId, now, true);
  await c.query(
    `UPDATE pizza_items SET user_id = $2, name = NULL, comment = NULL WHERE user_id = $1`,
    [userId, pseudonym()],
  );
  await c.query(
    `UPDATE pizza_orders SET
       holder_user_id = CASE WHEN holder_user_id = $1 THEN NULL ELSE holder_user_id END,
       holder_name = CASE WHEN holder_user_id = $1 THEN NULL ELSE holder_name END,
       payer_user_id = CASE WHEN payer_user_id = $1 THEN NULL ELSE payer_user_id END,
       payer_name = CASE WHEN payer_user_id = $1 THEN NULL ELSE payer_name END,
       opened_by_user_id = NULLIF(opened_by_user_id, $1),
       cancelled_by_user_id = NULLIF(cancelled_by_user_id, $1)
     WHERE $1 IN (holder_user_id, payer_user_id, opened_by_user_id, cancelled_by_user_id)`,
    [userId],
  );
  await c.query(
    `UPDATE pizza_order_log SET actor_user_id = NULL, actor_name = NULL WHERE actor_user_id = $1`,
    [userId],
  );
  await c.query(`UPDATE pizza_order_log SET detail = '{}' WHERE strpos(detail::text, $1) > 0`, [
    userId,
  ]);
  // Stored answers are views that may name them: their own, and anyone's that shows them (a
  // holder's view lists every pizza with its person). A write's answer names a person only as
  // `{ user_id, name }`, so the id finds every one. A retry of a dropped key runs again (E2).
  await c.query(
    `DELETE FROM pizza_idempotency WHERE user_id = $1 OR strpos(body::text, to_jsonb($1::text)::text) > 0`,
    [userId],
  );
}

/** The 12-month retention (`personal`): every person at the event, anonymised; totals stay. */
export async function anonymiseAll(c: SqlClient): Promise<void> {
  const { rows } = await c.query(
    `SELECT DISTINCT user_id FROM pizza_items WHERE user_id IS NOT NULL AND user_id NOT LIKE 'anon\\_%'`,
    [],
  );
  for (const r of rows as { user_id: string }[]) {
    await c.query(`UPDATE pizza_items SET user_id = $2 WHERE user_id = $1`, [
      r.user_id,
      pseudonym(),
    ]);
  }
  await c.query(`UPDATE pizza_items SET name = NULL, comment = NULL`, []);
  await c.query(
    `UPDATE pizza_orders SET holder_user_id = NULL, holder_name = NULL, payer_user_id = NULL, payer_name = NULL,
       opened_by_user_id = NULL, cancelled_by_user_id = NULL`,
    [],
  );
  await c.query(
    `UPDATE pizza_order_log SET actor_user_id = NULL, actor_name = NULL, detail = '{}'`,
    [],
  );
  await c.query(`DELETE FROM pizza_idempotency`, []);
  await c.query(`DELETE FROM pizza_crew`, []);
  // A receipt can show card digits (M3): the photos go, their files with them (the caller's part).
  await c.query(`UPDATE pizza_orders SET total_set_by_name = NULL`, []);
  await c.query(`DELETE FROM pizza_receipts`, []);
  await c.query(`DELETE FROM pizza_paid`, []);
  await c.query(`DELETE FROM pizza_pay_details`, []);
}

/** A deleted event's rows, all of them. */
export async function deleteTenantRows(c: SqlClient): Promise<void> {
  for (const table of [
    "pizza_receipts",
    "pizza_paid",
    "pizza_pay_details",
    "pizza_reader_keys",
    "pizza_reads",
    "pizza_due",
    "pizza_crew",
    "pizza_order_log",
    "pizza_items",
    "pizza_orders",
    "pizza_menu_entries",
    "pizza_pizzerias",
    "pizza_idempotency",
    "pizza_outbox",
  ]) {
    await c.query(`DELETE FROM ${table}`, []);
  }
}
