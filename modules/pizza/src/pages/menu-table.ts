/**
 * A menu read's table as its form carries it (#789 items 3 and 15; D10): every row's fields as
 * `row[i][field]` and the notes as `note[i][field]`, so adding, deleting and merging rows and
 * reading more pages keep nothing on the server between requests (the view is
 * menu-table-views.ts). An unsure value, a price from the category, a gathered topping and a price
 * another read gave differently travel as the row's `flags`.
 */
import { euros } from "../csv.js";
import { priceCents } from "../menu-rows.js";
import type { MenuNote, MenuRow } from "../reader.js";

export interface Table {
  rows: MenuRow[];
  notes: MenuNote[];
  /** Rows whose price a later read gave differently (`mergeRows`). */
  conflicts: number[];
}

const money = (c: number | null): string => (c === null ? "" : euros(c));

/** The table as its form's fields: what the page's script posts, and the table's hidden inputs. */
export function tableFields(t: Table): Record<string, string> {
  const f: Record<string, string> = {};
  t.rows.forEach((r, i) => {
    const at = (k: string, v: string) => (f[`row[${i}][${k}]`] = v);
    const flags = [...flagsOf(r), ...(t.conflicts.includes(i) ? ["conflict"] : [])];
    at("kind", r.kind);
    at("page", String(r.page));
    at("number", r.number ?? "");
    at("name", r.name);
    at("description", r.description ?? "");
    at("price", money(r.price_cents));
    at("category", r.category ?? "");
    at("category_price", money(r.category_price_cents));
    at("included", r.included_toppings === null ? "" : String(r.included_toppings));
    at("extra", money(r.extra_topping_cents));
    at("tier", r.tier ?? "");
    at("flags", flags.join(","));
  });
  t.notes.forEach((n, i) => {
    f[`note[${i}][kind]`] = n.kind;
    f[`note[${i}][text]`] = n.text;
    f[`note[${i}][page]`] = String(n.page);
  });
  return f;
}

const flagsOf = (r: MenuRow): string[] =>
  [
    r.unsure && "unsure",
    r.price_from_category === true && "from_category",
    r.gathered === true && "gathered",
  ].filter((x): x is string => typeof x === "string");

const text = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const whole = (v: unknown, min: number, max: number): number | null => {
  const n = Number(text(v, 6));
  return text(v, 6) !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/**
 * The table back from its form, rows in the order of their indices (the page's script deletes a
 * row in place, leaving a gap); a row left wholly empty is dropped, at most 300 rows.
 */
export function tableOf(body: Record<string, unknown>): Table {
  const rows: MenuRow[] = [];
  const conflicts: number[] = [];
  const indices = [
    ...new Set(
      Object.keys(body).flatMap((k) => {
        const m = /^row\[(\d{1,4})\]\[/.exec(k);
        return m === null ? [] : [Number(m[1])];
      }),
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, 300);
  for (const i of indices) {
    const v = (k: string) => body[`row[${i}][${k}]`];
    const kind =
      v("kind") === "base" || v("kind") === "topping" ? (v("kind") as MenuRow["kind"]) : "item";
    const name = text(v("name"), 80);
    const number = text(v("number"), 8);
    const priceText = text(v("price"), 20);
    if (name === "" && number === "" && priceText === "") continue;
    const flags = new Set(text(v("flags"), 60).split(","));
    const price = priceCents(priceText);
    const categoryPrice = priceCents(text(v("category_price"), 20));
    const fromCategory = flags.has("from_category") && price !== null && price === categoryPrice;
    const tier = v("tier");
    if (flags.has("conflict")) conflicts.push(rows.length);
    rows.push({
      page: whole(v("page"), 1, 1000) ?? 1,
      kind,
      number: kind === "item" && number !== "" ? number : null,
      name,
      description: text(v("description"), 300) || null,
      price_cents: price,
      category: kind === "item" ? text(v("category"), 60) || null : null,
      category_price_cents: kind === "item" ? categoryPrice : null,
      included_toppings: kind === "base" ? whole(v("included"), 0, 10) : null,
      extra_topping_cents: kind === "base" ? priceCents(text(v("extra"), 20)) : null,
      tier: kind === "topping" ? (tier === "special" ? "special" : "normal") : null,
      // A price that is not a price is kept as none, and marked for a look.
      unsure: flags.has("unsure") || (priceText !== "" && price === null),
      ...(fromCategory ? { price_from_category: true } : {}),
      ...(flags.has("gathered") ? { gathered: true } : {}),
    });
  }
  const notes: MenuNote[] = [];
  for (let i = 0; i < 20; i++) {
    const kind = body[`note[${i}][kind]`];
    if (kind !== "campaign" && kind !== "lunch") break;
    notes.push({
      kind,
      text: text(body[`note[${i}][text]`], 200),
      page: whole(body[`note[${i}][page]`], 1, 1000) ?? 1,
    });
  }
  return { rows, notes, conflicts };
}

const blank = (page: number): MenuRow => ({
  page,
  kind: "item",
  number: null,
  name: "",
  description: null,
  price_cents: null,
  category: null,
  category_price_cents: null,
  included_toppings: null,
  extra_topping_cents: null,
  tier: null,
  unsure: false,
});

/** Without `at`, the conflicts after removing row `at` (their indices move up). */
const without = (conflicts: number[], at: number) =>
  conflicts.filter((c) => c !== at).map((c) => (c > at ? c - 1 : c));

/** A row added, deleted, or merged into another (`add`, `delete:<i>`, `merge:<into>:<from>`). */
export function act(t: Table, action: string): Table {
  const [verb, a, b] = action.split(":");
  const i = Number(a);
  const j = Number(b);
  const valid = (n: number) => Number.isInteger(n) && n >= 0 && n < t.rows.length;
  if (verb === "add") {
    const page = Math.max(1, ...t.rows.map((r) => r.page));
    return { ...t, rows: [...t.rows, blank(page)] };
  }
  if (verb === "delete" && valid(i))
    return { ...t, rows: t.rows.filter((_, k) => k !== i), conflicts: without(t.conflicts, i) };
  if (verb === "merge" && valid(i) && valid(j) && i !== j) {
    const into = t.rows[i] as MenuRow;
    const from = t.rows[j] as MenuRow;
    const merged: MenuRow = {
      ...into,
      number: into.number ?? from.number,
      description: into.description ?? from.description,
      price_cents: into.price_cents ?? from.price_cents,
      category: into.category ?? from.category,
      unsure: into.unsure || from.unsure,
    };
    const rows = t.rows.map((r, k) => (k === i ? merged : r)).filter((_, k) => k !== j);
    return { ...t, rows, conflicts: without(t.conflicts, j) };
  }
  return t;
}
