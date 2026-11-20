/** The legacy `pizza-report` test, ported for its grouping: the daily record of mockup 12. */
import { describe, expect, it } from "vitest";
import { buildRecord } from "../src/record.js";
import type { RecordOrder } from "../src/record.js";
import { must } from "./fixtures.js";

const row = (name: string, o: { price_cents?: number | null; comment?: string | null } = {}) => ({
  user_id: `u_${name}`,
  name,
  price_cents: o.price_cents ?? null,
  comment: o.comment ?? null,
});
const base = {
  pizzeria: "Demo Pizzeria",
  payer_name: "Pena",
  split: null,
  settle_to: "organiser" as const,
  auto_released: false,
  cancelled_after_placed: false,
};
const orders: RecordOrder[] = [
  {
    ...base,
    id: "po_2",
    day: "2026-10-29",
    seq: 2,
    state: "placed",
    total_cents: null,
    payer_name: "Anni",
    rows: [row("Anni")],
  },
  {
    ...base,
    id: "po_1",
    day: "2026-10-29",
    seq: 1,
    state: "done",
    total_cents: 18260,
    rows: [
      row("alex", { comment: "split with Pena" }),
      row("alex", { comment: "extra" }),
      row("Anni"),
    ],
  },
  {
    ...base,
    id: "po_3",
    day: "2026-10-29",
    seq: 3,
    state: "cancelled",
    total_cents: null,
    rows: [row("Mikko")],
  },
  {
    ...base,
    id: "po_4",
    day: "2026-10-30",
    seq: 1,
    state: "arrived",
    total_cents: 5000,
    rows: [row("Mikko"), row("Mikko")],
  },
];

describe("buildRecord", () => {
  const r = buildRecord(orders);
  it("groups orders by day, oldest first, with each day's total", () => {
    expect(r.days.map((d) => [d.day, d.label, d.order_count, d.total_cents, d.incomplete])).toEqual(
      [
        ["2026-10-29", "Thu 29.10.", 3, 18260, true],
        ["2026-10-30", "Fri 30.10.", 1, 5000, false],
      ],
    );
    expect(r.days[0]?.orders.map((o) => [o.seq, o.state])).toEqual([
      [1, "done"],
      [2, "placed"],
      [3, "cancelled"],
    ]);
  });
  it("lists each order's people by name, with pizzas, comments and amounts", () => {
    expect(r.days[0]?.orders[0]?.people).toEqual([
      { user_id: "u_Anni", name: "Anni", units: 1, amount_cents: 6087, comments: [] },
      {
        user_id: "u_alex",
        name: "alex",
        units: 2,
        amount_cents: 12173,
        comments: ["split with Pena", "extra"],
      },
    ]);
  });
  it("flags a called-in order without its total and leaves cancelled ones out of the total", () => {
    expect(r.flags).toEqual([
      { order_id: "po_2", text: "2026-10-29 order 2 (Demo Pizzeria): total missing" },
    ]);
  });
  it("flags an order released automatically, and one cancelled after call-in", () => {
    const flagged = buildRecord([
      { ...must(orders[3]), auto_released: true },
      { ...must(orders[2]), cancelled_after_placed: true },
    ]);
    expect(flagged.flags.map((f) => f.text)).toEqual([
      "2026-10-29 order 3 (Demo Pizzeria): cancelled after call-in, remove it in the payment system",
      "2026-10-30 order 1 (Demo Pizzeria): released automatically, check the payer",
    ]);
  });
});
