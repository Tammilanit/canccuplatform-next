/**
 * What the AI reader asks and how its answer is taken (the plan, The optional AI reader; #789
 * items 11 and 15): the structured answers' schemas, the fixed instructions sent with the photos,
 * and the answer checked as any outside input (numbers bounded, texts cut to size). The model says
 * itself when a photo is not a receipt or a menu, or cannot be read (`readable`, `reason`), and
 * marks what it is unsure of, so a partly read photo is checked, not refused.
 */
import type { MenuNote, MenuRead, MenuRow, ReceiptLine, ReceiptReading } from "./reader.js";

const nullable = (type: "integer" | "string") => ({ anyOf: [{ type }, { type: "null" }] });

export const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "reason", "total_cents", "lines"],
  properties: {
    readable: { type: "boolean" },
    reason: nullable("string"),
    total_cents: nullable("integer"),
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "number", "name", "quantity", "amount_cents", "kind", "unsure"],
        properties: {
          text: { type: "string" },
          number: nullable("string"),
          name: { type: "string" },
          quantity: { type: "integer" },
          amount_cents: { type: "integer" },
          kind: { type: "string", enum: ["item", "extra"] },
          unsure: { type: "boolean" },
        },
      },
    },
  },
};

const MENU_ROW = {
  type: "object",
  additionalProperties: false,
  required: [
    "page",
    "kind",
    "number",
    "name",
    "description",
    "price_cents",
    "category",
    "category_price_cents",
    "included_toppings",
    "extra_topping_cents",
    "tier",
    "unsure",
  ],
  properties: {
    page: { type: "integer" },
    kind: { type: "string", enum: ["item", "base", "topping"] },
    number: nullable("string"),
    name: { type: "string" },
    description: nullable("string"),
    price_cents: nullable("integer"),
    category: nullable("string"),
    category_price_cents: nullable("integer"),
    included_toppings: nullable("integer"),
    extra_topping_cents: nullable("integer"),
    tier: { anyOf: [{ type: "string", enum: ["normal", "special"] }, { type: "null" }] },
    unsure: { type: "boolean" },
  },
};

export const MENU_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "reason", "rows", "notes"],
  properties: {
    readable: { type: "boolean" },
    reason: nullable("string"),
    rows: { type: "array", items: MENU_ROW },
    notes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "text", "page"],
        properties: {
          kind: { type: "string", enum: ["campaign", "lunch"] },
          text: { type: "string" },
          page: { type: "integer" },
        },
      },
    },
  },
};

const READABLE = `If the photo is not of this kind, or is too blurred, dark or cut off to read, set readable to false and give the reason in one short sentence a person can act on (for example "The photo is blurred: hold the phone still."); otherwise set readable to true and reason to null.`;

export const RECEIPT_TEXT = `This is a photo of a receipt from a pizzeria or a restaurant.
Read every line that was paid for. For each line give its text as printed, the menu number when the line shows one (else null), the item's name, the quantity, the line's amount in euro cents (a discount is negative), and kind: "item" for food or drink, "extra" for a delivery fee, a service fee or a discount. Set unsure to true when the photo does not make the line's amount or number clear.
Give total_cents, the total paid in euro cents, or null when the photo does not show it.
Use only what the photo shows. Leave out card numbers, names and anything that is not a paid line.
${READABLE}`;

export const MENU_TEXT = `These are photos of the pages of a pizzeria's or a restaurant's menu, in order, one menu. Page 1 is the first photo.
Read each page in reading order: a page in two columns is the left column from top to bottom, then the right column; then the next page.
List every item that has a menu number as a row of kind "item": its page, the number as printed, the name, the ingredients or description (null when none), and the price in euro cents (null when the item shows no price of its own).
A heading can name a category of items and give them one price ("Kebab pizzas 13,90€"). Give every item the category it is under (null when none), and the heading's price in category_price_cents on the items right under the heading (else null). A category runs on until the next heading, also into the next column and onto the next page.
An own pizza ("Fantasia", "choose 3 toppings") is one row of kind "base": its name, its price, included_toppings (how many toppings its price includes, null when it does not say) and extra_topping_cents (the price of each further topping, null when not shown). Each topping listed for it is a row of kind "topping" with its extra price; tier is "special" for toppings that cost extra (a line such as "Special toppings 2,50€", whose price each of them takes) and "normal" otherwise. For items and bases tier is null; for items and toppings included_toppings and extra_topping_cents are null.
A dated campaign ("Campaign 14.6–15.9: all pizzas 11,90€") and lunch prices are never prices of the menu: list each in notes with kind "campaign" or "lunch", its text as printed and its page, and leave them out of the rows.
Set unsure to true when the photos do not make a row's number, name or price clear.
Use only what the photos show.
${READABLE}`;

