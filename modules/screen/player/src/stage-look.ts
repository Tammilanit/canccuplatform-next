/**
 * The look cycle and the time of day (#787 D10; contracts/screen.md, The stage): which generated
 * look the stage plays now, from the zone's key and the server clock alone, so every screen of a
 * zone shows the same look and a reload picks up where it was; and the event's time of day.
 */
import type { Level } from "./motion.js";

/** The looks the stage draws; a theme names its own (theming's plan issue-785 D12 adds two). */
export const LOOKS = ["glows", "gradient", "particles", "waves", "hearth", "sky"] as const;
/** A crossfade from one look to the next; its pace never changes with the hype or the level. */
export const LOOK_FADE_MS = 40_000;
/**
 * The cycle runs in periods of four holds, each 3 to 6 minutes, in pairs that add up to 9: so the
 * hold holding `now` is found from the period alone, without walking the day from its start.
 */
const PERIOD_MS = 1_080_000;
const PAIR_S = 540;

/** A number in [0, 1) from the zone, the period and a salt: FNV-1a, then one mix step. */
function rand(zone: string, period: number, salt: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${zone}:${String(period)}:${salt}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4_294_967_296;
}

const pick = <T>(list: readonly T[], r: number): T => list[Math.floor(r * list.length)] as T;

/** The four looks of a period: never one twice in a row, also across the period's ends. */
function periodLooks(zone: string, period: number, looks: readonly string[]): string[] {
  // Two looks only alternate; an odd count of holds a period would put one twice in a row.
  if (looks.length === 2) return [0, 1, 2, 3].map((k) => looks[(k + period * 4) % 2] as string);
  const first = (p: number): string => pick(looks, rand(zone, p, "first"));
  const out = [first(period)];
  const next = first(period + 1);
  for (let k = 1; k < 4; k++) {
    const options = looks.filter((l) => l !== out[k - 1] && (k < 3 || l !== next));
    out.push(pick(options, rand(zone, period, `look${String(k)}`)));
  }
  return out;
}

/** Whole 10 s steps, so a hold never ends between two of a screen's ticks of the cycle. */
function periodHolds(zone: string, period: number): number[] {
  const a = 180 + 10 * Math.floor(rand(zone, period, "a") * 19);
  const b = 180 + 10 * Math.floor(rand(zone, period, "b") * 19);
  return [a, PAIR_S - a, b, PAIR_S - b].map((s) => s * 1000);
}

/** The looks the stage may play: the theme's, without particles at none, else the glows. */
function playable(looks: readonly string[], level: Level): string[] {
  const known = LOOKS.filter((l) => looks.includes(l) && !(level === "none" && l === "particles"));
  return known.length === 0 ? ["glows"] : known;
}

export interface LookNow {
  look: string;
  /** The look it fades from, for the first 40 s of its hold; null otherwise. */
  from: string | null;
  since: number;
}

/** The zone's look at `now` (ms, server clock). */
export function lookAt(zone: string, looks: readonly string[], now: number, level: Level): LookNow {
  const list = playable(looks, level);
  if (list.length === 1) return { look: list[0] as string, from: null, since: 0 };
  const period = Math.floor(now / PERIOD_MS);
  const holds = periodHolds(zone, period);
  const shown = periodLooks(zone, period, list);
  let since = period * PERIOD_MS;
  let k = 0;
  while (k < 3 && since + (holds[k] ?? 0) <= now) since += holds[k++] ?? 0;
  const look = shown[k] as string;
  if (now - since >= LOOK_FADE_MS) return { look, from: null, since };
  const from = k > 0 ? shown[k - 1] : periodLooks(zone, period - 1, list)[3];
  return { look, from: from ?? null, since };
}

export type Daypart = "morning" | "day" | "late";

const hours = new Map<string, Intl.DateTimeFormat>();

/** The event's time of day: morning 05–11, late 23–05, the day between (the stage's daylight). */
export function daypartAt(now: number, timeZone: string): Daypart {
  let f = hours.get(timeZone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" });
    } catch {
      return "day";
    }
    hours.set(timeZone, f);
  }
  const hour = Number(f.format(now));
  if (hour >= 5 && hour < 11) return "morning";
  return hour >= 23 || hour < 5 ? "late" : "day";
}
