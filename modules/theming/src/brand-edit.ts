/**
 * The brand `PUT …/draft/brand` stores (contracts/theming.md, Brand kit: "a body that leaves a
 * choice out keeps the stored one"). Its forms each send part of the brand, so the brand starts
 * from the stored one and every field names what a body that leaves it out does. Built from the
 * body instead, each field added later was lost on the next save until a review caught it (#809,
 * #814, #821; issue #823): a field without a rule here does not compile, and
 * test/brand-edit.test.ts holds the rules against theme.schema.json and BrandInput.
 */
import type { Backdrop, Brand } from "./brand.js";
import type { BrandEdit } from "./schema.js";

/** `body`: required, never left out; `keep`: the stored value stays; `drop`: it goes. */
type LeftOut = "body" | "keep" | "drop";

export const BRAND_LEFT_OUT: { readonly [K in keyof Brand]-?: LeftOut } = {
  primary: "body",
  accent: "body",
  scheme: "body",
  // The kit form's empty field stands for "the primary", and it then sends no embed_color.
  embed_color: "drop",
  logo_plate: "keep",
  font_pair: "keep",
  roundness: "keep",
  backdrop: "keep",
};

/**
 * Within a backdrop the body names, which Make it yours sends whole but for the video (Advanced
 * owns it): `same-image` keeps the stored value while the body names the stored picture, since the
 * video is that picture's (the schema's dependentRequired), and otherwise its file would stay in
 * the draft with nothing naming it.
 */
export const BACKDROP_LEFT_OUT: { readonly [K in keyof Backdrop]-?: "drop" | "same-image" } = {
  looks: "drop",
  game_art: "drop",
  daylight: "drop",
  hype: "drop",
  image: "drop",
  video: "same-image",
};

const entries = <T extends object>(o: T): [keyof T & string, T[keyof T]][] =>
  Object.entries(o) as [keyof T & string, T[keyof T]][];

function nextBackdrop(stored: unknown, sent: Backdrop): Backdrop {
  const before = (typeof stored === "object" && stored !== null ? stored : {}) as Backdrop;
  const next: Backdrop = { ...sent };
  for (const [field, rule] of entries(BACKDROP_LEFT_OUT)) {
    if (sent[field] !== undefined || before[field] === undefined) continue;
    if (rule === "same-image" && sent.image === before.image) {
      Object.assign(next, { [field]: before[field] });
    }
  }
  return next;
}

/**
 * The stored brand with the body over it: a field the body names replaces the stored one (`null`
 * takes it away), and one it leaves out follows its rule. A stored field with no rule is none the
 * schema allows (its `additionalProperties: false`), so a save takes it away and the draft can
 * publish again.
 */
export function nextBrand(stored: Record<string, unknown> | undefined, input: BrandEdit): Brand {
  const next = new Map(Object.entries(stored ?? {}).filter(([k]) => k in BRAND_LEFT_OUT));
  for (const [field, rule] of entries(BRAND_LEFT_OUT)) {
    const sent = input[field];
    if (sent === null) next.delete(field);
    else if (field === "backdrop" && input.backdrop !== undefined) {
      next.set(field, nextBackdrop(stored?.backdrop, input.backdrop));
    } else if (sent !== undefined) next.set(field, sent);
    else if (rule !== "keep") next.delete(field);
  }
  return Object.fromEntries(next) as unknown as Brand;
}