const cut = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const cents = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** The model's own word that it could not read the photo: its reason, or null when it read it. */
export function unreadable(raw: unknown): string | null {
  const r = (raw ?? {}) as { readable?: unknown; reason?: unknown };
  if (r.readable !== false) return null;
  const reason = cut(r.reason, 200);
  return reason === "" ? "The photo could not be read." : reason;
}

export function receiptOf(raw: unknown): ReceiptReading {
  const r = (raw ?? {}) as { total_cents?: unknown; lines?: unknown };
  const lines: ReceiptLine[] = (Array.isArray(r.lines) ? r.lines : [])
    .slice(0, 100)
    .flatMap((l) => {
      const x = (l ?? {}) as Record<string, unknown>;
      const amount = cents(x.amount_cents, -500_000, 500_000);
      if (amount === null) return [];
      const number = cut(x.number, 8);
      return [
        {
          text: cut(x.text, 120),
          number: number === "" ? null : number,
          name: cut(x.name, 80),
          quantity: cents(x.quantity, 1, 99) ?? 1,
          amount_cents: amount,
          kind: x.kind === "extra" ? ("extra" as const) : ("item" as const),
          unsure: x.unsure === true,
        },
      ];
    });
  return { total_cents: cents(r.total_cents, 0, 500_000), lines };
}

const KINDS = ["item", "base", "topping"] as const;
const page = (v: unknown, pages: number): number =>
  Math.min(Math.max(cents(v, 1, 1000) ?? 1, 1), Math.max(1, pages));
const orNull = (v: string): string | null => (v === "" ? null : v);

/** The model's menu, checked: a row it gives without what its kind needs is left out. */
export function menuOf(raw: unknown, pages: number): MenuRead {
  const r = (raw ?? {}) as { rows?: unknown; notes?: unknown };
  const rows: MenuRow[] = (Array.isArray(r.rows) ? r.rows : []).slice(0, 300).flatMap((i) => {
    const x = (i ?? {}) as Record<string, unknown>;
    const kind = KINDS.find((k) => k === x.kind) ?? "item";
    const number = kind === "item" ? orNull(cut(x.number, 8)) : null;
    const name = cut(x.name, 80);
    if (name === "" || (kind === "item" && number === null)) return [];
    const base = kind === "base";
    return [
      {
        page: page(x.page, pages),
        kind,
        number,
        name,
        description: orNull(cut(x.description, 300)),
        price_cents: cents(x.price_cents, 0, 99_999),
        category: kind === "item" ? orNull(cut(x.category, 60)) : null,
        category_price_cents: kind === "item" ? cents(x.category_price_cents, 0, 99_999) : null,
        included_toppings: base ? cents(x.included_toppings, 0, 10) : null,
        extra_topping_cents: base ? cents(x.extra_topping_cents, 0, 99_999) : null,
        tier: kind === "topping" && (x.tier === "normal" || x.tier === "special") ? x.tier : null,
        unsure: x.unsure === true,
      },
    ];
  });
  const notes: MenuNote[] = (Array.isArray(r.notes) ? r.notes : []).slice(0, 20).flatMap((n) => {
    const x = (n ?? {}) as Record<string, unknown>;
    const text = cut(x.text, 200);
    if ((x.kind !== "campaign" && x.kind !== "lunch") || text === "") return [];
    return [{ kind: x.kind, text, page: page(x.page, pages) }];
  });
  return { rows, notes };
}
