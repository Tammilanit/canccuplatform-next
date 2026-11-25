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
    const r = amounts({ total_cents: 3800, split: null, even_limit_cents: null }, order1);
    expect(r.split).toBe("even");
    expect(r.people).toEqual([
      {
        user_id: "u_Demo Player",
        name: "Demo Player",
        units: 2,
        amount_cents: 1267,
        over_limit_cents: 0,
      },
      {
        user_id: "u_Player Five",
        name: "Player Five",
        units: 2,
        amount_cents: 1267,
        over_limit_cents: 0,
      },
      {
        user_id: "u_Player Six",
        name: "Player Six",
        units: 1,
        amount_cents: 633,
        over_limit_cents: 0,
      },
      {
        user_id: "u_Player Two",
        name: "Player Two",
        units: 1,
        amount_cents: 633,
        over_limit_cents: 0,
      },
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
    const r = amounts({ total_cents: 5450, split: null, even_limit_cents: null }, order3);
    expect(r.split).toBe("exact");
    expect(r.people.map((p) => p.amount_cents)).toEqual([2000, 1700, 900, 850]);
    expect(r.extras_cents).toBe(0);
  });
  it("splits the extras per pizza: a delivery fee adds, a discount takes away", () => {
    const fee = amounts({ total_cents: 5450 + 600, split: null, even_limit_cents: null }, order3);
    // 6.00 over six pizzas: 1.00 a pizza.
    expect(fee.people.map((p) => p.amount_cents)).toEqual([2200, 1900, 1000, 950]);
    const off = amounts({ total_cents: 5450 - 100, split: null, even_limit_cents: null }, order3);
    // -1.00 over six pizzas: -0.1667 each; the cents go to the largest remainders, by name on ties.
    expect(off.people.map((p) => p.amount_cents)).toEqual([1967, 1667, 883, 833]);
    expect(sum(off)).toBe(5350);
  });
  it("lets the holder choose even even when every pizza is priced", () => {
    const r = amounts({ total_cents: 5450, split: "even", even_limit_cents: null }, order3);
    expect(r.split).toBe("even");
    expect(r.people.map((p) => p.amount_cents)).toEqual([1817, 1817, 908, 908]);
    expect(sum(r)).toBe(5450);
  });
  it("falls back to even when exact was chosen but a price went missing", () => {
    const r = amounts({ total_cents: 3800, split: "exact", even_limit_cents: null }, order1);
    expect(r.split).toBe("even");
    expect(r.exact_possible).toBe(false);
  });
  it("stays even when exact would give anyone a negative amount", () => {
    const r = amounts(
      { total_cents: 100, split: "exact", even_limit_cents: null },
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
      { total_cents: 100, split: null, even_limit_cents: null },
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
    const est = amounts({ total_cents: null, split: null, even_limit_cents: null }, order3);
    expect(est).toMatchObject({ split: "exact", estimated: true, total_cents: 5450 });
    expect(est.people[0]?.amount_cents).toBe(2000);
    const none = amounts({ total_cents: null, split: null, even_limit_cents: null }, order1);
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
        const r = amounts({ total_cents: total, split, even_limit_cents: null }, many);
        expect(sum(r)).toBe(total);
        expect(r.people.every((p) => (p.amount_cents ?? 0) >= 0)).toBe(true);
      }
    }
  });
  it("has no people and no amounts for an empty order", () => {
    expect(amounts({ total_cents: 500, split: null, even_limit_cents: null }, []).people).toEqual(
      [],
    );
  });
});

