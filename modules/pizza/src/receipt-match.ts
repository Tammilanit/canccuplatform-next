/**
 * A receipt read set against the order's pizzas (mockup 18 C): each pizza gets the unit price of
 * the line that names it, by menu number first and then by name. Nothing is resolved silently: a
 * price unlike the pizza's is marked, and a line with no pizza and a pizza with no line are named.
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
}

export interface ReceiptMatch {
  read_at: string;
  total_cents: number | null;
  lines: ReceiptReading["lines"];
  pizzas: MatchedPizza[];
  /** Item lines that cover fewer pizzas than they count (none at all, or too few). */
  unmatched_lines: number[];
  /** Delivery fees and discounts: split per pizza in exact amounts. */
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

export function matchReceipt(reading: ReceiptReading, items: MatchItem[], at: Date): ReceiptMatch {
  const used = reading.lines.map(() => 0);
  const open = (i: number) => {
    const l = reading.lines[i];
    return l !== undefined && l.kind === "item" && (used[i] ?? 0) < Math.max(1, l.quantity);
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
    };
  });
  const extras = reading.lines
    .filter((l) => l.kind === "extra")
    .reduce((s, l) => s + l.amount_cents, 0);
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
      l.kind === "item" && (used[i] ?? 0) < Math.max(1, l.quantity) ? [i] : [],
    ),
    extras_cents: extras,
    adds_up: sum !== null && reading.total_cents !== null && sum === reading.total_cents,
  };
}
