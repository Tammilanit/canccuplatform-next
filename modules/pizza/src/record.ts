/**
 * The daily record (the legacy `report.ts`, its grouping kept; mockup 12): one block per event day,
 * each order with its people, pizzas, comments and amounts, and the flags the treasurer acts on.
 */
import { CALLED_IN } from "./model.js";
import type { OrderState, SettleTo, Split } from "./model.js";
import { amounts } from "./money.js";
import { formatDayLabel } from "./time.js";

export interface RecordOrder {
  id: string;
  day: string;
  seq: number;
  state: OrderState;
  pizzeria: string;
  payer_name: string | null;
  total_cents: number | null;
  split: Split | null;
  settle_to: SettleTo;
  auto_released: boolean;
  /** Cancelled once it was called in: the payment system may already have it. */
  cancelled_after_placed: boolean;
  /** Pizzas changed, or money changed by the crew, after the call-in (the history, D16). */
  edits_after_placed: number;
  /** Done by the timer, or cancelled at the day's turn, with nobody's hand on it. */
  closed_by_timer: boolean;
  rows: {
    user_id: string | null;
    name: string | null;
    price_cents: number | null;
    comment: string | null;
  }[];
}

export interface RecordPerson {
  user_id: string | null;
  name: string | null;
  units: number;
  amount_cents: number | null;
  comments: string[];
}

export interface RecordDay {
  day: string;
  label: string;
  order_count: number;
  total_cents: number;
  /** A called-in order of the day has no total yet. */
  incomplete: boolean;
  orders: (Omit<RecordOrder, "rows"> & { split_effective: Split; people: RecordPerson[] })[];
}

export type FlagKind =
  | "no_total"
  | "edited_after_placed"
  | "released"
  | "cancelled_after_placed"
  | "closed_by_timer";

export interface DailyRecord {
  days: RecordDay[];
  flags: { order_id: string; kind: FlagKind; text: string }[];
}

export function buildRecord(orders: RecordOrder[]): DailyRecord {
  const byDay = new Map<string, RecordDay>();
  const flags: DailyRecord["flags"] = [];
  const sorted = [...orders].sort((a, b) => a.day.localeCompare(b.day) || a.seq - b.seq);
  for (const o of sorted) {
    let day = byDay.get(o.day);
    if (day === undefined) {
      day = {
        day: o.day,
        label: formatDayLabel(o.day),
        order_count: 0,
        total_cents: 0,
        incomplete: false,
        orders: [],
      };
      byDay.set(o.day, day);
    }
    const where = `${o.day} order ${o.seq} (${o.pizzeria})`;
    const { rows, ...rest } = o;
    const money = amounts({ total_cents: o.total_cents, split: o.split }, rows);
    const comments = new Map<string | null, string[]>();
    for (const r of rows)
      if (r.comment) comments.set(r.user_id, [...(comments.get(r.user_id) ?? []), r.comment]);
    day.orders.push({
      ...rest,
      split_effective: money.split,
      people: money.people.map((p) => ({ ...p, comments: comments.get(p.user_id) ?? [] })),
    });
    day.order_count++;
    const flag = (kind: FlagKind, text: string) =>
      flags.push({ order_id: o.id, kind, text: `${where}: ${text}` });
    if (o.cancelled_after_placed)
      flag("cancelled_after_placed", "cancelled after call-in, remove it in the payment system");
    if (o.auto_released) flag("released", "released automatically, check the payer");
    if (o.edits_after_placed > 0) {
      const n = o.edits_after_placed;
      flag("edited_after_placed", `edited after call-in (${n} ${n === 1 ? "edit" : "edits"})`);
    }
    if (o.closed_by_timer) flag("closed_by_timer", "closed by the timer, check it");
    if (CALLED_IN.includes(o.state)) {
      if (o.total_cents === null) {
        day.incomplete = true;
        flag("no_total", "total missing");
      } else day.total_cents += o.total_cents;
    }
  }
  return { days: [...byDay.values()], flags };
}
