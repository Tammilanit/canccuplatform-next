/**
 * A story's placeholders (contracts/moments.md, Storyboards; D10, SD3): the facts a trigger
 * fills when it fires, kept with the run, and a step's content filled from them when its round
 * starts, so "starts in 15 minutes" becomes "starts in 5 minutes" without a live binding. A
 * placeholder never shows raw: what a run lacks takes its fallback, or the empty text. Pure.
 */
import { qrView } from "../content.js";
import { startsIn } from "../announce/text.js";
import type { RunItem } from "../announce/store.js";
import { DOMAIN_TYPES, TOKEN } from "./model.js";
import { localParts } from "./schedule.js";

type Data = Record<string, unknown>;
export type Facts = Record<string, string>;

const obj = (v: unknown): Data => (typeof v === "object" && v !== null ? (v as Data) : {});
const list = (v: unknown): Data[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

export const hhmm = (iso: string, timeZone: string): string =>
  Number.isNaN(Date.parse(iso)) ? "" : localParts(Date.parse(iso), timeZone).hhmm;

/** An item's facts; its start is kept as an instant too, so `{item.starts_in}` is filled fresh. */
export function itemFacts(
  item: RunItem & { ends_at?: string | null; game?: unknown },
  timeZone: string,
): Facts {
  return {
    "item.title": item.title,
    "item.starts_at": hhmm(item.starts_at, timeZone),
    "item.ends_at": item.ends_at == null ? "" : hhmm(item.ends_at, timeZone),
    "item.location": item.location ?? "",
    "item.kind": item.kind ?? "",
    "item.game": str(obj(item.game).name),
    "@item.starts_at": item.starts_at,
  };
}

const teamName = (t: Data): string =>
  str(t.name) ||
  list(t.people)
    .map((p) => str(p.name))
    .filter(Boolean)
    .join(" & ");

/** A domain event's public facts, per type (the fixed list); personal fields are never read. */
export function domainFacts(type: string, d: Data, timeZone: string): Facts {
  const fills = DOMAIN_TYPES[type]?.fills ?? [];
  const session = obj(d.session);
  const match = obj(d.match);
  const order = obj(d.order);
  const game = obj(d.game);
  const first = list(d.results).sort((a, b) => Number(a.rank) - Number(b.rank))[0] ?? {};
  const winners = list(first.people)
    .map((p) => str(p.name))
    .filter(Boolean);
  const all: Facts = {
    "session.name": str(session.name),
    "session.game": str(obj(session.game).name),
    "checkin.closes_at": hhmm(str(d.closes_at), timeZone),
    "match.label": str(match.label),
    "match.teams": list(match.teams).map(teamName).join(" vs "),
    "winner.name": str(first.name) || winners.join(" & "),
    "winner.names": winners.join(", "),
    "winner.points": str(first.points),
    "order.seq": str(order.seq),
    "order.target_at": hhmm(str(order.target_at), timeZone),
    "order.pizza_count": str(order.pizza_count),
    "game.name": str(game.name),
    "game.players": str(d.players),
  };
  return Object.fromEntries(
    fills.map((k) => [k, all[k] ?? ""]).filter(([, v]) => v !== ""),
  ) as Facts;
}

/** What a domain event's story keys on (`per_source`, `once` per source), or null. */
export function domainSource(type: string, d: Data): string | null {
  const kind = DOMAIN_TYPES[type]?.source;
  if (kind === "photo") return typeof d.photo_id === "string" ? `photo:${d.photo_id}` : null;
  const id = kind === undefined ? null : obj(d[kind]).id;
  return typeof id === "string" ? `${kind ?? ""}:${id}` : null;
}

export interface FillContext {
  facts: Facts;
  now: number;
  /** The trigger time T: a countdown with an empty `target_at` counts to it. */
  t: number;
  timeZone: string;
  eventName: string;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  hostname: string | null;
}

/** The night of the event `at` is in: past midnight counts as that night, until 06:00. */
function dayOf(at: number, ctx: FillContext): string {
  const day = (ms: number) =>
    Date.parse(`${localParts(ms - 6 * 3_600_000, ctx.timeZone).date}T00:00:00Z`);
  if (ctx.eventStartsAt === null || Number.isNaN(Date.parse(ctx.eventStartsAt)))
    return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: ctx.timeZone }).format(
      new Date(at - 6 * 3_600_000),
    );
  return String(
    Math.max(1, Math.round((day(at) - day(Date.parse(ctx.eventStartsAt))) / 86_400_000) + 1),
  );
}

function value(name: string, ctx: FillContext): string {
  switch (name) {
    case "event.name":
      return ctx.eventName;
    case "event.ends_at":
      return ctx.eventEndsAt === null ? "" : hhmm(ctx.eventEndsAt, ctx.timeZone);
    case "now.time":
      return localParts(ctx.now, ctx.timeZone).hhmm;
    case "now.day":
      return dayOf(ctx.now, ctx);
    case "item.starts_in": {
      const at = ctx.facts["@item.starts_at"];
      return at === undefined ? "" : startsIn(at, new Date(ctx.now));
    }
    default:
      return ctx.facts[name] ?? "";
  }
}

/** One text with every placeholder filled, or its fallback where the run has no value. */
export function fillText(text: string, ctx: FillContext): string {
  return text.replace(TOKEN, (_whole, inner: string | undefined) => {
    if (inner === undefined) return "";
    const bar = inner.indexOf("|");
    const name = bar < 0 ? inner : inner.slice(0, bar);
    const v = value(name, ctx).trim();
    return v !== "" ? v : bar < 0 ? "" : inner.slice(bar + 1);
  });
}

/** A step's whole view-model, filled: texts, a `qr` path as Screen's QR, a countdown's target. */
export function fillContent(template: string, content: Data, ctx: FillContext): Data {
  const deep = (v: unknown): unknown => {
    if (typeof v === "string") return fillText(v, ctx);
    if (Array.isArray(v)) return v.map(deep);
    if (typeof v === "object" && v !== null)
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]));
    return v;
  };
  const out = deep(content) as Data;
  const qr = obj(content.qr);
  if (typeof qr.path === "string" && typeof qr.label === "string") {
    if (ctx.hostname === null) delete out.qr;
    else out.qr = qrView(ctx.hostname, { path: qr.path, label: fillText(qr.label, ctx) });
    // The `qr` widget draws the code from its top-level fields.
    if (template === "qr" && out.qr !== undefined) Object.assign(out, out.qr as Data);
  }
  if (template === "countdown" && (content.target_at ?? "") === "")
    out.target_at = new Date(ctx.t).toISOString();
  return out;
}
