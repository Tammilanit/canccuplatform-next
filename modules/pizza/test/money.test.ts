/**
 * Each person's amount (the step 5 plan, Money): exact or even, rounded to the cent by the largest
 * remainder so the amounts add up to the total, ties in the order of the person's name.
 */
import { describe, expect, it } from "vitest";
import { amounts } from "../src/money.js";
import type { MoneyRow } from "../src/money.js";

const rows = (spec: [string, (number | null)[]][]): MoneyRow[] =>
  spec.flatMap(([name, prices]) =>
    prices.map((price_cents) => ({ user_id: `u_${name}`, name, price_cents })),
  );
const sum = (r: ReturnType<typeof amounts>) =>
  r.people.reduce((s, p) => s + (p.amount_cents ?? 0), 0);

describe("amounts", () => {
  // The export spec's order 1: an even split of 38.00 over six pizzas.
  const order1 = rows([
    ["Demo Player", [null, null]],
    ["Player Five", [null, null]],
    ["Player Six", [null]],
    ["Player Two", [null]],
  ]);
  it("splits evenly by pizzas when a price is missing, the cents to the largest remainders", () => {
    const r = amounts({ total_cents: 3800, split: null }, order1);
    expect(r.split).toBe("even");
    expect(r.people).toEqual([
      { user_id: "u_Demo Player", name: "Demo Player", units: 2, amount_cents: 1267 },
      { user_id: "u_Player Five", name: "Player Five", units: 2, amount_cents: 1267 },
      { user_id: "u_Player Six", name: "Player Six", units: 1, amount_cents: 633 },
      { user_id: "u_Player Two", name: "Player Two", units: 1, amount_cents: 633 },
    ]);
    expect(sum(r)).toBe(3800);
  });

  // The export spec's order 3: every pizza priced, the prices add up to the total.
  const order3 = rows([
    ["Demo Player", [1000, 1000]],
    ["Player Four", [850, 850]],
    ["Player Three", [900]],
    ["Player Two", [850]],
  ]);
  it("is exact by default when every pizza has a price", () => {
    const r = amounts({ total_cents: 5450, split: null }, order3);
    expect(r.split).toBe("exact");
    expect(r.people.map((p) => p.amount_cents)).toEqual([2000, 1700, 900, 850]);
    expect(r.extras_cents).toBe(0);
  });
  it("splits the extras per pizza: a delivery fee adds, a discount takes away", () => {
    const fee = amounts({ total_cents: 5450 + 600, split: null }, order3);
    // 6.00 over six pizzas: 1.00 a pizza.
    expect(fee.people.map((p) => p.amount_cents)).toEqual([2200, 1900, 1000, 950]);
    const off = amounts({ total_cents: 5450 - 100, split: null }, order3);
    // -1.00 over six pizzas: -0.1667 each; the cents go to the largest remainders, by name on ties.
    expect(off.people.map((p) => p.amount_cents)).toEqual([1967, 1667, 883, 833]);
    expect(sum(off)).toBe(5350);
  });
  it("lets the holder choose even even when every pizza is priced", () => {
    const r = amounts({ total_cents: 5450, split: "even" }, order3);
    expect(r.split).toBe("even");
    expect(r.people.map((p) => p.amount_cents)).toEqual([1817, 1817, 908, 908]);
    expect(sum(r)).toBe(5450);
  });
  it("falls back to even when exact was chosen but a price went missing", () => {
    const r = amounts({ total_cents: 3800, split: "exact" }, order1);
    expect(r.split).toBe("even");
    expect(r.exact_possible).toBe(false);
  });
  it("stays even when exact would give anyone a negative amount", () => {
    const r = amounts(
      { total_cents: 100, split: "exact" },
      rows([
        ["A", [1000]],
        ["B", [100]],
      ]),
    );
    expect(r.split).toBe("even");
    expect(r.people.map((p) => p.amount_cents)).toEqual([50, 50]);
  });
  it("breaks ties by name, whatever the rows' order", () => {
    const r = amounts(
      { total_cents: 100, split: null },
      rows([
        ["Cee", [null]],
        ["Aa", [null]],
        ["Bee", [null]],
      ]),
    );
    expect(r.people.map((p) => [p.name, p.amount_cents])).toEqual([
      ["Aa", 34],
      ["Bee", 33],
      ["Cee", 33],
    ]);
  });
  it("without a total, priced pizzas give an estimate; unpriced ones give no amounts", () => {
    const est = amounts({ total_cents: null, split: null }, order3);
    expect(est).toMatchObject({ split: "exact", estimated: true, total_cents: 5450 });
    expect(est.people[0]?.amount_cents).toBe(2000);
    const none = amounts({ total_cents: null, split: null }, order1);
    expect(none.total_cents).toBeNull();
    expect(none.people.every((p) => p.amount_cents === null)).toBe(true);
  });
  it("adds up for every total over a party's worth of people (property check)", () => {
    for (let total = 0; total <= 20000; total += 137) {
      const many = rows(
        Array.from({ length: 70 }, (_, i): [string, (number | null)[]] => [
          `P${String(i).padStart(2, "0")}`,
          i % 3 === 0 ? [800, 950] : [700],
        ]),
      );
      for (const split of ["even", null] as const) {
        const r = amounts({ total_cents: total, split }, many);
        expect(sum(r)).toBe(total);
        expect(r.people.every((p) => (p.amount_cents ?? 0) >= 0)).toBe(true);
      }
    }
  });
  it("has no people and no amounts for an empty order", () => {
    expect(amounts({ total_cents: 500, split: null }, []).people).toEqual([]);
  });
});
