/**
 * The airtime scheduler (contracts/moments.md, The arbiter's rules; #777), pure: who holds a
 * zone's hero, who waits in the rail, who is held back, and what ends. Screen still places what it
 * gets by rank; it only ever gets one hero claimant per zone, so the floor, the gap and the queue's
 * order (first waited, first shown) are Moments' and hold on every screen alike.
 */
import type { AirSettings } from "./air-settings.js";
import type { Class } from "./arbiter.js";
import type { Origin } from "./store.js";

/** hero: holds it; rail: the waiting room; pass: no hero in its chain; inside: in a condensed round. */
export type Grant = "hero" | "rail" | "pass" | "inside" | null;

export interface SlotIn {
  moment_id: string;
  class: Class;
  /** In the zone's own order. */
  rank: number;
  chain: readonly string[];
  origin: Origin;
  rule_id: string | null;
  has_steps: boolean;
  fresh_at: number;
  queued_since: number;
  forward_at: number | null;
  granted: Grant;
  /** Null while its clock is paused or it waits. */
  on_air_since: number | null;
  played_ms: number;
  /** `played_ms` when its hold of the hero began: the floor counts on-air time from here. */
  tenure_from_ms: number;
  budget_ms: number | null;
}

export interface ZoneIn {
  holder: string | null;
  free_since: number | null;
}

export interface SlotOut {
  moment_id: string;
  granted: Grant;
  /** What its override on this zone carries; null: not sent there. */
  regions: string[] | null;
  inside_of: string | null;
  queued_since: number;
  tenure_from_ms: number;
}

export interface ZonePlan {
  zone: ZoneIn;
  slots: SlotOut[];
  ends: { moment_id: string; reason: "expired" | "stale" }[];
  condensed: { holder: string; inside: string[] } | null;
}

/** The rules whose moments are routine: a long queue of them plays as one round (rule 6). */
export const ROUTINE_RULES: ReadonlySet<string> = new Set(["standings", "hot_game"]);
export const CONDENSE_OVER = 3;

export const playedNow = (s: SlotIn, now: number): number =>
  s.played_ms + (s.on_air_since === null ? 0 : Math.max(0, now - s.on_air_since));

/** When its on-air time ran out: a pass that comes late still counts the gap from here. */
export const usedUpAt = (s: SlotIn, now: number): number =>
  s.on_air_since === null || s.budget_ms === null
    ? now
    : Math.min(now, s.on_air_since + s.budget_ms - s.played_ms);

const claimant = (s: SlotIn) => s.chain.includes("hero") || s.chain.includes("full");
const onAir = (s: SlotIn) => s.granted === "hero" || s.granted === "pass" || s.granted === "inside";
const routine = (s: SlotIn) => s.rule_id !== null && ROUTINE_RULES.has(s.rule_id);

/** Moved forward first (latest first), then rank, then the longest wait. */
function queueOrder(a: SlotIn, b: SlotIn): number {
  if (a.forward_at !== b.forward_at) {
    if (a.forward_at === null) return 1;
    if (b.forward_at === null) return -1;
    return b.forward_at - a.forward_at;
  }
  return (
    b.rank - a.rank ||
    a.queued_since - b.queued_since ||
    (a.moment_id < b.moment_id ? -1 : a.moment_id > b.moment_id ? 1 : 0)
  );
}

