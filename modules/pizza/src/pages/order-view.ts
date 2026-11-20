/** An order as the Food pages read it from the API, and what the holder's and crew's views share. */
import { html, timeLabel } from "@canccu/ui";
import type { Html, Slot } from "@canccu/ui";
import { PREFIX, formKey } from "./kit.js";
import type { PageCtx } from "./kit.js";

export interface ItemView {
  id: string;
  user_id: string | null;
  name: string | null;
  label: string;
  note: string | null;
  comment: string | null;
  handed_out: boolean;
}

/** One of the caller's own pizzas, as a member reads it. */
export interface MineView {
  id: string;
  kind: "menu" | "custom" | "text";
  number: string | null;
  label: string;
  toppings: string[] | null;
  text: string | null;
  note: string | null;
  comment: string | null;
  price_cents: number | null;
  handed_out: boolean;
}

/** An order as the API answers it to its holder and the crew (contracts/pizza.md, Orders). */
export interface OrderView {
  id: string;
  seq: number;
  day: string;
  state: "open" | "closed" | "placed" | "arrived" | "done" | "cancelled";
  pizzeria: {
    id: string;
    name: string;
    service: "delivery" | "takeaway";
    phone?: string | null;
    website?: string | null;
  };
  closes_at: string;
  estimate_at: string | null;
  pickup: string | null;
  opened_at: string;
  closed_at: string | null;
  placed_at: string | null;
  arrived_at: string | null;
  done_at: string | null;
  cancelled_at: string | null;
  cancel_reason?: string | null;
  pizza_count: number;
  people_count: number;
  stale: boolean;
  holder?: { user_id: string; name: string | null } | null;
  you_hold?: boolean;
  claimed_at?: string | null;
  nudged_at?: string | null;
  note?: string | null;
  items?: ItemView[];
  /** A member's own pizzas (contracts/pizza.md, Who sees what). */
  mine?: MineView[];
  payer?: { user_id: string; name: string | null } | null;
  /** The caller's own money (contracts/pizza.md, Who sees what), for the people in the order. */
  my_amount_cents?: number | null;
  my_amount_estimated?: boolean;
  settle_to?: "organiser" | "payer";
  my_paid?: boolean | null;
  pay_to?: { user_id: string; name: string | null; mobilepay: string | null; iban: string | null } | null;
}

export const base = (o: OrderView) => `${PREFIX}hold/${o.id}`;
export const time = (c: Pick<PageCtx, "zone">, iso: string | null | undefined) =>
  iso === null || iso === undefined ? "" : timeLabel(iso, c.zone);

/** A notice from the address (`?error=`), after a form. */
export function flash(error: string | undefined): Slot {
  return error === undefined
    ? ""
    : html`<p class="canccu-notice canccu-notice--down pizza-flash" role="alert">${error}</p>`;
}

/** "8 pizzas · 6 people". */
export const counts = (c: Pick<PageCtx, "t">, o: OrderView) =>
  c.t("order.counts", { pizzas: o.pizza_count, people: o.people_count });

export function post(action: string, label: string, cls: string, extra: Slot = ""): Html {
  return html`<form method="post" action="${action}" class="pizza-inline">
    ${formKey()}${extra}<button class="canccu-button ${cls}" type="submit">${label}</button>
  </form>`;
}

interface Person {
  user_id: string;
  name: string;
  labels: string[];
  got: boolean;
  you: boolean;
}

/** Each person once, their pizzas as "#3 Pepperoni ×2", ticked when every one of theirs is. */
export function peopleOf(o: OrderView, me: string): Person[] {
  const by = new Map<string, Person & { counts: Map<string, number> }>();
  for (const i of o.items ?? []) {
    const id = i.user_id ?? i.id;
    let p = by.get(id);
    if (p === undefined) {
      p = {
        user_id: id,
        name: i.name ?? "—",
        labels: [],
        got: true,
        you: id === me,
        counts: new Map(),
      };
      by.set(id, p);
    }
    p.counts.set(i.label, (p.counts.get(i.label) ?? 0) + 1);
    if (!i.handed_out) p.got = false;
  }
  return [...by.values()].map(({ counts, ...p }) => ({
    ...p,
    labels: [...counts].map(([l, n]) => (n > 1 ? `${l} ×${n}` : l)),
  }));
}
