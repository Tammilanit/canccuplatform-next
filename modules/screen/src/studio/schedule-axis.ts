/**
 * The schedule calendar's days and hour axis. Mockup 09 draws 12–24, not a whole day: the axis
 * leaves out the longest stretch of the day in which no shown day has a window or a break, and
 * starts an hour before what follows it. When that stretch is the small hours, the axis runs past
 * midnight, so a column reads as the event's day and night: an evening window that goes on until
 * 02:00 stays one block in the column it began in. "Conflicts and gaps" still names the skipped
 * stretch. Minutes count from a column's local midnight on the wall clock, past 1440 after it.
 */
import type { Calendar } from "../content/calendar.js";
import type { Span, ZoneCalendar } from "../schedule/calendar.js";
import { localClock, MINUTES_PER_DAY } from "../schedule/window.js";

export interface Axis {
  /** A whole hour, 0 to 1380. */
  startMinute: number;
  /** A whole hour after the start, at most a day after it. */
  endMinute: number;
}

export const FULL_DAY: Axis = { startMinute: 0, endMinute: MINUTES_PER_DAY };

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const STEP = 15;
const SLOTS = MINUTES_PER_DAY / STEP;
/** A shorter empty stretch is not worth a column that starts at an odd hour. */
const MIN_SKIP = 120;
/** The axis starts this long before the first window or break after the skipped stretch. */
const LEAD = 60;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** The local date (`YYYY-MM-DD`) of an instant in `timeZone`. */
export function localDate(ms: number, timeZone: string): string {
  let f = dateFormatters.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(timeZone, f);
  }
  return f.format(new Date(ms));
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The instant the wall clock shows `minute` minutes after `date`'s midnight; found from the zone's offset there. */
export function wallInstant(date: string, minute: number, timeZone: string): number {
  const wallMs = Date.parse(`${date}T00:00:00Z`) + minute * MINUTE_MS;
  const guess = wallMs - localClock(new Date(wallMs), timeZone).offsetMinutes * MINUTE_MS;
  return wallMs - localClock(new Date(guess), timeZone).offsetMinutes * MINUTE_MS;
}

/** The instant a local date begins: its midnight. */
export function dayStartMs(date: string, timeZone: string): number {
  return wallInstant(date, 0, timeZone);
}

/** The wall-clock minutes from `date`'s midnight to `ms`: past 1440 on the days after it. */
export function minuteFrom(date: string, ms: number, timeZone: string): number {
  const days =
    (Date.parse(`${localDate(ms, timeZone)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS;
  return days * MINUTES_PER_DAY + localClock(new Date(ms), timeZone).minuteOfDay;
}

/** Where a column of the axis begins and ends. */
export function columnSpan(date: string, axis: Axis, timeZone: string): Span {
  return {
    starts_at: new Date(wallInstant(date, axis.startMinute, timeZone)).toISOString(),
    ends_at: new Date(wallInstant(date, axis.endMinute, timeZone)).toISOString(),
  };
}

/** The axis for `days` from what the zones hold between their midnights. */
export function scheduleAxis(
  zones: readonly ZoneCalendar[],
  days: readonly string[],
  timeZone: string,
): Axis {
  const first = days[0];
  const last = days.at(-1);
  if (first === undefined || last === undefined) return FULL_DAY;
  const from = dayStartMs(first, timeZone);
  const to = dayStartMs(addDays(last, 1), timeZone);
  const used = new Array<boolean>(SLOTS).fill(false);
  const slot = (ms: number) => Math.floor(localClock(new Date(ms), timeZone).minuteOfDay / STEP);
  const spans = zones.flatMap((z) => [
    ...z.windows.flatMap((w) => w.runs),
    ...z.breaks.flatMap((b) => b.spans),
  ]);
  for (const s of spans) {
    const start = Math.max(Date.parse(s.starts_at), from);
    const end = Math.min(Date.parse(s.ends_at), to);
    if (end - start >= DAY_MS) return FULL_DAY;
    for (let at = start; at < end; at += STEP * MINUTE_MS) used[slot(at)] = true;
    if (start < end) used[slot(end - 1)] = true;
  }
  if (!used.includes(true)) return FULL_DAY;
  // The longest run of empty slots, going round midnight; it ends where `end` is used again.
  let best = 0;
  let end = 0;
  let run = 0;
  for (let i = 0; i < 2 * SLOTS; i += 1) {
    run = used[i % SLOTS] ? 0 : run + 1;
    if (run > best && run < SLOTS) {
      best = run;
      end = (i + 1) % SLOTS;
    }
  }
  if (best * STEP < MIN_SKIP) return FULL_DAY;
  const emptyFrom = ((end - best + SLOTS) % SLOTS) * STEP;
  const startMinute = Math.max(0, Math.floor((end * STEP - LEAD) / 60) * 60);
  let endMinute = Math.ceil(emptyFrom / 60) * 60;
  if (endMinute <= startMinute) endMinute += MINUTES_PER_DAY;
  return { startMinute, endMinute };
}

/**
 * The calendar between two instants: segments and break spans cut to them, so the side panel
 * speaks of the columns drawn. A window's runs are kept whole, so a block still shows that it
 * goes on before or after a column.
 */
export function clipCalendar(calendar: Calendar, range: Span): Calendar {
  const from = Date.parse(range.starts_at);
  const to = Date.parse(range.ends_at);
  const within = <T extends Span>(spans: readonly T[]): T[] =>
    spans.filter((s) => Date.parse(s.ends_at) > from && Date.parse(s.starts_at) < to);
  const clip = <T extends Span>(spans: readonly T[]): T[] =>
    within(spans).map((s) => ({
      ...s,
      starts_at: new Date(Math.max(Date.parse(s.starts_at), from)).toISOString(),
      ends_at: new Date(Math.min(Date.parse(s.ends_at), to)).toISOString(),
    }));
  return {
    ...calendar,
    from: range.starts_at,
    to: range.ends_at,
    zones: calendar.zones.map((z) => ({
      ...z,
      windows: z.windows.map((w) => ({ ...w, runs: within(w.runs) })),
      segments: clip(z.segments),
      breaks: z.breaks.map((b) => ({ ...b, spans: clip(b.spans) })),
    })),
  };
}