export function planZone(
  now: number,
  zone: ZoneIn,
  slots: readonly SlotIn[],
  air: AirSettings,
): ZonePlan {
  const ends: ZonePlan["ends"] = [];
  for (const s of slots) {
    if (s.on_air_since !== null && s.budget_ms !== null && playedNow(s, now) >= s.budget_ms)
      ends.push({ moment_id: s.moment_id, reason: "expired" });
    else if (!onAir(s) && now >= s.fresh_at + air.stale_after_ms[s.class])
      ends.push({ moment_id: s.moment_id, reason: "stale" });
  }
  // A story's next segment (its video after its steps) is the same round: it takes over at once.
  const was = slots.find((s) => s.moment_id === zone.holder);
  const next = slots.find(
    (s) =>
      was !== undefined &&
      s !== was &&
      s.granted !== "hero" &&
      claimant(s) &&
      was.rule_id?.startsWith("story:") === true &&
      s.rule_id === was.rule_id,
  );
  if (was !== undefined && next !== undefined && !ends.some((e) => e.moment_id === was.moment_id))
    ends.push({ moment_id: was.moment_id, reason: "expired" });
  const gone = new Set(ends.map((e) => e.moment_id));
  let live = slots.filter((s) => !gone.has(s.moment_id));
  // A condensed round's moments end with it: their time was its time.
  const inside = live.filter((s) => s.granted === "inside");
  for (const s of inside) {
    if (!live.some((h) => h.moment_id === zone.holder && h.granted === "hero")) {
      ends.push({ moment_id: s.moment_id, reason: "expired" });
      gone.add(s.moment_id);
    }
  }
  live = live.filter((s) => !gone.has(s.moment_id));
  const out = new Map<string, SlotOut>(
    live.map((s) => [
      s.moment_id,
      {
        moment_id: s.moment_id,
        granted: claimant(s) ? (s.granted === "inside" ? "inside" : null) : "pass",
        regions: claimant(s) ? null : [...s.chain],
        inside_of: s.granted === "inside" ? zone.holder : null,
        queued_since: s.queued_since,
        tenure_from_ms: s.tenure_from_ms,
      },
    ]),
  );
  let holder = live.find((s) => s.moment_id === zone.holder && claimant(s)) ?? null;
  const gone_ = slots.find((s) => s.moment_id === zone.holder && gone.has(s.moment_id));
  let free_since =
    holder === null
      ? zone.holder !== null
        ? gone_ === undefined
          ? now
          : usedUpAt(gone_, now)
        : zone.free_since
      : null;
  if (next !== undefined && holder === null) free_since = null;
  const queue = () =>
    live
      .filter((s) => claimant(s) && s !== holder && out.get(s.moment_id)?.granted !== "inside")
      .sort(queueOrder);
  const pushAside = (h: SlotIn) => {
    const o = out.get(h.moment_id);
    if (o !== undefined) o.queued_since = now;
    h = { ...h, queued_since: now };
    live = live.map((s) => (s.moment_id === h.moment_id ? h : s));
  };
  const head = queue()[0];
  if (holder !== null && head !== undefined) {
    const floor = Math.min(air.min_on_air_ms, holder.budget_ms ?? Infinity);
    const floorDone = playedNow(holder, now) - holder.tenure_from_ms >= floor;
    if (head.origin === "crew" && head.rank >= holder.rank) {
      pushAside(holder);
      holder = null;
      free_since = null;
    } else if (floorDone && head.rank > holder.rank) {
      pushAside(holder);
      holder = null;
      free_since = now;
    }
  }
  let condensed: ZonePlan["condensed"] = null;
  if (holder === null) {
    const next = queue()[0];
    const gapOver = free_since === null || now - free_since >= air.gap_ms;
    if (next !== undefined && (gapOver || next.origin === "crew")) {
      holder = next;
      free_since = null;
      const o = out.get(next.moment_id);
      if (o !== undefined) o.tenure_from_ms = next.played_ms;
      const routines = routine(next) ? [next, ...queue().filter(routine)] : [];
      if (routines.length > CONDENSE_OVER) {
        const ids = routines.filter((s) => s !== next).map((s) => s.moment_id);
        condensed = { holder: next.moment_id, inside: ids };
        for (const id of ids) {
          const r = out.get(id);
          if (r !== undefined) Object.assign(r, { granted: "inside", inside_of: next.moment_id });
        }
      }
    }
  }
  if (holder !== null) {
    const o = out.get(holder.moment_id);
    if (o !== undefined) {
      Object.assign(o, { granted: "hero", regions: [...holder.chain] });
      // A hold that begins now: its floor counts from here.
      if (holder.granted !== "hero") o.tenure_from_ms = holder.played_ms;
    }
  }
  const room = queue().find((s) => s.chain.includes("rail") && !s.has_steps);
  if (room !== undefined) {
    const o = out.get(room.moment_id);
    if (o !== undefined)
      Object.assign(o, { granted: "rail", regions: room.chain.slice(room.chain.indexOf("rail")) });
  }
  return {
    zone: { holder: holder?.moment_id ?? null, free_since },
    slots: [...out.values()],
    ends,
    condensed,
  };
}
