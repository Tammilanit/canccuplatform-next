/** The shapes the module's parts share: a menu entry, a menu, an order's and a row's states. */

export type EntryKind = "item" | "base" | "topping";

/** One line of a pizzeria's menu: an item, the own pizza's base or a topping. */
export interface MenuEntry {
  id: string;
  kind: EntryKind;
  /** The menu number; items only. */
  number: string | null;
  name: string;
  description: string | null;
  price_cents: number | null;
  /** Items only: the menu's heading the item is under (#789 item 4). */
  category: string | null;
  /** The base only: the toppings its price includes; null prices every topping (#789 item 6). */
  included_toppings: number | null;
  /** The base only: each topping's price past the included ones. */
  extra_topping_cents: number | null;
  /** Toppings only: `special` costs extra even within the included count; null is normal. */
  tier: Tier | null;
}

export type Tier = "normal" | "special";

type Line = { name: string; description: string | null; price_cents: number | null };

/**
 * A menu as the API, the CSV and the profile give it: no ids, prices in cents. The fields of #789
 * are there only when set, so an old menu reads as before.
 */
export interface MenuInput {
  items: (Line & { number: string; category?: string })[];
  base: (Line & { included_toppings?: number; extra_topping_cents?: number }) | null;
  toppings: (Line & { tier?: "special" })[];
}

export type Service = "delivery" | "takeaway";

export type OrderState = "open" | "closed" | "placed" | "arrived" | "done" | "cancelled";

/** Not called in yet: the states the one-per-pizzeria and one-held-per-person rules count. */
export const UNPLACED: readonly OrderState[] = ["open", "closed"];
/** Called in: the states the record totals and the export takes. */
export const CALLED_IN: readonly OrderState[] = ["placed", "arrived", "done"];

export type Split = "exact" | "even";
export type SettleTo = "organiser" | "payer";
export type DoneReason = "handed_out" | "holder" | "timer";
export type ItemKind = "menu" | "custom" | "text";
