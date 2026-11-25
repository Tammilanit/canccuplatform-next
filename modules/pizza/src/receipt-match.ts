/**
 * A receipt read set against the order's pizzas (mockup 18 C): each pizza gets the unit price of
 * the line that names it, by menu number first and then by name. Nothing is resolved silently: a
 * price unlike the pizza's is marked, and a line with no pizza and a pizza with no line are named.
 * A group line ("15 × pizza €195", #789 item 9) names no item: it covers the pizzas no other line
 * names, each keeping its own price (or the line's unit price, "à €13,00"), and the difference is
 * shared per pizza with the extras; a count unlike those pizzas is named.
 * This is only a suggestion; the order's money changes when the holder confirms it.
 */
import type { ReceiptReading } from "./reader.js";

export interface MatchItem {
  id: string;
  user_id: string | null;
  name: string | null;
  label: string;
  number: string | null;
  price_cents: number | null;
}

export interface MatchedPizza {
  item_id: string;
  user_id: string | null;
  name: string | null;
  label: string;
  /** The pizza's price now: the menu's, or one set by hand. */
  price_cents: number | null;
  /** The receipt's unit price for it, or null when no line names it. */
  suggested_cents: number | null;
  /** The receipt line it matched (an index into `lines`), or null. */
  line: number | null;
  differs: boolean;
  /** Covered by a group line; absent on reads kept before #789. */
  group?: boolean;
}

export interface ReceiptMatch {
  read_at: string;
  total_cents: number | null;
  lines: ReceiptReading["lines"];
  pizzas: MatchedPizza[];
  /** Item lines that cover fewer pizzas than they count (none at all, or too few). */
  unmatched_lines: number[];
  /** Group lines whose count is unlike the pizzas left for them; absent on reads kept before #789. */
  group_count_mismatch?: { line: number; count: number; pizzas: number }[];
  /** Delivery fees and discounts, and what group lines cost beyond their pizzas' prices: split per pizza in exact amounts. */
  extras_cents: number;
  /** The suggested prices and the extras make the total. */
  adds_up: boolean;
}

/** The `nth` (from 0) unit's share of a line's amount: the first `amount mod quantity` get a cent more. */
function unitCents(amount: number, quantity: number, nth: number): number {
  const base = Math.floor(amount / quantity);
  return base + (nth < amount - base * quantity ? 1 : 0);
}

const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** "#12 Kebab" → "kebab"; "Other: garlic bread" → "garlic bread". */
const nameOf = (label: string) => fold(label.replace(/^#\S+\s+/, "").replace(/^other:\s*/i, ""));

type Line = ReceiptReading["lines"][number];

/** What a receipt calls a pizza without naming one, in English and Finnish. */
const GENERIC = /^(pizza|pizzas|pizzaa|pizzat|pizzoja)$/;
const isGroup = (l: Line) =>
  l.kind === "item" && (l.group === true || (l.number === null && GENERIC.test(fold(l.name))));
/** "à €13,00", "a 13,00", "á 13.00 €", "@ 13" in the line's text, in cents. */
const UNIT = /(?:^|\s)(?:à|á|a|@)\s*€?\s*(\d{1,4})(?:[.,](\d{2}))?(?=\s|€|$)/i;
function unitOf(l: Line): number | null {
  if (typeof l.unit_cents === "number") return l.unit_cents;
  const m = UNIT.exec(l.text);
  return m === null ? null : Number(m[1]) * 100 + Number(m[2] ?? "0");
}

export function matchReceipt(reading: ReceiptReading, items: MatchItem[], at: Date): ReceiptMatch {
  const used = reading.lines.map(() => 0);
  const open = (i: number) => {
    const l = reading.lines[i];
    return (
      l !== undefined &&
      l.kind === "item" &&
      !isGroup(l) &&
      (used[i] ?? 0) < Math.max(1, l.quantity)
    );
  };
  const find = (test: (l: ReceiptReading["lines"][number]) => boolean) =>
    reading.lines.findIndex((l, i) => open(i) && test(l));
  const pizzas = items.map((item): MatchedPizza => {
    let line =
      item.number === null
        ? -1
        : find((l) => l.number !== null && fold(l.number) === fold(item.number ?? ""));
    if (line < 0) line = find((l) => fold(l.name) === nameOf(item.label));
    const hit = line < 0 ? undefined : reading.lines[line];
    if (hit !== undefined) used[line] = (used[line] ?? 0) + 1;
    // A line's amount rarely divides evenly (2 × 25.01 is 50.02): the remainder cents go to the
    // line's first pizzas, one each, so the pizzas add up to the line.
    const nth = hit === undefined ? 0 : (used[line] ?? 1) - 1;
    const suggested =
      hit === undefined ? null : unitCents(hit.amount_cents, Math.max(1, hit.quantity), nth);
    return {
      item_id: item.id,
      user_id: item.user_id,
      name: item.name,
      label: item.label,
      price_cents: item.price_cents,
      suggested_cents: suggested,
      line: hit === undefined ? null : line,
      differs: suggested !== null && suggested !== item.price_cents,
      group: false,
    };
  });
  // Group lines take the pizzas no line named, in order; the last one takes what is left, so its
  // count is checked against all of them.
  let pool = pizzas.filter((p) => p.line === null);
  let groupExtras = 0;
  const mismatch: { line: number; count: number; pizzas: number }[] = [];
  const groups = reading.lines.flatMap((l, i) => (isGroup(l) ? [i] : []));
  groups.forEach((i, k) => {
    const l = reading.lines[i] as Line;
    const count = Math.max(1, l.quantity);
    const left = pool.length;
    const covered = pool.slice(0, count);
    pool = pool.slice(count);
    const pizzasFor = k === groups.length - 1 ? left : covered.length;
    if (pizzasFor !== count) mismatch.push({ line: i, count, pizzas: pizzasFor });
    used[i] = covered.length;
    const unit = unitOf(l);
    const own = unit === null && covered.every((p) => p.price_cents !== null);
    covered.forEach((p, nth) => {
      p.line = i;
      p.group = true;
      p.suggested_cents =
        unit ?? (own ? p.price_cents : unitCents(l.amount_cents, covered.length, nth));
      p.differs = p.suggested_cents !== p.price_cents;
    });
    if (covered.length > 0)
      groupExtras += l.amount_cents - covered.reduce((s, p) => s + (p.suggested_cents ?? 0), 0);
  });
  const extras =
    reading.lines.filter((l) => l.kind === "extra").reduce((s, l) => s + l.amount_cents, 0) +
    groupExtras;
  const priced = pizzas.map((p) => p.suggested_cents ?? p.price_cents);
  const sum = priced.includes(null)
    ? null
    : priced.reduce((s: number, p) => s + (p ?? 0), 0) + extras;
  return {
    read_at: at.toISOString(),
    total_cents: reading.total_cents,
    lines: reading.lines,
    pizzas,
    unmatched_lines: reading.lines.flatMap((l, i) =>
      l.kind === "item" && !isGroup(l) && (used[i] ?? 0) < Math.max(1, l.quantity) ? [i] : [],
    ),
    group_count_mismatch: mismatch,
    extras_cents: extras,
    adds_up: sum !== null && reading.total_cents !== null && sum === reading.total_cents,
  };
}
