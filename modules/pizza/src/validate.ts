/**
 * The legacy request checks, ported (`validate.ts` of the signup site): every failure is a 400
 * `invalid_request` that names its field. Menus gained prices and descriptions (D7 B, D10).
 */
import { KitError } from "@canccu/kit";
import type { ErrorBody } from "@canccu/kit";
import type { ItemKind, MenuEntry, MenuInput } from "./model.js";

export class InvalidBody extends KitError {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`, { status: 400, code: "invalid_request" });
  }
  override toBody(): ErrorBody {
    const body = super.toBody();
    return { error: { ...body.error, field: this.field } } as ErrorBody;
  }
}

export const bad = (field: string, message: string): never => {
  throw new InvalidBody(field, message);
};

export const LIMITS = {
  note: 120,
  comment: 120,
  text: 80,
  number: 8,
  name: 80,
  description: 300,
  pizzeria: 80,
  phone: 40,
  website: 300,
  toppings: 6,
  orderNote: 200,
  pickup: 80,
  reason: 200,
  category: 60,
  includedToppings: 10,
} as const;

/** Trimmed text, `null` when empty or absent. */
export function optionalText(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return bad(field, "must be a string");
  const t = v.trim();
  if (t.length > max) return bad(field, `at most ${max} characters`);
  return t === "" ? null : t;
}

export function requiredText(v: unknown, field: string, max: number): string {
  return optionalText(v, field, max) ?? bad(field, "required");
}

/** RFC 3339 (the contract's `date-time`): without its offset, `Date` would read a time in the host's zone. */
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function parseTime(v: unknown, field: string): Date {
  const ok = typeof v === "string" && RFC3339.test(v);
  const t = ok ? new Date(v) : null;
  if (t === null || Number.isNaN(t.getTime())) return bad(field, "must be an RFC 3339 time");
  return t;
}

/** What the pizzeria was paid, in cents (the legacy bill's range). */
export function parseTotal(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 500_000) {
    return bad("total_cents", "must be an integer from 0 to 500000");
  }
  return v;
}

/** A price in cents, 0 to 999.99 euros, or null for none. */
/**
 * A price that must be given: absent is 400, and only an explicit null clears it, so a misspelt
 * field never deletes a stored price (the contract's `required: [price_cents]`).
 */
export function requiredPrice(b: Record<string, unknown>, field: string): number | null {
  if (!Object.hasOwn(b, field)) return bad(field, "is required; null clears the price");
  return parsePrice(b[field], field);
}

export function parsePrice(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 99_999) {
    return bad(field, "must be an integer from 0 to 99999, or null");
  }
  return v;
}

export function parseWebsite(v: unknown, field = "website"): string | null {
  const t = optionalText(v, field, LIMITS.website);
  if (t === null) return null;
  let url: URL | null;
  try {
    url = new URL(t);
  } catch {
    url = null;
  }
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return bad(field, "must be an http or https URL");
  }
  return t;
}

export interface ItemInput {
  kind: ItemKind;
  menu_item_id: string | null;
  toppings: string[] | null;
  text: string | null;
  note: string | null;
  comment: string | null;
}

/** The pizzeria's live menu, which new picks come from (E7). */
export interface PizzeriaMenu {
  items: MenuEntry[];
  base: MenuEntry | null;
  toppings: MenuEntry[];
}

export function parseItemBody(body: unknown, ctx: PizzeriaMenu): ItemInput {
  if (typeof body !== "object" || body === null) return bad("body", "must be an object");
  const b = body as Record<string, unknown>;
  const note = optionalText(b.note, "note", LIMITS.note);
  const comment = optionalText(b.comment, "comment", LIMITS.comment);
  const base = { menu_item_id: null, toppings: null, text: null, note, comment };
  if (b.kind === "menu") {
    const id = b.menu_item_id;
    if (typeof id !== "string" || !ctx.items.some((m) => m.id === id)) {
      return bad("menu_item_id", "must be an item on the order's pizzeria's menu");
    }
    return { ...base, kind: "menu", menu_item_id: id };
  }
  if (b.kind === "custom") {
    if (ctx.base === null) return bad("kind", "this pizzeria has no own pizza");
    if (
      !Array.isArray(b.toppings) ||
      b.toppings.length < 1 ||
      b.toppings.length > LIMITS.toppings
    ) {
      return bad("toppings", `1 to ${LIMITS.toppings} toppings`);
    }
    const names: string[] = [];
    for (const t of b.toppings as unknown[]) {
      const want = typeof t === "string" ? t.trim().toLowerCase() : null;
      const hit = ctx.toppings.find((x) => x.name.toLowerCase() === want);
      if (hit === undefined) return bad("toppings", `${String(t)} is not on this pizzeria's list`);
      if (names.includes(hit.name)) return bad("toppings", "no duplicates");
      names.push(hit.name);
    }
    return { ...base, kind: "custom", toppings: names };
  }
  if (b.kind === "text") {
    const text = optionalText(b.text, "text", LIMITS.text);
    if (text === null) return bad("text", `1 to ${LIMITS.text} characters`);
    return { ...base, kind: "text", text };
  }
  return bad("kind", "must be menu, custom or text");
}

export interface Snapshot {
  menu_item_id: string | null;
  number: string | null;
  label: string;
  description: string | null;
  toppings: string[] | null;
  text: string | null;
  price_cents: number | null;
}

/**
 * The own pizza's price (#789 item 6, D14). A base that includes N toppings (a "Fantasia") costs
 * its price, plus the extra-topping price for each normal topping past N, plus each special
 * topping's own price; specials never use up an included one. Without N, as before: the base plus
 * each topping's price. Any price it needs that the menu lacks leaves the pizza unpriced.
 */
