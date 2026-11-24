/**
 * The arbiter's airtime settings (contracts/moments.md, Airtime; #777): the floor a shown moment
 * holds the hero, the breathing gap between two, and when a waiting moment goes stale.
 */
import { CLASSES, isClass } from "./arbiter.js";
import type { Class } from "./arbiter.js";

export interface AirSettings {
  min_on_air_ms: number;
  gap_ms: number;
  stale_after_ms: Record<Class, number>;
}

const MINUTE = 60_000;

export const DEFAULT_AIR: AirSettings = {
  min_on_air_ms: 90_000,
  gap_ms: 10_000,
  stale_after_ms: Object.fromEntries(CLASSES.map((c) => [c, 30 * MINUTE])) as Record<Class, number>,
};

const int = (v: unknown, lo: number, hi: number): v is number =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** The stored settings (seconds and minutes, as the API has them) over the defaults. */
export function airOf(json: unknown): AirSettings {
  const o = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  const stale = (
    typeof o.stale_after_minutes === "object" && o.stale_after_minutes !== null
      ? o.stale_after_minutes
      : {}
  ) as Record<string, unknown>;
  return {
    min_on_air_ms: int(o.min_on_air_seconds, 60, 120)
      ? o.min_on_air_seconds * 1000
      : DEFAULT_AIR.min_on_air_ms,
    gap_ms: int(o.gap_seconds, 0, 30) ? o.gap_seconds * 1000 : DEFAULT_AIR.gap_ms,
    stale_after_ms: Object.fromEntries(
      CLASSES.map((c) => {
        const m = stale[c];
        return [c, int(m, 1, 240) ? m * MINUTE : DEFAULT_AIR.stale_after_ms[c]];
      }),
    ) as Record<Class, number>,
  };
}

/** The settings as the API answers them. */
export function airView(a: AirSettings): Record<string, unknown> {
  return {
    min_on_air_seconds: a.min_on_air_ms / 1000,
    gap_seconds: a.gap_ms / 1000,
    stale_after_minutes: Object.fromEntries(CLASSES.map((c) => [c, a.stale_after_ms[c] / MINUTE])),
  };
}

/** Why a `PUT`'s `airtime` is refused, or null; a missing field keeps its stored value. */
export function checkAir(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return "`airtime` is an object.";
  const o = body as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!["min_on_air_seconds", "gap_seconds", "stale_after_minutes"].includes(k))
      return `\`airtime\` has no \`${k}\`.`;
  if (o.min_on_air_seconds !== undefined && !int(o.min_on_air_seconds, 60, 120))
    return "The minimum time on air is 60 to 120 s.";
  if (o.gap_seconds !== undefined && !int(o.gap_seconds, 0, 30))
    return "The gap between moments is 0 to 30 s.";
  const stale = o.stale_after_minutes;
  if (stale !== undefined) {
    if (typeof stale !== "object" || stale === null || Array.isArray(stale))
      return "`stale_after_minutes` maps classes to minutes.";
    for (const [c, m] of Object.entries(stale))
      if (!isClass(c) || !int(m, 1, 240)) return "A class goes stale after 1 to 240 minutes.";
  }
  return null;
}

/** `patch` over `before`, as the API has them, for storing. */
export function mergeAir(
  before: AirSettings,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const now = airView(before);
  return {
    ...now,
    ...patch,
    stale_after_minutes: {
      ...(now.stale_after_minutes as Record<string, number>),
      ...((patch.stale_after_minutes as Record<string, number> | undefined) ?? {}),
    },
  };
}