describe("amounts always add up to the total (#644)", () => {
  // A fixed seed: the same thousand orders every run, so a failure can be read back.
  let seed = 644;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  it("for any people, prices, extras and either split", () => {
    for (let run = 0; run < 1000; run++) {
      const rows = Array.from({ length: 1 + rand(12) }, () => {
        const who = rand(5);
        return {
          user_id: `u_${who}`,
          name: `P${who}`,
          price_cents: rand(4) === 0 ? null : 500 + rand(1500),
        };
      });
      const total = rand(30000);
      // #789: also with an even-share limit somewhere among the prices.
      const limit = rand(2) === 0 ? null : 500 + rand(1500);
      for (const split of ["exact", "even", null] as const) {
        const r = amounts({ total_cents: total, split, even_limit_cents: limit }, rows);
        expect(sum(r), `run ${run} ${split} ${limit}`).toBe(total);
        for (const p of r.people) expect(p.amount_cents ?? 0).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("the even-share limit (#789 item 8, D17)", () => {
  const order = rows([
    ["Anni", [1000]],
    ["Kim", [2000]],
    ["Pena", [1000]],
  ]);
  const by = (r: ReturnType<typeof amounts>, name: string) => r.people.find((p) => p.name === name);
  it("an even split with a pizza over the limit: that person pays the share plus the part above", () => {
    const r = amounts({ total_cents: 4000, split: "even", even_limit_cents: 1560 }, order);
    expect(r.even_limit_cents).toBe(1560);
    // 440 above the limit; the rest, 3560, evenly: 1186.67 a pizza.
    expect(by(r, "Kim")).toMatchObject({ over_limit_cents: 440, amount_cents: 1627 });
    expect(by(r, "Anni")).toMatchObject({ over_limit_cents: 0, amount_cents: 1187 });
    expect(by(r, "Pena")).toMatchObject({ over_limit_cents: 0, amount_cents: 1186 });
    expect(sum(r)).toBe(4000);
  });
  it("adds up a person's pizzas over the limit, and an unpriced pizza is never over it", () => {
    const r = amounts(
      { total_cents: 6000, split: "even", even_limit_cents: 1500 },
      rows([
        ["Kim", [1800, 1700]],
        ["Anni", [null]],
        ["Pena", [1000]],
      ]),
    );
    expect(by(r, "Kim")?.over_limit_cents).toBe(500);
    expect(by(r, "Anni")?.over_limit_cents).toBe(0);
    // (6000 − 500) / 4 = 1375 a pizza.
    expect(by(r, "Kim")?.amount_cents).toBe(2 * 1375 + 500);
    expect(sum(r)).toBe(6000);
  });
  it("applies only to even: exact amounts are as they were", () => {
    const r = amounts({ total_cents: 4000, split: "exact", even_limit_cents: 1560 }, order);
    expect(r.split).toBe("exact");
    expect(r.people.map((p) => p.amount_cents)).toEqual([1000, 2000, 1000]);
    expect(r.people.every((p) => p.over_limit_cents === 0)).toBe(true);
  });
  it("no limit when no menu price: plain even shares", () => {
    const r = amounts({ total_cents: 4000, split: "even", even_limit_cents: null }, order);
    expect(r.even_limit_cents).toBeNull();
    expect(r.people.map((p) => p.amount_cents)).toEqual([1334, 1333, 1333]);
  });
  it("a limit over every pizza's price leaves even as it is", () => {
    const r = amounts({ total_cents: 4000, split: "even", even_limit_cents: 2500 }, order);
    expect(r.people.map((p) => p.amount_cents)).toEqual([1334, 1333, 1333]);
    expect(r.people.every((p) => p.over_limit_cents === 0)).toBe(true);
  });
  it("is dropped when the part above it would leave the even share negative", () => {
    const r = amounts({ total_cents: 1000, split: "even", even_limit_cents: 500 }, order);
    // 500 + 1500 + 500 above the limit is more than the total: plain even shares.
    expect(r.people.map((p) => p.amount_cents)).toEqual([334, 333, 333]);
    expect(r.people.every((p) => p.over_limit_cents === 0)).toBe(true);
  });
  it("applies to the even fallback too, when a pizza has no price", () => {
    const r = amounts(
      { total_cents: 4000, split: null, even_limit_cents: 1560 },
      rows([
        ["Anni", [null]],
        ["Kim", [2000]],
        ["Pena", [1000]],
      ]),
    );
    expect(r.split).toBe("even");
    expect(by(r, "Kim")?.over_limit_cents).toBe(440);
  });
});
