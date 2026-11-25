/** An order's money as the pages read it from the API, and euros as people read and type them. */
import type { ReceiptMatch } from "../receipt-match.js";
import type { PageCtx } from "./kit.js";

export interface MoneyPerson {
  user_id: string | null;
  name: string | null;
  units: number;
  amount_cents: number | null;
  /** Even shares: the part above the even-share limit, in the amount (#789). */
  over_limit_cents: number;
  /** Null where there is no mark: settled through the organiser, or the payer themselves. */
  paid: boolean | null;
}

export interface ReceiptView {
  id: string;
  type: string;
  added_at: string;
  added_by: { user_id: string; name: string | null } | null;
  read: ReceiptMatch | null;
}

export interface PayTo {
  user_id: string;
  name: string | null;
  mobilepay: string | null;
  iban: string | null;
}

/** GET /api/pizza/orders/{id}/money (contracts/pizza.md, Money). */
export interface MoneyView {
  order_id: string;
  payer: { user_id: string; name: string | null } | null;
  total_cents: number | null;
  total_set_at: string | null;
  total_set_by: { name: string } | null;
  total_receipt_id: string | null;
  split: "exact" | "even" | null;
  split_effective: "exact" | "even";
  exact_possible: boolean;
  estimated: boolean;
  extras_cents: number | null;
  even_limit_cents: number | null;
  settle_to: "organiser" | "payer";
  total_effective_cents: number | null;
  people: MoneyPerson[];
  pay_to: PayTo | null;
  receipts: ReceiptView[];
  prices: { item_id: string; user_id: string | null; label: string; price_cents: number | null }[];
}

/** "€38.50" in English, "38,50 €" in Finnish; a minus sign for a discount. */
export function euro(c: Pick<PageCtx, "lang">, cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return c.lang === "fi" ? `${sign}${text.replace(".", ",")} €` : `${sign}€${text}`;
}

/** What someone typed on the amount pad ("38,5", "€38.50"), in cents, or null. */
export function parseEuro(text: string | null): number | null {
  if (text === null) return null;
  const t = text.replace(/[€\s]/g, "").replace(",", ".");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  const [whole = "0", part = ""] = t.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}

/** "2 pizzas", "1 pizza". */
export const pizzasOf = (c: Pick<PageCtx, "t">, n: number) =>
  n === 1 ? c.t("money.one_pizza") : c.t("money.pizzas", { n });
