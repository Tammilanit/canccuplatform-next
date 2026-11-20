/**
 * An order's money as its holder, the crew and the organiser read it (the plan, Money): the total
 * and who set it, the split, settle to, each person's amount and, when it settles to the payer,
 * their Paid mark and how to pay the payer. In the API only, never on the bus.
 */
import type { SqlClient } from "@canccu/kit";
import { amounts } from "./money.js";
import { paidOf, payDetailsOf } from "./paid.js";
import { receiptView, receiptsOf } from "./receipts.js";
import { itemsOf } from "./store.js";
import type { OrderRow } from "./store.js";

/** How the order's people pay its payer, when it settles to them; null otherwise. */
export async function payToOf(c: SqlClient, o: OrderRow) {
  if (o.settle_to !== "payer" || o.payer_user_id === null) return null;
  const d = await payDetailsOf(c, o.payer_user_id);
  return { user_id: o.payer_user_id, name: o.payer_name, mobilepay: d.mobilepay, iban: d.iban };
}

export async function moneyView(c: SqlClient, o: OrderRow): Promise<Record<string, unknown>> {
  const items = await itemsOf(c, [o.id]);
  const a = amounts(o, items);
  const paid = await paidOf(c, o.id);
  const marks = o.settle_to === "payer";
  return {
    order_id: o.id,
    payer: o.payer_user_id === null ? null : { user_id: o.payer_user_id, name: o.payer_name },
    total_cents: o.total_cents,
    total_set_at: o.total_set_at?.toISOString() ?? null,
    total_set_by: o.total_set_by_name === null ? null : { name: o.total_set_by_name },
    total_receipt_id: o.total_receipt_id,
    split: o.split,
    split_effective: a.split,
    exact_possible: a.exact_possible,
    estimated: a.estimated,
    extras_cents: a.extras_cents,
    settle_to: o.settle_to,
    total_effective_cents: a.total_cents,
    // A mark only where people pay the payer, and never for the payer themselves (U12 A).
    people: a.people.map((p) => ({
      ...p,
      paid:
        marks && p.user_id !== null && p.user_id !== o.payer_user_id ? paid.has(p.user_id) : null,
    })),
    pay_to: await payToOf(c, o),
    receipts: (await receiptsOf(c, o.id)).map(receiptView),
    prices: items.map((i) => ({
      item_id: i.id,
      user_id: i.user_id,
      label: i.label,
      price_cents: i.price_cents,
    })),
  };
}
