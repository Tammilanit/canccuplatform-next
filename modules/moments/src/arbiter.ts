/**
 * The arbiter's pure rules (contracts/moments.md): classes and their ranks, which overrides show a
 * moment, whether a request is refused, and what changed in an override. No I/O, so the engine
 * (engine.ts) and the pages' previews rank the same way.
 */
import { isDeepStrictEqual } from "node:util";

export const CLASSES = [
  "emergency",
  "stream",
  "announcement",
  "spotlight",
  "storyboard",
  "tournament",
  "finals",
  "hot_game",
  "reactions",
  "ticker",
] as const;
export type Class = (typeof CLASSES)[number];

/** The ranks of the places in an order, highest first: a moved class takes its place's rank. */
const PLACE_RANKS = [100, 90, 80, 70, 65, 60, 55, 50, 20, 10] as const;
export const DEFAULT_ORDER: readonly Class[] = CLASSES;

export const isClass = (v: unknown): v is Class => CLASSES.includes(v as Class);

export interface Orders {
  order: readonly Class[];
  /** A zone's own order; a zone that follows the event's is not listed. */
  zones: Readonly<Record<string, readonly Class[]>>;
}

export const DEFAULT_ORDERS: Orders = { order: DEFAULT_ORDER, zones: {} };

export function rankOf(order: readonly Class[], c: Class): number {
  return PLACE_RANKS[order.indexOf(c)] ?? 0;
}

export function rankOn(orders: Orders, zone: string, c: Class): number {
  return rankOf(orders.zones[zone] ?? orders.order, c);
}

/** Why an order is refused, or null: every class once, emergency first, so nothing outranks it. */
export function checkOrder(order: readonly unknown[]): string | null {
  if (order.length !== CLASSES.length || !order.every(isClass)) {
    return "An order names every class.";
  }
  if (new Set(order).size !== order.length) return "An order names each class once.";
  if (order[0] !== "emergency") return "The emergency stays first in every order.";
  return null;
}

export interface MomentShape {
  id: string;
  class: Class;
  /** Empty: every zone of the event. */
  zones: readonly string[];
  /** Zones it gave up or was ended on. */
  left_zones: readonly string[];
}

export interface WantedOverride {
  id: string;
  zones: string[];
  rank: number;
}

/**
 * The overrides that show `moment` (contracts/moments.md, Zones with their own order). A zone
 * whose own order ranks the moment differently gets an override of its own, `<id>.<zone>`, and
 * keeps it for the moment's life (`split` lists the zones already split): Screen never brings an
 * override back to a zone it left, so the main override may only narrow, never widen.
 */
export function desiredOverrides(
  moment: MomentShape,
  orders: Orders,
  knownZones: readonly string[],
  split: readonly string[],
): WantedOverride[] {
  const left = new Set(moment.left_zones);
  const targets = (moment.zones.length === 0 ? knownZones : moment.zones).filter(
    (z) => !left.has(z),
  );
  const eventRank = rankOf(orders.order, moment.class);
  const own =
    moment.class === "emergency"
      ? []
      : targets.filter((z) => split.includes(z) || rankOn(orders, z, moment.class) !== eventRank);
  const main = targets.filter((z) => !own.includes(z)).sort();
  const everyZone = moment.zones.length === 0 && own.length === 0 && left.size === 0;
  const wanted: WantedOverride[] = [];
  if (everyZone) wanted.push({ id: moment.id, zones: [], rank: eventRank });
  else if (main.length > 0) wanted.push({ id: moment.id, zones: main, rank: eventRank });
  for (const z of [...own].sort()) {
    wanted.push({ id: `${moment.id}.${z}`, zones: [z], rank: rankOn(orders, z, moment.class) });
  }
  return wanted;
}

/** One claim on a zone as Screen last reported it, with the rank its override was sent with. */
export interface Held {
  override_id: string;
  role: string | null;
  rank: number;
  state: "placed" | "hidden" | "unplaced" | "left";
}

/**
 * Whether every role of `chain` is held on a zone by a higher rank (the legacy refusal, made
 * regional). A higher `full` claim holds every role but `overlay`; a waiting claim holds nothing.
 */
export function blockedOn(chain: readonly string[], rank: number, held: readonly Held[]): boolean {
  const higher = held.filter((h) => h.rank > rank && (h.state === "placed" || h.state === "hidden"));
  const full = higher.some((h) => h.role === "full");
  return chain.every((role) =>
    role === "overlay"
      ? higher.some((h) => h.role === "overlay")
      : full || higher.some((h) => h.role === role || (role === "full" && h.role !== "overlay")),
  );
}

/** The fields of an override that Moments changes after its start, as Screen stores them. */
export interface SentOverride {
  id: string;
  kind: string;
  zones: string[];
  rank: number;
  template: string;
  content: Record<string, unknown>;
  regions: string[];
  expires_at: string | null;
}

const COMPARED = ["zones", "rank", "template", "content", "regions", "expires_at"] as const;

/** The field names a `.changed` names for the step from `before` to `after`. */
export function overrideChanges(before: SentOverride, after: SentOverride): string[] {
  return COMPARED.filter((k) => !isDeepStrictEqual(before[k], after[k]));
}
