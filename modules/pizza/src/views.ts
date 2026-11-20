/**
 * What each caller sees of an order (D9, U15): a guest the counts and no names, as the screen
 * shows; a member the holder, the pizzas without names and their own rows in full; the holder and
 * the crew everything, names, notes, comments and money. Checked on every read.
 */
import { amounts } from "./money.js";
import { may } from "./policy.js";
import type { Caller, Facts } from "./policy.js";
import type { ItemRow, OrderRow, PizzeriaRow } from "./store.js";
import { countsOf } from "./store.js";
import { UNPLACED } from "./model.js";

export type Seen = "guest" | "member" | "manager";

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** The facts the rules need for an order (and, for an item action, its row). */
export function factsOf(
  o: OrderRow,
  ctx: { today: string; holderMoneyOpen: boolean; crewOnly?: boolean },
  item?: ItemRow,
): Facts {
  return {
    holder_user_id: o.holder_user_id,
    owner_user_id: item?.user_id ?? null,
    state: o.state,
    stale: UNPLACED.includes(o.state) && o.day < ctx.today,
    holder_money_open: ctx.holderMoneyOpen,
    crew_only: ctx.crewOnly ?? false,
  };
}

export function seenBy(caller: Caller | null, f: Facts): Seen {
  if (caller === null || !caller.member) return "guest";
  return may("order.names", caller, f) ? "manager" : "member";
}

export function itemView(i: ItemRow, caller: Caller | null, withPerson: boolean) {
  return {
    id: i.id,
    ...(withPerson ? { user_id: i.user_id, name: i.name } : {}),
    kind: i.kind,
    number: i.number,
    label: i.label,
    description: i.description,
    toppings: i.toppings,
    text: i.text,
    note: i.note,
    comment: i.comment,
    price_cents: i.price_cents,
    handed_out: i.handed_out_at !== null,
    mine: caller !== null && i.user_id === caller.user_id,
  };
}

/** Pizzas as "2 × #1 Margherita", without who or their notes. */
function linesOf(items: ItemRow[]) {
  const lines = new Map<string, number>();
  for (const i of items) lines.set(i.label, (lines.get(i.label) ?? 0) + 1);
  return [...lines].map(([label, count]) => ({ count, label }));
}

export function orderView(
  o: OrderRow,
  items: ItemRow[],
  caller: Caller | null,
  seen: Seen,
  ctx: { today: string; pizzeria: PizzeriaRow | null },
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: o.id,
    seq: o.seq,
    day: o.day,
    state: o.state,
    pizzeria: {
      id: o.pizzeria_id,
      name: o.pizzeria_name,
      service: ctx.pizzeria?.service ?? "delivery",
    },
    closes_at: iso(o.closes_at),
    target_at: iso(o.closes_at),
    estimate_at: iso(o.estimate_at),
    pickup: o.pickup,
    opened_at: iso(o.opened_at),
    closed_at: iso(o.closed_at),
    placed_at: iso(o.placed_at),
    arrived_at: iso(o.arrived_at),
    done_at: iso(o.done_at),
    done_reason: o.done_reason,
    cancelled_at: iso(o.cancelled_at),
    ...countsOf(items),
    revision: o.revision,
    stale: UNPLACED.includes(o.state) && o.day < ctx.today,
  };
  if (seen === "guest") return base;
  const mine = items.filter((i) => caller !== null && i.user_id === caller.user_id);
  const money = mine.length > 0 || seen === "manager" ? amounts(o, items) : null;
  const myAmount =
    money?.people.find((p) => caller !== null && p.user_id === caller.user_id)?.amount_cents ??
    null;
  const member = {
    ...base,
    holder: o.holder_user_id === null ? null : { user_id: o.holder_user_id, name: o.holder_name },
    you_hold: caller !== null && o.holder_user_id === caller.user_id,
    note: o.note,
    cancel_reason: o.cancel_reason,
    mine: mine.map((i) => itemView(i, caller, false)),
    my_amount_cents: myAmount,
  };
  if (seen === "member") return { ...member, lines: linesOf(items) };
  return {
    ...member,
    pizzeria: {
      ...(base.pizzeria as object),
      phone: ctx.pizzeria?.phone ?? null,
      website: ctx.pizzeria?.website ?? null,
    },
    claimed_at: iso(o.claimed_at),
    items: items.map((i) => itemView(i, caller, true)),
    payer: o.payer_user_id === null ? null : { user_id: o.payer_user_id, name: o.payer_name },
    total_cents: o.total_cents,
    split: o.split,
    settle_to: o.settle_to,
  };
}
