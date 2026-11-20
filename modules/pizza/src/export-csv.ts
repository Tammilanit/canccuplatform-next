/**
 * The export for the payment system (contracts/pizza.md, The export CSV; #633): one row per person
 * per called-in order with a total, sorted by order and then by nick. UTF-8 without a BOM, comma,
 * dot decimals, LF, RFC 4180 quoting, and values as they are: the payment system matches nicks
 * exactly, so nothing is escaped for spreadsheets.
 */
import { csvLine, euros } from "./csv.js";
import { CALLED_IN } from "./model.js";
import type { OrderState, SettleTo, Split } from "./model.js";
import { amounts, byName } from "./money.js";
import { withOffset } from "./time.js";

export const EXPORT_COLUMNS = [
  "order_id",
  "ordered_at",
  "pizzeria",
  "payer_nick",
  "order_total",
  "settle_to",
  "nick",
  "discord_id",
  "units",
  "amount",
];

export interface ExportOrder {
  day: string;
  seq: number;
  state: OrderState;
  placed_at: Date | null;
  pizzeria: string;
  payer_name: string | null;
  total_cents: number | null;
  split: Split | null;
  settle_to: SettleTo;
  rows: {
    user_id: string | null;
    name: string | null;
    discord_id: string | null;
    price_cents: number | null;
  }[];
}

export interface LeftOut {
  order_id: string;
  pizzeria: string;
  reason: "no_total";
}

/** The export's stable order id: the event day and the order's number that day. */
export const exportId = (o: { day: string; seq: number }): string => `${o.day}-${o.seq}`;

export function buildExport(
  orders: ExportOrder[],
  timeZone: string,
): { csv: string; left_out: LeftOut[] } {
  const lines = [EXPORT_COLUMNS.join(",")];
  const left_out: LeftOut[] = [];
  const sorted = orders
    .filter((o) => CALLED_IN.includes(o.state))
    .sort((a, b) => a.day.localeCompare(b.day) || a.seq - b.seq);
  for (const o of sorted) {
    if (o.total_cents === null || o.placed_at === null) {
      left_out.push({ order_id: exportId(o), pizzeria: o.pizzeria, reason: "no_total" });
      continue;
    }
    const money = amounts({ total_cents: o.total_cents, split: o.split }, o.rows);
    const discord = new Map(o.rows.map((r) => [r.user_id, r.discord_id]));
    const head = [
      exportId(o),
      withOffset(o.placed_at, timeZone),
      o.pizzeria,
      o.payer_name ?? "",
      euros(o.total_cents),
      o.settle_to,
    ];
    const people = [...money.people].sort((a, b) => byName(a.name, b.name));
    for (const p of people) {
      lines.push(
        csvLine([
          ...head,
          p.name ?? "",
          discord.get(p.user_id) ?? "",
          String(p.units),
          money.split === "exact" && p.amount_cents !== null ? euros(p.amount_cents) : "",
        ]),
      );
    }
  }
  return { csv: `${lines.join("\n")}\n`, left_out };
}
