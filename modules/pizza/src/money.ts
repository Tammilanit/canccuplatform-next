/**
 * Each person's amount (the step 5 plan, Money). Exact: the person's prices plus their share of the
 * extras (the total less the prices: fees add, discounts take away), split per pizza. Even: the
 * total over the order's pizzas, times the person's, as the payment system splits `units` (M2).
 * With even shares, a pizza priced over the order's even-share limit pays the part above it on top
 * of its share, and the rest of the total is split evenly (#789 item 8, D17).
 * Rounded to the cent by the largest remainder, so the amounts always add up to the total; ties go
 * in the order of the person's name. No money moves: these are sums to settle elsewhere.
 */
import type { Split } from "./model.js";

export interface MoneyRow {
  user_id: string | null;
  name: string | null;
  price_cents: number | null;
}

export interface PersonAmount {
  user_id: string | null;
  name: string | null;
  units: number;
  amount_cents: number | null;
  /** With even shares: what their pizzas cost above the even-share limit, in their amount. */
  over_limit_cents: number;
}

export interface Amounts {
  /** The split the amounts follow. */
  split: Split;
  /** Every pizza has a price, so exact is possible. */
  exact_possible: boolean;
  /** The order's total, or the sum of the prices while no total is in (`estimated`). */
  total_cents: number | null;
  estimated: boolean;
  extras_cents: number | null;
  /** The order's even-share limit, null when its menu has no price to average. */
  even_limit_cents: number | null;
  people: PersonAmount[];
}

/** Code-point order, so the same names sort the same on every host and locale. */
export const byName = (a: string | null, b: string | null): number => {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
};

interface Group {
  user_id: string | null;
  name: string | null;
  units: number;
  prices: number;
  /** Σ max(0, price − limit) over the person's priced pizzas. */
  over: number;
}

/** `parts[i] / den` rounded so they add up to `total`, the leftover cents to the largest remainders. */
function largestRemainder(nums: number[], den: number, total: number): number[] {
  const floors = nums.map((n) => Math.floor(n / den));
  let left = total - floors.reduce((s, f) => s + f, 0);
  // The groups come sorted by name, so a stable sort keeps name order among equal remainders.
  const order = nums
    .map((n, i) => ({ i, r: n - (floors[i] ?? 0) * den }))
    .sort((a, b) => b.r - a.r);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left--;
  }
  return floors;
}

export function amounts(
  order: { total_cents: number | null; split: Split | null; even_limit_cents: number | null },
  rows: MoneyRow[],
): Amounts {
  const limit = order.even_limit_cents;
  const groups = new Map<string, Group>();
  for (const r of rows) {
    // An anonymised row (no user id) stays a person of its own: counts and totals keep.
    const key = r.user_id ?? `anon:${String(groups.size)}`;
    const g = groups.get(key) ?? { user_id: r.user_id, name: r.name, units: 0, prices: 0, over: 0 };
    g.units++;
    g.prices += r.price_cents ?? 0;
    if (limit !== null && r.price_cents !== null) g.over += Math.max(0, r.price_cents - limit);
    groups.set(key, g);
  }
  const people = [...groups.values()].sort(
    (a, b) => byName(a.name, b.name) || byName(a.user_id, b.user_id),
  );
  const units = rows.length;
  const priced = rows.every((r) => r.price_cents !== null);
  const exactPossible = units > 0 && priced;
  const priceSum = rows.reduce((s, r) => s + (r.price_cents ?? 0), 0);
  const estimated = order.total_cents === null;
  const total = order.total_cents ?? (exactPossible ? priceSum : null);
  const none = (split: Split): Amounts => ({
    split,
    exact_possible: exactPossible,
    total_cents: total,
    estimated,
    extras_cents: null,
    even_limit_cents: limit,
    people: people.map((p) => ({
      user_id: p.user_id,
      name: p.name,
      units: p.units,
      amount_cents: null,
      over_limit_cents: 0,
    })),
  });
  let split: Split = order.split ?? (exactPossible ? "exact" : "even");
  if (split === "exact" && !exactPossible) split = "even";
  if (total === null || units === 0) return none(split);

  const extras = total - priceSum;
  if (split === "exact") {
    const nums = people.map((p) => p.prices * units + extras * p.units);
    // A discount larger than someone's pizzas would give them a negative amount: stay even.
    if (nums.every((n) => n >= 0)) {
      const cents = largestRemainder(nums, units, total);
      return {
        ...none("exact"),
        extras_cents: extras,
        people: people.map((p, i) => ({
          user_id: p.user_id,
          name: p.name,
          units: p.units,
          amount_cents: cents[i] ?? 0,
          over_limit_cents: 0,
        })),
      };
    }
    split = "even";
  }
  // The part above the limit is each person's own; the rest is shared evenly. A limit that would
  // leave less than nothing to share is dropped (D17).
  const surplus = people.reduce((s, p) => s + p.over, 0);
  const capped = surplus <= total;
  const cents = largestRemainder(
    people.map((p) => (capped ? (total - surplus) * p.units + p.over * units : total * p.units)),
    units,
    total,
  );
  return {
    ...none(split),
    extras_cents: exactPossible ? extras : null,
    people: people.map((p, i) => ({
      user_id: p.user_id,
      name: p.name,
      units: p.units,
      amount_cents: cents[i] ?? 0,
      over_limit_cents: capped ? p.over : 0,
    })),
  };
}
