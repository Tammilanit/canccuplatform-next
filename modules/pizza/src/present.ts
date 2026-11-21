/** Reading an order for a caller: its facts for the rules, and the view the caller may see. */
import type { SqlClient, TenantContext } from "@canccu/kit";
import { holderMoneyOpen, notFound, today } from "./http.js";
import { authorize } from "./policy.js";
import type { Action, As, Caller, Facts } from "./policy.js";
import { getOrder, getPizzeria, itemsOf } from "./store.js";
import type { ItemRow, OrderRow } from "./store.js";
import { payToOf } from "./money-view.js";
import { paidOf } from "./paid.js";
import { factsOf, orderView, seenBy } from "./views.js";

export function facts(ctx: TenantContext, now: Date, o: OrderRow, item?: ItemRow): Facts {
  return factsOf(
    o,
    { today: today(ctx, now), holderMoneyOpen: holderMoneyOpen(ctx, o.day, now) },
    item,
  );
}

export async function present(
  c: SqlClient,
  caller: Caller | null,
  ctx: TenantContext,
  now: Date,
  o: OrderRow,
): Promise<Record<string, unknown>> {
  const items = await itemsOf(c, [o.id]);
  const pizzeria = await getPizzeria(c, o.pizzeria_id);
  const seen = seenBy(caller, facts(ctx, now, o));
  const settling =
    seen === "guest" ? undefined : { paid: await paidOf(c, o.id), payTo: await payToOf(c, o) };
  return orderView(o, items, caller, seen, {
    today: today(ctx, now),
    pizzeria,
    ...(settling === undefined ? {} : { settling }),
  });
}

/**
 * The order, and how the caller may take `action` on it (or the error to answer). A write reads it
 * `FOR UPDATE` (`lock`): the rights are then checked against the row the step will change, so a
 * holder taken over meanwhile is refused instead of releasing, closing or calling in the order.
 */
export async function orderFor(
  c: SqlClient,
  id: string,
  action: Action,
  caller: Caller | null,
  ctx: TenantContext,
  now: Date,
  lock = false,
): Promise<{ order: OrderRow; as: As }> {
  const order = await getOrder(c, id, lock);
  if (order === null) throw notFound();
  return { order, as: authorize(action, caller, facts(ctx, now, order)).as };
}
