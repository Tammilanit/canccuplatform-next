/**
 * The week calendar's view-model for the Studio's schedule page (plan #190, S2): the event's days
 * as columns, one lane per zone, each segment of the calendar answer cut at local midnights into
 * blocks with the winner first and the windows it beat below it. Adapted from the legacy signage
 * `week-calendar-model.ts`: legacy cut a generic week at the windows' minutes and asked the
 * scheduler for each block's winner; here the calendar answer already holds the scheduler's
 * winners for real instants (`src/schedule/calendar.ts`), so this only lays them out by day.
 * Blocks sit at the local wall time of their edges, the time the organiser set and the hour lines
 * show, so a window from 01:00 to 04:00 reads that way also on the day the clock skips an hour.
 */
import type { AgendaLabel } from "../content/agenda.js";
import type { Calendar } from "../content/calendar.js";
import type { CalendarWindow, LostOn, ZoneCalendar } from "../schedule/calendar.js";
import { localClock, MINUTES_PER_DAY } from "../schedule/window.js";

export interface ScheduleModelInput {
  calendar: Calendar;
  /** The columns: local dates (`YYYY-MM-DD`) in the event's time zone, in order. */
  days: readonly string[];
  zoneNames: ReadonlyMap<string, string>;
  playlistNames: ReadonlyMap<string, string>;
  /** The run-of-show items' titles; a crew item's is used only when the calendar gave its id. */
  labels: ReadonlyMap<string, AgendaLabel>;
  nowMs: number;
}

export interface ScheduleRow {
  scheduleId: string;
  playlistId: string;
  playlistName: string;
  priority: number;
  winner: boolean;
  lostOn: LostOn | null;
  /** The run-of-show item a bound window follows; null for a weekly window. */
  boundTo: { title: string | null; crew: boolean } | null;
}

export interface ScheduleBlock {
  startMinute: number;
  endMinute: number;
  startsAt: string;
  endsAt: string;
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** The winner first, then the windows it beat, the closest (highest priority) first. */
  rows: ScheduleRow[];
}

export interface ScheduleLane {
  zoneKey: string;
  zoneName: string;
  blocks: ScheduleBlock[];
  /** Where the zone's break playlists may interrupt it, merged. */
  breaks: { startMinute: number; endMinute: number }[];
}

export interface ScheduleDay {
  date: string;
  lanes: ScheduleLane[];
}

export interface ScheduleModel {
  days: ScheduleDay[];
  now: { date: string; minute: number } | null;
}

const DAY_MS = 86_400_000;
const WEEK = 7;

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

/** The instant a local date begins: its midnight, found from the zone's offset there. */
export function dayStartMs(date: string, timeZone: string): number {
  const wallMs = Date.parse(`${date}T00:00:00Z`);
  const guess = wallMs - localClock(new Date(wallMs), timeZone).offsetMinutes * 60_000;
  return wallMs - localClock(new Date(guess), timeZone).offsetMinutes * 60_000;
}

/**
 * The event's days: from its start's local date to the local date its end reaches into; a week
 * from today while it has no dates (a draft).
 */
