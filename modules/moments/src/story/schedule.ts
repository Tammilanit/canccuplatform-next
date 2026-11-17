/**
 * When a story's rounds play and when its loop ends (the storyboards plan, Repeats and loops;
 * Ends, the finale and the cap): rounds at offsets from the trigger time T or every n minutes,
 * started early by the on-the-dot lead; a round whose time ran out is skipped, never played late
 * (SE1, SE4); the loop ends by a count, a time, a clock time, an event or the crew. Pure: the
 * clock comes in.
 */
import { roundCount } from "./model.js";
import type { Story, Trigger } from "./model.js";

const MINUTE = 60_000;
/** SE5, fix 8: an `until_event` loop ends at the latest this long after it started. */
export const CAP_MS = 6 * 3_600_000;
/** A one-round story waits the class's patience for its region. */
const ONE_ROUND_PATIENCE_MS = 120_000;
const MAX_PATIENCE_MS = 60_000;

type Schedule = Pick<Story, "rounds" | "end">;

/** Round `n`'s planned start (from 0), or null when there is no such round. */
export function roundAt(s: Schedule, t: number, n: number, leadMs: number): number | null {
  if (n < 0 || (s.end.rounds !== null && n >= s.end.rounds)) return null;
  if (s.rounds.mode === "offsets") {
    const off = s.rounds.offsets_minutes[n];
    return off === undefined ? null : t + off * MINUTE - leadMs;
  }
  return t + (s.rounds.from_minutes + n * s.rounds.every_minutes) * MINUTE - leadMs;
}

/** The shortest gap between two rounds, or null for a single round. */
export function gapMs(s: Schedule): number | null {
  if (s.rounds.mode === "every")
    return roundCount(s) === 1 ? null : s.rounds.every_minutes * MINUTE;
  const o = s.rounds.offsets_minutes;
  const n = Math.min(o.length, s.end.rounds ?? o.length);
  if (n < 2) return null;
  let gap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < n; i += 1) gap = Math.min(gap, ((o[i] ?? 0) - (o[i - 1] ?? 0)) * MINUTE);
  return gap;
}

/** How long a due round waits for a held region: a quarter of its gap, at most 60 s (SE1). */
export function patienceMs(s: Schedule): number {
  const gap = gapMs(s);
  return gap === null ? ONE_ROUND_PATIENCE_MS : Math.min(MAX_PATIENCE_MS, Math.floor(gap / 4));
}

/**
 * The round to start now, from `next` (the first round not yet handled): the latest whose time
 * has come and whose patience has not run out; the ones before it, and a due one whose time ran
 * out, are `missed` (rounds never stack, a skipped round is not played late).
 */
export function dueRound(
  s: Schedule,
  t: number,
  leadMs: number,
  now: number,
  next: number,
): { play: number | null; missed: number[] } {
  const missed: number[] = [];
  let latest: number | null = null;
  for (let n = next; ; n += 1) {
    const at = roundAt(s, t, n, leadMs);
    if (at === null || at > now) break;
    if (latest !== null) missed.push(latest);
    latest = n;
  }
  if (latest === null) return { play: null, missed };
  const at = roundAt(s, t, latest, leadMs) as number;
  if (now - at > patienceMs(s)) return { play: null, missed: [...missed, latest] };
  return { play: latest, missed };
}

/** Whether round `n` sounds (fix 6): first, every, last or first and last. */
export function roundSounds(s: Pick<Story, "rounds" | "end" | "sound">, n: number): boolean {
  const count = roundCount(s);
  const last = count !== null && n === count - 1;
  switch (s.sound) {
    case "every":
      return true;
    case "first":
      return n === 0;
    case "last":
      return last;
    case "first_and_last":
      return n === 0 || last;
  }
}

/** The local date and time of `ms` in `timeZone`. */
export function localParts(
  ms: number,
  timeZone: string,
): { date: string; hhmm: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "00";
  const hhmm = `${get("hour")}:${get("minute")}`;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hhmm,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** The instant of `hhmm` on the local `date` in `timeZone`. */
export function atLocal(date: string, hhmm: string, timeZone: string): number {
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  // The zone's offset at the guess, applied once and checked once more across a DST change.
  let at = guess;
  for (let i = 0; i < 2; i += 1) {
    const p = localParts(at, timeZone);
    const shown = Date.parse(`${p.date}T${p.hhmm}:00Z`);
    at += guess - shown;
  }
  return at;
}

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The first `hhmm` at or after `from`. */
export function nextClock(from: number, hhmm: string, timeZone: string): number {
  const day = localParts(from, timeZone).date;
  const today = atLocal(day, hhmm, timeZone);
  return today >= from ? today : atLocal(addDays(day, 1), hhmm, timeZone);
}

/** The event's days and times a clock trigger reads. */
export interface EventTimes {
  starts_at: string | null;
  ends_at: string | null;
  timeZone: string;
}

/**
 * The clock trigger's times T near `now`: the latest at or before `now + ahead` and, for a
 * daily or window trigger, the one before it, so a round planned before T (an offset or the
 * on-the-dot lead) is found. Every `every` fire is a run of its own, aligned to its window's start.
 */
export function clockTimes(
  t: Extract<Trigger, { kind: "clock" }>,
  ev: EventTimes,
  now: number,
  aheadMs: number,
): number[] {
  const horizon = now + aheadMs;
  const at = (x: string | null) => (x === null ? [] : [Date.parse(x)]);
  if (t.mode === "once") return at(t.at).filter((x) => !Number.isNaN(x));
  if (t.mode === "event_start") return at(ev.starts_at);
  if (t.mode === "event_end") return at(ev.ends_at);
  const day = localParts(horizon, ev.timeZone).date;
  const days = [addDays(day, -1), day];
  if (t.mode === "daily" && t.at !== null) {
    return days.map((d) => atLocal(d, t.at as string, ev.timeZone)).filter((x) => x <= horizon);
  }
  if (t.mode === "every" && t.from !== null && t.until !== null && t.every_minutes !== null) {
    const out: number[] = [];
    for (const d of days) {
      const from = atLocal(d, t.from, ev.timeZone);
      let until = atLocal(d, t.until, ev.timeZone);
      if (until <= from) until += 86_400_000;
      for (let x = from; x <= until && x <= horizon; x += t.every_minutes * MINUTE) out.push(x);
    }
    return out.slice(-2);
  }
  return [];
}

/** The time a loop ends by itself, by `for` or `until_clock` (the earliest), or null. */
export function plannedEnd(
  s: Pick<Story, "end">,
  t: number,
  startedAt: number,
  timeZone: string,
): number | null {
  const ends: number[] = [];
  if (s.end.for_minutes !== null) ends.push(startedAt + s.end.for_minutes * MINUTE);
  if (s.end.until_clock !== null) ends.push(nextClock(t, s.end.until_clock, timeZone));
  return ends.length === 0 ? null : Math.min(...ends);
}
