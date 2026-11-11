/**
 * Moments' overrides as claims on a zone's regions (contracts/screen.md, Moments drive it:
 * claims; plan #109, S12). Placement is a pure function of the regions and the active overrides,
 * so every screen of a zone agrees and a renewal (a later `expires_at`) moves nothing.
 */
import type { RegionView } from "./build.js";
import type { Role } from "./layouts.js";

export interface Sound {
  cue: string | null;
  url: string | null;
  volume?: number;
  play: "once" | "loop";
}

export interface Step {
  template: string;
  content: Record<string, unknown>;
  duration_ms: number;
  sound?: Sound | null;
}

/** An override as Screen keeps it: the fields it draws and places by, its lifetime resolved. */
export interface Override {
  id: string;
  kind: "takeover" | "block" | "overlay";
  zones: string[];
  rank: number;
  template: string;
  content: Record<string, unknown>;
  starts_at: string;
  ends_at: string | null;
  regions: string[] | null;
  /** The override's own, else `starts_at` plus `ttl_seconds`, else null. */
  expires_at: string | null;
  sound: Sound | null;
  steps: Step[] | null;
  on_end: "resume" | "next";
}

/** `Claim` of contracts/screen.openapi.yaml. */
export interface Claim {
  override_id: string;
  hidden: boolean;
  role: Role;
  rank: number;
  template: string;
  content: Record<string, unknown>;
  steps: Step[] | null;
  sound: Sound | null;
  on_end: "resume" | "next";
  starts_at: string;
  ends_at: string | null;
  expires_at: string | null;
}

const KINDS = ["takeover", "block", "overlay"] as const;
const DEFAULT_CHAIN: Record<Override["kind"], Role[]> = {
  takeover: ["full"],
  block: ["hero", "rail", "ticker"],
  overlay: ["overlay"],
};
/** The roles a claim may take; `header` and `backdrop` are never claimed. */
const CLAIMABLE = new Set<string>(["full", "hero", "rail", "venue_rail", "ticker", "overlay"]);

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const nullable = (v: unknown, check: (v: unknown) => boolean): boolean =>
  v === undefined || v === null || check(v);

function soundOf(v: unknown): Sound | null | undefined {
  if (v === undefined || v === null) return null;
  if (!isObject(v) || (v.play !== "once" && v.play !== "loop")) return undefined;
  if (!nullable(v.cue, (x) => typeof x === "string")) return undefined;
  if (!nullable(v.url, (x) => typeof x === "string")) return undefined;
  const volume = v.volume;
  if (volume !== undefined && !(typeof volume === "number" && volume >= 0 && volume <= 1)) {
    return undefined;
  }
  return {
    cue: (v.cue as string | undefined) ?? null,
    url: (v.url as string | undefined) ?? null,
    ...(volume === undefined ? {} : { volume }),
    play: v.play,
  };
}

function stepOf(v: unknown): Step | undefined {
  if (!isObject(v) || typeof v.template !== "string" || !isObject(v.content)) return undefined;
  const ms = v.duration_ms;
  if (!(Number.isInteger(ms) && (ms as number) >= 500 && (ms as number) <= 60_000))
    return undefined;
  const sound = soundOf(v.sound);
  if (sound === undefined) return undefined;
  return { template: v.template, content: v.content, duration_ms: ms as number, sound };
}

/**
 * An override of a `moments.override.*` event, or null when it is not one the contract allows:
 * a malformed override is dropped whole rather than drawn in part.
 */
