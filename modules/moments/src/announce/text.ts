/**
 * Announcement texts (contracts/moments.md, Templates and placeholders; D11, E17), pure: the
 * run-of-show placeholders, the organiser's free variables, and the limits. Validation runs
 * before anything is saved, so a placeholder never reaches a screen raw.
 */

export const TITLE_MAX = 60;
export const BODY_MAX = 140;

const ITEM_FIELDS = ["title", "starts_at", "starts_in", "location"] as const;
const FREE = /^[a-z][a-z0-9_]{0,31}$/;
/** A whole placeholder, or a lone brace: the scanner sees both, so a stray brace is caught. */
const TOKEN = /\{([^{}]*)\}|[{}]/g;

export interface ItemFacts {
  title: string;
  starts_at: string;
  location?: string | null;
}

export interface FillContext {
  item: ItemFacts | null;
  eventName: string;
  timeZone: string;
  now: Date;
}

type Placeholder =
  | { kind: "item"; field: string }
  | { kind: "event" }
  | { kind: "free"; name: string }
  | { kind: "unknown"; raw: string }
  | { kind: "brace" };

function* scan(text: string): Generator<Placeholder> {
  for (const m of text.matchAll(TOKEN)) {
    const inner = m[1];
    if (inner === undefined) yield { kind: "brace" };
    else if (inner === "event.name") yield { kind: "event" };
    else if (
      inner.startsWith("item.") &&
      (ITEM_FIELDS as readonly string[]).includes(inner.slice(5))
    )
      yield { kind: "item", field: inner.slice(5) };
    else if (FREE.test(inner)) yield { kind: "free", name: inner };
    else yield { kind: "unknown", raw: `{${inner}}` };
  }
}

/** Why a text cannot go out as it is, or null: the composer's message names the culprit. */
export function checkText(
  text: string,
  variables: Readonly<Record<string, string>>,
  hasItem: boolean,
): string | null {
  for (const p of scan(text)) {
    if (p.kind === "brace") return "A brace opens or closes no placeholder: remove it.";
    if (p.kind === "unknown") return `Unknown placeholder ${p.raw}.`;
    if (p.kind === "item" && !hasItem)
      return `{item.${p.field}} needs a run-of-show item: choose one.`;
    if (p.kind === "free" && (own(variables, p.name) ?? "").trim() === "")
      return `Fill in {${p.name}}.`;
  }
  return null;
}

/** The free variables the texts name, in order of first use: the composer's fields. */
export function freeVariables(...texts: string[]): string[] {
  const names: string[] = [];
  for (const text of texts)
    for (const p of scan(text))
      if (p.kind === "free" && !names.includes(p.name)) names.push(p.name);
  return names;
}

/** "15 minutes", "1 h 5 min", "now": how long until `startsAt`, from `now`. */
export function startsIn(startsAt: string, now: Date): string {
  const minutes = Math.round((Date.parse(startsAt) - now.getTime()) / 60_000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return minutes === 1 ? "1 minute" : `${String(minutes)} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${String(m)} min`;
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(iso));
}

/** A name's own value: `{constructor}` and its kind are free variables, never Object.prototype's. */
export const own = <T>(values: Readonly<Record<string, T>>, name: string): T | undefined =>
  Object.hasOwn(values, name) ? values[name] : undefined;

/** The text with every placeholder filled; it has passed `checkText` first. */
export function fill(
  text: string,
  ctx: FillContext,
  variables: Readonly<Record<string, string>>,
): string {
  return text.replace(TOKEN, (whole, inner: string | undefined) => {
    if (inner === undefined) return "";
    if (inner === "event.name") return ctx.eventName;
    if (inner.startsWith("item.")) {
      const item = ctx.item;
      if (item === null) return "";
      switch (inner.slice(5)) {
        case "title":
          return item.title;
        case "starts_at":
          return clock(item.starts_at, ctx.timeZone);
        case "starts_in":
          return startsIn(item.starts_at, ctx.now);
        case "location":
          return item.location ?? "";
      }
    }
    return FREE.test(inner) ? (own(variables, inner) ?? "").trim() : whole;
  });
}

/** A text cut to `max` characters with an ellipsis: a scheduled one whose filling grew. */
export function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`.slice(0, max);
}
