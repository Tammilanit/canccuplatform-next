/**
 * A menu read's rows after the read (#789 items 3–6, 15; D12, D15): a category's price given to
 * its items without one, toppings gathered from the pizzas' ingredients when the menu lists none,
 * the rows of a later read merged in, and the menu CSV the import's preview takes. Pure: the rows
 * travel in the page's form between requests, so nothing is kept here.
 */
import { csvLine, euros } from "./csv.js";
import type { MenuRow } from "./reader.js";

const fold = (s: string): string => s.trim().toLocaleLowerCase("fi");

/**
 * Each item without a price of its own takes its category's price, wherever the heading was: the
 * left column's heading still prices the right column's top and the next page. An item's own
 * price always wins.
 */
export function applyCategories(rows: MenuRow[]): MenuRow[] {
  const prices = new Map<string, number>();
  for (const r of rows)
    if (r.category !== null && r.category_price_cents !== null && !prices.has(fold(r.category)))
      prices.set(fold(r.category), r.category_price_cents);
  return rows.map((r) => {
    const price = r.category === null ? undefined : prices.get(fold(r.category));
    if (price === undefined || r.kind !== "item") return r;
    if (r.price_cents !== null && r.price_from_category !== true)
      return { ...r, category_price_cents: price };
    return { ...r, category_price_cents: price, price_cents: price, price_from_category: true };
  });
}

/** An ingredient list's parts: split at commas and "and"/"ja", e.g. "kinkku, ananas ja aurajuusto". */
const parts = (description: string): string[] =>
  description
    .split(/,|\s+(?:ja|and|&)\s+/i)
    .map((p) => p.trim())
    .filter((p) => p !== "" && p.length <= 40);

const capital = (s: string): string => s.charAt(0).toLocaleUpperCase("fi") + s.slice(1);

/**
 * A menu with an own pizza but no normal toppings: the ingredients found on at least two pizzas
 * become its toppings, marked unsure and gathered, for the crew to confirm or delete in the table.
 */
export function gatherToppings(rows: MenuRow[]): MenuRow[] {
  const base = rows.find((r) => r.kind === "base");
  if (base === undefined) return rows;
  if (rows.some((r) => r.kind === "topping" && r.tier !== "special")) return rows;
  const taken = new Set(rows.filter((r) => r.kind === "topping").map((r) => fold(r.name)));
  const seen = new Map<string, { name: string; pizzas: number; page: number }>();
  for (const r of rows) {
    if (r.kind !== "item" || r.description === null) continue;
    for (const key of new Set(parts(r.description).map(fold))) {
      const had = seen.get(key);
      if (had === undefined) seen.set(key, { name: capital(key), pizzas: 1, page: r.page });
      else had.pizzas += 1;
    }
  }
  const gathered: MenuRow[] = [...seen.entries()]
    .filter(([key, g]) => g.pizzas >= 2 && !taken.has(key))
    .map(([, g]) => ({
      page: g.page,
      kind: "topping",
      number: null,
      name: g.name.slice(0, 80),
      description: null,
      price_cents: null,
      category: null,
      category_price_cents: null,
      included_toppings: null,
      extra_topping_cents: null,
      tier: "normal",
      unsure: true,
      gathered: true,
    }));
  return [...rows, ...gathered];
}

const sameRow = (a: MenuRow, b: MenuRow): boolean =>
  a.number !== null || b.number !== null
    ? a.number !== null && a.number === b.number
    : a.kind === b.kind && fold(a.name) === fold(b.name);

/**
 * The rows of "Add more pages" added to the table: a row with the same number, or with no number
 * and the same name, is merged into the one already there (whose values stay); a different price
 * keeps the old one and names the row in `conflicts`, so the table highlights it.
 */
export function mergeRows(
  old: MenuRow[],
  added: MenuRow[],
): { rows: MenuRow[]; conflicts: number[] } {
  const rows = [...old];
  const conflicts: number[] = [];
  for (const a of added) {
    const at = rows.findIndex((r) => sameRow(r, a));
    if (at === -1) {
      rows.push(a);
      continue;
    }
    const had = rows[at] as MenuRow;
    if (had.price_cents === null && a.price_cents !== null)
      rows[at] = { ...had, price_cents: a.price_cents };
    else if (a.price_cents !== null && a.price_cents !== had.price_cents && !conflicts.includes(at))
      conflicts.push(at);
  }
  return { rows, conflicts };
}

const MENU_CSV_COLUMNS = [
  "pizzeria",
  "kind",
  "number",
  "name",
  "description",
  "price",
  "category",
  "category_price",
  "included_toppings",
  "extra_topping_price",
  "tier",
];

const money = (c: number | null): string => (c === null ? "" : euros(c));

/**
 * The rows as a menu CSV for the import's preview: an item priced by its category leaves `price`
 * empty and gives `category_price`, which the import then takes (contracts/pizza.md, The menu CSV).
 */
export function rowsToCsv(pizzeria: string, rows: MenuRow[]): string {
  const lines = rows.map((r) =>
    csvLine([
      pizzeria,
      r.kind,
      r.number ?? "",
      r.name,
      r.description ?? "",
      r.price_from_category === true ? "" : money(r.price_cents),
      r.category ?? "",
      money(r.category_price_cents),
      r.included_toppings === null ? "" : String(r.included_toppings),
      money(r.extra_topping_cents),
      r.tier === "special" ? "special" : "",
    ]),
  );
  return [MENU_CSV_COLUMNS.join(","), ...lines, ""].join("\n");
}

/**
 * A price as a person types it on a Finnish menu: "13,90€", "€ 13,90", "13.90 €" or "13"; null
 * when empty or not a price from 0 to 999.99.
 */
export function priceCents(text: string): number | null {
  const m = /^\s*€?\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*€?\s*$/.exec(text);
  if (m === null) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