export function overrideOf(v: unknown): Override | null {
  if (!isObject(v)) return null;
  const kind = KINDS.find((k) => k === v.kind);
  if (
    typeof v.id !== "string" ||
    kind === undefined ||
    !isStrings(v.zones) ||
    !Number.isInteger(v.rank) ||
    typeof v.template !== "string" ||
    !isObject(v.content) ||
    !isTime(v.starts_at) ||
    !nullable(v.ends_at, isTime) ||
    !nullable(v.regions, isStrings) ||
    !nullable(v.ttl_seconds, (x) => Number.isInteger(x) && (x as number) > 0) ||
    !nullable(v.expires_at, isTime) ||
    !nullable(v.steps, Array.isArray) ||
    !(v.on_end === undefined || v.on_end === "resume" || v.on_end === "next")
  ) {
    return null;
  }
  const sound = soundOf(v.sound);
  const steps = Array.isArray(v.steps) ? v.steps.map(stepOf) : null;
  if (sound === undefined || steps?.some((s) => s === undefined) === true) return null;
  const ttl = v.ttl_seconds as number | null | undefined;
  const expires =
    (v.expires_at as string | null | undefined) ??
    (typeof ttl === "number" ? new Date(Date.parse(v.starts_at) + ttl * 1000).toISOString() : null);
  return {
    id: v.id,
    kind,
    zones: v.zones,
    rank: v.rank as number,
    template: v.template,
    content: v.content,
    starts_at: v.starts_at,
    ends_at: (v.ends_at as string | null | undefined) ?? null,
    regions: (v.regions as string[] | null | undefined) ?? null,
    expires_at: expires,
    sound,
    steps: steps as Step[] | null,
    on_end: v.on_end === "next" ? "next" : "resume",
  };
}

/** When the claim ends by itself: its expiry or its planned end, whichever is first. */
export function endOf(o: Pick<Override, "expires_at" | "ends_at">): number | null {
  const ends = [o.expires_at, o.ends_at].flatMap((t) => (t === null ? [] : [Date.parse(t)]));
  return ends.length === 0 ? null : Math.min(...ends);
}

/** Whether the override claims on `zone` at `nowMs` (`zones` empty: every zone). */
export function activeOn(o: Override, zone: string, nowMs: number): boolean {
  const end = endOf(o);
  return (o.zones.length === 0 || o.zones.includes(zone)) && (end === null || nowMs < end);
}

/** Highest rank first; ties: the later start, then the override id. */
function byRank(a: Override, b: Override): number {
  if (a.rank !== b.rank) return b.rank - a.rank;
  const starts = Date.parse(b.starts_at) - Date.parse(a.starts_at);
  if (starts !== 0) return starts;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface Placement {
  regions: RegionView[];
  /** In walk order, as `screen.claims.changed` reports them. */
  placed: { override_id: string; role: Role }[];
  unplaced: string[];
  hidden: string[];
}

/** The regions with their claims, by the contract's placement rule. */
export function placeClaims(
  regions: readonly RegionView[],
  overrides: readonly Override[],
): Placement {
  // A role's claim is drawn once, in the first region of the role (a split region's first part).
  const regionOf = new Map<Role, number>();
  regions.forEach((r, i) => {
    if (r.role !== null && !regionOf.has(r.role)) regionOf.set(r.role, i);
  });
  const held = new Set<Role>();
  const placed: { o: Override; role: Role; hidden: boolean }[] = [];
  const unplaced: string[] = [];
  let full = false;
  for (const o of [...overrides].sort(byRank)) {
    const chain = (o.regions ?? DEFAULT_CHAIN[o.kind]).filter((r): r is Role => CLAIMABLE.has(r));
    const role = chain.find((r) => {
      if (!regionOf.has(r) || held.has(r)) return false;
      // `full` waits for every higher claim but an overlay; the others ignore `full` claims.
      return r !== "full" || [...held].every((h) => h === "overlay");
    });
    if (role === undefined) {
      unplaced.push(o.id);
      continue;
    }
    held.add(role);
    placed.push({ o, role, hidden: full && role !== "full" });
    if (role === "full") full = true;
  }
  const out = regions.map((r) => ({ ...r }));
  for (const { o, role, hidden } of placed) {
    const at = regionOf.get(role) as number;
    out[at] = { ...(out[at] as RegionView), claim: claimOf(o, role, hidden) };
  }
  return {
    regions: out,
    placed: placed.map(({ o, role }) => ({ override_id: o.id, role })),
    unplaced,
    hidden: placed.flatMap(({ o, hidden }) => (hidden ? [o.id] : [])),
  };
}

function claimOf(o: Override, role: Role, hidden: boolean): Claim {
  return {
    override_id: o.id,
    hidden,
    role,
    rank: o.rank,
    template: o.template,
    content: o.content,
    steps: o.steps,
    sound: o.sound,
    on_end: o.on_end,
    starts_at: o.starts_at,
    ends_at: o.ends_at,
    expires_at: o.expires_at,
  };
}
