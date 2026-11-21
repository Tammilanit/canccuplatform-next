/**
 * What the people in an order hear about its money (#703; contracts/pizza.md, Notices): their share
 * is ready, it changed, whom or how they pay changed, they were marked paid, and one reminder when
 * still unpaid. Notify builds the notifications from these events alone, and every subscriber of
 * the bus sees them, so they name only who hears them and the payer: never an amount, an IBAN or a
 * MobilePay number. Each person reads their own amount and the payer's details on My order.
 * Nobody is told of their own share as the payer: they paid the pizzeria.
 */
import type { SqlClient } from "@canccu/kit";
import { emitOrder, personOf } from "./events.js";
import type { Emitter } from "./events.js";
import { itemsOf, logStep } from "./store.js";
import type { OrderRow } from "./store.js";

/** Everyone with a pizza in the order but its payer, sorted; an anonymised row names nobody. */
export async function sharersOf(c: SqlClient, o: OrderRow): Promise<string[]> {
  const ids = new Set<string>();
  for (const i of await itemsOf(c, [o.id]))
    if (i.user_id !== null && !i.user_id.startsWith("anon_") && i.user_id !== o.payer_user_id)
      ids.add(i.user_id);
  return [...ids].sort();
}

/** Those who still pay: everyone but the payer, less whoever the payer marked paid. */
async function unpaidOf(c: SqlClient, o: OrderRow): Promise<string[]> {
  const all = await sharersOf(c, o);
  if (o.settle_to !== "payer") return all;
  const { rows } = await c.query(`SELECT user_id FROM pizza_paid WHERE order_id = $1`, [o.id]);
  const paid = new Set((rows as { user_id: string }[]).map((r) => r.user_id));
  return all.filter((u) => !paid.has(u));
}

const payerOf = (e: Emitter, o: OrderRow) => personOf(e.people, o.payer_user_id, o.payer_name);

/** `pizza.share.*` for these people, unless there is nobody to tell. */
async function tell(
  c: SqlClient,
  e: Emitter,
  type: string,
  o: OrderRow,
  userIds: string[],
  extra: Record<string, unknown>,
): Promise<boolean> {
  if (userIds.length === 0) return false;
  await emitOrder(c, e, type, o, {
    user_ids: userIds,
    settle_to: o.settle_to,
    payer: await payerOf(e, o),
    ...extra,
  });
  return true;
}

/**
 * "Your share is ready", the scheduler's step once the money has settled. Marks the shares sent
 * even when nobody is told, so later changes are news from then on.
 */
export async function shareReady(
  c: SqlClient,
  e: Emitter,
  o: OrderRow,
  now: Date,
): Promise<boolean> {
  await c.query(`UPDATE pizza_orders SET shares_sent_at = $2 WHERE id = $1`, [o.id, now]);
  const told = await tell(c, e, "pizza.share.ready", o, await unpaidOf(c, o), {
    actor_user_id: null,
  });
  if (told) await logStep(c, o.id, now, null, "shares_sent");
  return told;
}

/** Amounts moved after the shares went out: tells those whose amount it was, but the payer. */
export async function amountChanged(
  c: SqlClient,
  e: Emitter,
  o: OrderRow,
  moved: string[],
  actor: string | null,
): Promise<void> {
  if (o.shares_sent_at === null) return;
  const sharers = new Set(await sharersOf(c, o));
  await tell(
    c,
    e,
    "pizza.share.changed",
    o,
    moved.filter((u) => sharers.has(u)),
    { reason: "amount", actor_user_id: actor },
  );
}

/** Whom or how to pay changed after the shares went out: tells those who still pay. */
export async function payToChanged(
  c: SqlClient,
  e: Emitter,
  o: OrderRow,
  actor: string | null,
): Promise<void> {
  if (o.shares_sent_at === null || o.state === "cancelled") return;
  await tell(c, e, "pizza.share.changed", o, await unpaidOf(c, o), {
    reason: "pay_to",
    actor_user_id: actor,
  });
}

/** The payer marked this person paid: told to them alone. */
export async function markedPaid(
  c: SqlClient,
  e: Emitter,
  o: OrderRow,
  userId: string,
  actor: string,
): Promise<void> {
  await emitOrder(c, e, "pizza.share.paid", o, {
    user_id: userId,
    payer: await payerOf(e, o),
    actor_user_id: actor,
  });
}

/**
 * The one payment reminder (the scheduler's `unpaid` step): `not_paid` to each person still
 * unpaid, and to the payer how many they are. False when everyone is marked paid.
 */
export async function remindUnpaid(
  c: SqlClient,
  e: Emitter,
  o: OrderRow,
  now: Date,
): Promise<boolean> {
  if (o.settle_to !== "payer" || o.shares_sent_at === null) return false;
  const unpaid = await unpaidOf(c, o);
  if (unpaid.length === 0) return false;
  const minutes = Math.round((now.getTime() - o.shares_sent_at.getTime()) / 60_000);
  const to = unpaid.map((user_id) => ({ user_id, role: "member" }));
  if (o.payer_user_id !== null && !o.payer_user_id.startsWith("anon_"))
    to.push({ user_id: o.payer_user_id, role: "payer" });
  await logStep(c, o.id, now, null, "payment_reminded");
  for (const p of to)
    await emitOrder(c, e, "pizza.reminder.triggered", o, {
      kind: "not_paid",
      minutes,
      user_id: p.user_id,
      role: p.role,
      count: unpaid.length,
    });
  return true;
}
