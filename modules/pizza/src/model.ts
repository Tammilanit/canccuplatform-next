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
}

/** A menu as the API, the CSV and the profile give it: no ids, prices in cents. */
export interface MenuInput {
  items: { number: string; name: string; description: string | null; price_cents: number | null }[];
  base: { name: string; description: string | null; price_cents: number | null } | null;
  toppings: { name: string; description: string | null; price_cents: number | null }[];
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
