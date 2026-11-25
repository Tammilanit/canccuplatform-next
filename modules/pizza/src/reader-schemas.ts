/**
 * What the AI reader asks and how its answer is taken (the plan, The optional AI reader; #789
 * items 11 and 15): the structured answers' schemas, the fixed instructions sent with the photos,
 * and the answer checked as any outside input (numbers bounded, texts cut to size). The model says
 * itself when a photo is not a receipt or a menu, or cannot be read (`readable`, `reason`), and
 * marks what it is unsure of, so a partly read photo is checked, not refused.
 */
import type { MenuRead, ReceiptLine, ReceiptReading } from "./reader.js";

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

export const MENU_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "reason", "items"],
  properties: {
    readable: { type: "boolean" },
    reason: nullable("string"),
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "name", "description", "price_cents", "unsure"],
        properties: {
          number: { type: "string" },
          name: { type: "string" },
          description: nullable("string"),
          price_cents: nullable("integer"),
          unsure: { type: "boolean" },
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

export const MENU_TEXT = `These are photos of the pages of a pizzeria's or a restaurant's menu, in order, one menu.
List every item that has a menu number: the number as printed, the name, the ingredients or description (null when none), and the price in euro cents (null when none is shown).
Set unsure to true when the photos do not make the number, the name or the price clear.
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

export function menuOf(raw: unknown): MenuRead {
  const items = ((raw ?? {}) as { items?: unknown }).items;
  return {
    items: (Array.isArray(items) ? items : []).slice(0, 300).flatMap((i) => {
      const x = (i ?? {}) as Record<string, unknown>;
      const number = cut(x.number, 8);
      const name = cut(x.name, 80);
      if (number === "" || name === "") return [];
      const description = cut(x.description, 300);
      return [
        {
          number,
          name,
          description: description === "" ? null : description,
          price_cents: cents(x.price_cents, 0, 99_999),
          unsure: x.unsure === true,
        },
      ];
    }),
  };
}