export function eventDays(
  startsAt: string | undefined,
  endsAt: string | undefined,
  timeZone: string,
  nowMs: number,
): string[] {
  const start = startsAt === undefined ? NaN : Date.parse(startsAt);
  const end = endsAt === undefined ? NaN : Date.parse(endsAt);
  const first = localDate(Number.isNaN(start) ? nowMs : start, timeZone);
  const last =
    Number.isNaN(start) || Number.isNaN(end) || end <= start
      ? addDays(first, WEEK - 1)
      : localDate(end - 1, timeZone);
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Seven days at a time, from the day asked for (or the first), so one read stays a week. */
export function pageOfDays(
  days: readonly string[],
  from: string | undefined,
): { days: string[]; prev: string | null; next: string | null } {
  const at = from === undefined ? -1 : days.indexOf(from);
  const start = at < 0 ? 0 : at;
  return {
    days: days.slice(start, start + WEEK),
    prev: start === 0 ? null : (days[Math.max(0, start - WEEK)] ?? null),
    next: days[start + WEEK] ?? null,
  };
}

function wallMinute(ms: number, timeZone: string): number {
  return localClock(new Date(ms), timeZone).minuteOfDay;
}

export function scheduleModel(input: ScheduleModelInput): ScheduleModel {
  const { calendar } = input;
  const tz = calendar.time_zone;
  const bounds = input.days.map((date) => ({
    date,
    startMs: dayStartMs(date, tz),
    endMs: dayStartMs(addDays(date, 1), tz),
  }));
  const days = bounds.map((day) => ({
    date: day.date,
    lanes: calendar.zones.map((zone) => {
      return {
        zoneKey: zone.zone_key,
        zoneName: input.zoneNames.get(zone.zone_key) ?? zone.zone_key,
        blocks: blocksOf(zone, day, input),
        breaks: breakBands(zone, day, tz),
      };
    }),
  }));
  const today = bounds.find((d) => d.startMs <= input.nowMs && input.nowMs < d.endMs);
  return {
    days,
    now: today === undefined ? null : { date: today.date, minute: wallMinute(input.nowMs, tz) },
  };
}

interface DayBounds {
  startMs: number;
  endMs: number;
}

/** The day's piece of each span: its wall minutes, the end at 1440 when it reaches the next day. */
function piece(startsAt: string, endsAt: string, day: DayBounds, tz: string) {
  const s = Date.parse(startsAt);
  const e = Date.parse(endsAt);
  if (e <= day.startMs || s >= day.endMs) return null;
  const startMinute = s <= day.startMs ? 0 : wallMinute(s, tz);
  const endMinute = e >= day.endMs ? MINUTES_PER_DAY : wallMinute(e, tz);
  return {
    startMs: Math.max(s, day.startMs),
    endMs: Math.min(e, day.endMs),
    startMinute,
    // The repeated hour can put an end's wall time before its start's; keep the block visible.
    endMinute: Math.max(endMinute, startMinute + 1),
    continuesBefore: s < day.startMs,
    continuesAfter: e > day.endMs,
  };
}

function blocksOf(zone: ZoneCalendar, day: DayBounds, input: ScheduleModelInput): ScheduleBlock[] {
  const tz = input.calendar.time_zone;
  const windows = new Map(zone.windows.map((w) => [w.schedule_id, w]));
  const blocks: ScheduleBlock[] = [];
  for (const segment of zone.segments) {
    const p = piece(segment.starts_at, segment.ends_at, day, tz);
    if (p === null) continue;
    const losers = [...segment.losers].sort(
      (a, b) =>
        (windows.get(b.schedule_id)?.priority ?? 0) - (windows.get(a.schedule_id)?.priority ?? 0),
    );
    const rows = [
      row(windows.get(segment.winner), segment.winner, null, input),
      ...losers.map((l) => row(windows.get(l.schedule_id), l.schedule_id, l.lost_on, input)),
    ];
    const previous = blocks.at(-1);
    // Legacy's merge: the same winner over the same windows, edge to edge, is one block.
    if (
      previous !== undefined &&
      previous.endMinute === p.startMinute &&
      sameRows(previous.rows, rows)
    ) {
      previous.endMinute = p.endMinute;
      previous.endsAt = new Date(p.endMs).toISOString();
      previous.continuesAfter = p.continuesAfter;
      continue;
    }
    blocks.push({
      startMinute: p.startMinute,
      endMinute: p.endMinute,
      startsAt: new Date(p.startMs).toISOString(),
      endsAt: new Date(p.endMs).toISOString(),
      continuesBefore: p.continuesBefore,
      continuesAfter: p.continuesAfter,
      rows,
    });
  }
  return blocks;
}

function sameRows(a: readonly ScheduleRow[], b: readonly ScheduleRow[]): boolean {
  const ids = (rows: readonly ScheduleRow[]) =>
    rows
      .map((r) => r.scheduleId)
      .sort()
      .join("|");
  return a[0]?.scheduleId === b[0]?.scheduleId && ids(a) === ids(b);
}

function row(
  window: CalendarWindow | undefined,
  scheduleId: string,
  lostOn: LostOn | null,
  input: ScheduleModelInput,
): ScheduleRow {
  const playlistId = window?.playlist_id ?? "";
  const itemId = window?.agenda_item_id ?? null;
  const crew = window?.agenda_item_crew ?? false;
  const bound = itemId !== null || crew;
  return {
    scheduleId,
    playlistId,
    playlistName: input.playlistNames.get(playlistId) ?? playlistId,
    priority: window?.priority ?? 0,
    winner: lostOn === null,
    lostOn,
    boundTo: bound
      ? { title: itemId === null ? null : (input.labels.get(itemId)?.title ?? null), crew }
      : null,
  };
}

function breakBands(zone: ZoneCalendar, day: DayBounds, tz: string) {
  const pieces = zone.breaks
    .flatMap((b) => b.spans)
    .map((s) => piece(s.starts_at, s.ends_at, day, tz))
    .filter((p) => p !== null)
    .sort((a, b) => a.startMinute - b.startMinute);
  const bands: { startMinute: number; endMinute: number }[] = [];
  for (const p of pieces) {
    const last = bands.at(-1);
    if (last !== undefined && p.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, p.endMinute);
    } else {
      bands.push({ startMinute: p.startMinute, endMinute: p.endMinute });
    }
  }
  return bands;
}
