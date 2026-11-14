/**
 * A zone's energy level (contracts/screen.md, Motion and burn-in drift): the day's phase from the
 * agenda, the level composed from the event's setting, the zone's pin, Follow the day, quiet hours
 * and the theme's cap, and the next change of that level. Pure: the clock and the items come in.
 */
import type { AgendaItem } from "./widgets.js";

export type MotionLevel = "none" | "calm" | "lively" | "party";
export const MOTION_LEVELS: readonly MotionLevel[] = ["none", "calm", "lively", "party"];
export type MotionPhase = "quiet_hours" | "wind_down" | "doors" | "peak" | "build_up";
/** The theme's `motion` token, which caps the level (contracts/theming.md). */
export type ThemeMotion = "moderate" | "calm" | "none";
/** `display.motion`, for players that predate `motion_level`. */
export type LegacyMotion = ThemeMotion;

const HOUR_MS = 60 * 60 * 1000;
/** How far ahead the next change is looked for (the Motion card's `next`). */
export const NEXT_HORIZON_MS = 24 * HOUR_MS;
const PEAK_KINDS = new Set(["tournament", "ceremony"]);

export const isMotionLevel = (v: unknown): v is MotionLevel =>
  MOTION_LEVELS.includes(v as MotionLevel);

export function themeMotionOf(tokens: { motion?: unknown } | undefined): ThemeMotion {
  const m = tokens?.motion;
  return m === "calm" || m === "none" ? m : "moderate";
}

const rank = (l: MotionLevel): number => MOTION_LEVELS.indexOf(l);
const atMost = (l: MotionLevel, cap: MotionLevel): MotionLevel => (rank(l) > rank(cap) ? cap : l);

/** The items that set a zone's phase: public, scheduled, of the zone or of no zone. */
export function phaseItems(items: readonly AgendaItem[], zoneKey: string): AgendaItem[] {
  return items.filter(
    (i) =>
      i.visibility === "public" &&
      (i.status ?? "scheduled") === "scheduled" &&
      (i.zone == null || i.zone === zoneKey),
  );
}

/** When an item stops counting: its end; quiet hours without one never run (as the rail has it). */
function endOf(item: AgendaItem): number | null {
  if (item.ends_at !== null) return Date.parse(item.ends_at);
  return item.kind === "quiet_hours" ? null : Date.parse(item.starts_at) + HOUR_MS;
}

const runs = (item: AgendaItem, at: number): boolean => {
  const end = endOf(item);
  return Date.parse(item.starts_at) <= at && end !== null && at < end;
};

/** The day's phase at `at`; `items` already kept to the zone's (phaseItems). The first that holds wins. */
export function phaseAt(items: readonly AgendaItem[], at: number): MotionPhase {
  const quiet = items.filter((i) => i.kind === "quiet_hours");
  if (quiet.some((i) => runs(i, at))) return "quiet_hours";
  if (
    quiet.some((i) => {
      const start = Date.parse(i.starts_at);
      return start > at && start - at <= HOUR_MS;
    })
  ) {
    return "wind_down";
  }
  if (items.some((i) => i.kind === "doors" && runs(i, at))) return "doors";
  if (items.some((i) => PEAK_KINDS.has(i.kind) && runs(i, at))) return "peak";
  return "build_up";
}

export interface LevelInputs {
  /** The event's setting `motion_level`. */
  eventLevel: MotionLevel;
  followTheDay: boolean;
  /** The zone's own `motion_level`, or null. */
  pin: MotionLevel | null;
  themeMotion: ThemeMotion;
}

/** Steps 1–2: the base, moved one step by the phase while Follow the day is on and nothing is pinned. */
export function baseLevel(input: LevelInputs, phase: MotionPhase): MotionLevel {
  if (input.pin !== null) return input.pin;
  const base = input.eventLevel;
  if (!input.followTheDay || base === "none") return base;
  if (phase === "doors" || phase === "wind_down") {
    return base === "calm" ? "calm" : (MOTION_LEVELS[rank(base) - 1] ?? base);
  }
  if (phase === "peak") return MOTION_LEVELS[Math.min(rank(base) + 1, 3)] ?? base;
  return base;
}

/** Steps 1–4 (the device's reduced motion is the player's). Nothing after the base raises it. */
export function levelOf(input: LevelInputs, phase: MotionPhase): MotionLevel {
  let level = baseLevel(input, phase);
  if (phase === "quiet_hours") level = atMost(level, "calm");
  if (input.themeMotion === "calm") level = atMost(level, "calm");
  if (input.themeMotion === "none") level = "none";
  return level;
}

export function legacyMotion(level: MotionLevel): LegacyMotion {
  return level === "lively" || level === "party" ? "moderate" : level;
}

/** Every time the phase may change after `at`: each item's start and end, and an hour before quiet hours. */
function boundaries(items: readonly AgendaItem[], at: number, until: number): number[] {
  const times = new Set<number>();
  for (const i of items) {
    const start = Date.parse(i.starts_at);
    const end = endOf(i);
    const candidates = [start, end, i.kind === "quiet_hours" ? start - HOUR_MS : null];
    for (const t of candidates) if (t !== null && t > at && t <= until) times.add(t);
  }
  return [...times].sort((a, b) => a - b);
}

export interface ZoneMotion {
  level: MotionLevel;
  phase: MotionPhase;
  /** The next change of the level within NEXT_HORIZON_MS, or null. */
  next: { level: MotionLevel; phase: MotionPhase; at: number } | null;
}

/** The zone's level and phase at `at`, and when the level next changes. */
export function zoneMotion(
  input: LevelInputs,
  items: readonly AgendaItem[],
  at: number,
): ZoneMotion {
  const phase = phaseAt(items, at);
  const level = levelOf(input, phase);
  for (const t of boundaries(items, at, at + NEXT_HORIZON_MS)) {
    const p = phaseAt(items, t);
    const l = levelOf(input, p);
    if (l !== level) return { level, phase, next: { level: l, phase: p, at: t } };
  }
  return { level, phase, next: null };
}

/**
 * The next time the day's phase changes, whatever the level does (a pinned zone's level never
 * moves): what reads the phase, such as "Today in numbers" at wind-down, is rebuilt then.
 */
export function nextPhaseAt(items: readonly AgendaItem[], at: number): number | null {
  const phase = phaseAt(items, at);
  for (const t of boundaries(items, at, at + NEXT_HORIZON_MS)) {
    if (phaseAt(items, t) !== phase) return t;
  }
  return null;
}

/** The event's motion settings as Screen reads them, defaults for anything else. */
export function eventMotion(settings: { get(key: string, fallback: unknown): unknown }): {
  eventLevel: MotionLevel;
  followTheDay: boolean;
} {
  const level = settings.get("motion_level", "lively");
  return {
    eventLevel: isMotionLevel(level) ? level : "lively",
    followTheDay: settings.get("follow_the_day", true) !== false,
  };
}
