/** The export for the payment system (contracts/pizza.md, The export CSV): byte for byte. */
import { describe, expect, it } from "vitest";
import { buildExport } from "../src/export-csv.js";
import type { ExportOrder } from "../src/export-csv.js";
import { SPEC_EXPORT, must } from "./fixtures.js";

const rows = (spec: [string, (number | null)[]][]) =>
  spec.flatMap(([name, prices]) =>
    prices.map((price_cents) => ({ user_id: `u_${name}`, name, discord_id: null, price_cents })),
  );

const order = (o: Partial<ExportOrder>): ExportOrder => ({
  day: "2026-11-21",
  seq: 1,
  state: "placed",
  placed_at: new Date("2026-11-21T15:20:00Z"),
  pizzeria: "Demo Pizzeria",
  payer_name: "Player Two",
  total_cents: 3800,
  split: null,
  settle_to: "organiser",
  rows: [],
  ...o,
});

const SPEC_ORDERS: ExportOrder[] = [
  // Listed out of order: the export sorts by order and then by nick.
  order({
    seq: 3,
    state: "done",
    placed_at: new Date("2026-11-21T16:31:00Z"),
    pizzeria: "Demo Trattoria",
    payer_name: "Player Three",
    total_cents: 5450,
    settle_to: "payer",
    rows: rows([
      ["Player Two", [850]],
      ["Demo Player", [1000, 1000]],
      ["Player Three", [900]],
      ["Player Four", [850, 850]],
    ]),
  }),
  order({
    seq: 1,
    state: "arrived",
    rows: rows([
      ["Player Two", [null]],
      ["Demo Player", [null, 1000]],
      ["Player Six", [null]],
      ["Player Five", [null, null]],
    ]),
  }),
  order({ seq: 2, pizzeria: "Demo Corner Grill", total_cents: null, rows: rows([["A", [null]]]) }),
  order({ seq: 4, state: "cancelled", rows: rows([["B", [900]]]) }),
  order({
    seq: 5,
    state: "closed",
    placed_at: null,
    total_cents: null,
    rows: rows([["C", [900]]]),
  }),
];

describe("buildExport", () => {
  it("writes the spec's example byte for byte", () => {
    const out = buildExport(SPEC_ORDERS, "Europe/Helsinki");
    expect(out.csv).toBe(SPEC_EXPORT);
    expect(Buffer.from(out.csv, "utf8")[0]).toBe(0x6f); // no BOM
  });
  it("names the orders left out, and only those called in", () => {
    expect(buildExport(SPEC_ORDERS, "Europe/Helsinki").left_out).toEqual([
      { order_id: "2026-11-21-2", pizzeria: "Demo Corner Grill", reason: "no_total" },
    ]);
  });
  it("writes amount on every row of an exact order and on none of an even one", () => {
    const even = buildExport([{ ...must(SPEC_ORDERS[0]), split: "even" }], "UTC").csv;
    expect(even.split("\n")[1]?.endsWith(",2,")).toBe(true);
  });
  it("quotes a field with a comma, a quote or a line break, and writes the discord id", () => {
    const out = buildExport(
      [
        order({
          pizzeria: 'Pizza "Uno", Demo',
          payer_name: "Line\nBreak",
          rows: [
            {
              user_id: "u_1",
              name: "Comma, Nick",
              discord_id: "100000000000000001",
              price_cents: null,
            },
          ],
        }),
      ],
      "UTC",
    ).csv;
    expect(out.split("\n").slice(1, 3).join("\n")).toBe(
      '2026-11-21-1,2026-11-21T15:20:00+00:00,"Pizza ""Uno"", Demo","Line\nBreak",38.00,organiser,"Comma, Nick",100000000000000001,1,',
    );
  });
  it("writes values as they are: no spreadsheet escaping of a leading =", () => {
    const out = buildExport(
      [order({ rows: [{ user_id: "u", name: "=1+1", discord_id: null, price_cents: null }] })],
      "UTC",
    ).csv;
    expect(out).toContain(",=1+1,,1,");
  });
  it("sorts order 10 after order 9", () => {
    const out = buildExport(
      [10, 9].map((seq) => order({ seq, rows: rows([["A", [null]]]) })),
      "UTC",
    ).csv;
    expect(
      out
        .split("\n")
        .slice(1, 3)
        .map((l) => l.split(",")[0]),
    ).toEqual(["2026-11-21-9", "2026-11-21-10"]);
  });
  it("is only the header when nothing is called in", () => {
    expect(buildExport([], "UTC")).toEqual({
      csv: "order_id,ordered_at,pizzeria,payer_nick,order_total,settle_to,nick,discord_id,units,amount\n",
      left_out: [],
    });
  });
});