export function ownPizzaPrice(
  base: Pick<MenuEntry, "price_cents" | "included_toppings" | "extra_topping_cents">,
  chosen: Pick<MenuEntry, "price_cents" | "tier">[],
): number | null {
  const sum = (ps: (number | null)[]) =>
    ps.some((p) => p === null) ? null : ps.reduce<number>((s, p) => s + (p ?? 0), 0);
  if (base.included_toppings === null)
    return sum([base.price_cents, ...chosen.map((t) => t.price_cents)]);
  const specials = chosen.filter((t) => t.tier === "special");
  const extras = Math.max(0, chosen.length - specials.length - base.included_toppings);
  return sum([
    base.price_cents,
    ...(extras === 0
      ? []
      : [base.extra_topping_cents === null ? null : extras * base.extra_topping_cents]),
    ...specials.map((t) => t.price_cents),
  ]);
}

/** What a row keeps of the menu (D15): a later menu edit never rewrites it. */
export function snapshotOf(input: ItemInput, ctx: PizzeriaMenu): Snapshot {
  if (input.kind === "menu") {
    const m = ctx.items.find((x) => x.id === input.menu_item_id);
    if (m === undefined) return bad("menu_item_id", "not on the menu");
    return {
      menu_item_id: m.id,
      number: m.number,
      label: m.number === null ? m.name : `#${m.number} ${m.name}`,
      description: m.description,
      toppings: null,
      text: null,
      price_cents: m.price_cents,
    };
  }
  if (input.kind === "custom") {
    const base = ctx.base ?? bad("kind", "this pizzeria has no own pizza");
    const names = input.toppings ?? [];
    const chosen = names.map(
      (n) => ctx.toppings.find((t) => t.name === n) ?? { price_cents: null, tier: null },
    );
    const price = ownPizzaPrice(base, chosen);
    return {
      menu_item_id: null,
      number: null,
      label: `${base.name}: ${names.join(", ")}`,
      description: base.description,
      toppings: names,
      text: null,
      price_cents: price,
    };
  }
  return {
    menu_item_id: null,
    number: null,
    label: `Other: ${input.text ?? ""}`,
    description: null,
    toppings: null,
    text: input.text,
    price_cents: null,
  };
}

type Line = { name: string; description: string | null; price_cents: number | null };

function line(raw: unknown, field: string): Line {
  if (typeof raw !== "object" || raw === null) return bad(field, "must be an object");
  const r = raw as Record<string, unknown>;
  return {
    name: requiredText(r.name, `${field}.name`, LIMITS.name),
    description: optionalText(r.description, `${field}.description`, LIMITS.description),
    price_cents: parsePrice(r.price, `${field}.price`),
  };
}

/** The own pizza's base, with its included toppings and extra-topping price when given (#789). */
function baseOf(raw: unknown): MenuInput["base"] {
  const l = line(raw, "base");
  const r = raw as Record<string, unknown>;
  const n = r.included_toppings;
  if (
    n !== undefined &&
    n !== null &&
    !(Number.isInteger(n) && (n as number) >= 0 && (n as number) <= LIMITS.includedToppings)
  )
    bad("base.included_toppings", `an integer from 0 to ${LIMITS.includedToppings}, or null`);
  const extra = parsePrice(r.extra_topping_price, "base.extra_topping_price");
  return {
    ...l,
    ...(typeof n === "number" ? { included_toppings: n } : {}),
    ...(extra === null ? {} : { extra_topping_cents: extra }),
  };
}

/** A topping's tier: `normal` (also when absent) or `special` (#789). */
function tierOf(raw: unknown, field: string): { tier?: "special" } {
  const t = (raw as Record<string, unknown>).tier;
  if (t === undefined || t === null || t === "normal") return {};
  if (t === "special") return { tier: "special" };
  return bad(field, "normal or special");
}

/** A whole menu (`PUT …/menu`, the profile's `pizza` section): the same rules as the menu CSV. */
export function parseMenuBody(body: unknown): MenuInput {
  if (typeof body !== "object" || body === null) return bad("body", "must be an object");
  const b = body as Record<string, unknown>;
  const base = b.base === undefined || b.base === null ? null : baseOf(b.base);
  const rawItems = b.items === undefined ? [] : b.items;
  if (!Array.isArray(rawItems)) return bad("items", "must be an array");
  const items: MenuInput["items"] = [];
  const numbers = new Set<string>();
  rawItems.forEach((raw: unknown, i) => {
    const field = `items[${i}]`;
    const l = line(raw, field);
    const n = (raw as Record<string, unknown>).number;
    const number = requiredText(
      typeof n === "number" ? String(n) : n,
      `${field}.number`,
      LIMITS.number,
    );
    if (numbers.has(number)) bad(`${field}.number`, `${number} is on the menu twice`);
    numbers.add(number);
    const category = optionalText(
      (raw as Record<string, unknown>).category,
      `${field}.category`,
      LIMITS.category,
    );
    items.push({ number, ...l, ...(category === null ? {} : { category }) });
  });
  const rawToppings = b.toppings === undefined ? [] : b.toppings;
  if (!Array.isArray(rawToppings)) return bad("toppings", "must be an array");
  const toppings: Line[] = [];
  rawToppings.forEach((raw: unknown, i) => {
    const t = { ...line(raw, `toppings[${i}]`), ...tierOf(raw, `toppings[${i}].tier`) };
    // The legacy rule: a topping named twice is kept once.
    if (!toppings.some((x) => x.name.toLowerCase() === t.name.toLowerCase())) toppings.push(t);
  });
  return { items, base, toppings };
}
