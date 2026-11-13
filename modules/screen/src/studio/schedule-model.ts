/**
 * The week calendar's view-model for the Studio's schedule page (plan #190, S2; mockup 09): the
 * event's days as columns on the hour axis (`schedule-axis.ts`), one lane per zone, and in a lane
 * one block per run of a window, side by side where runs overlap, as mockup 09 draws them. Where a
 * window loses, its block carries the stretch and the window it loses to, from the calendar
 * answer's segments, so every winner shown is the scheduler's own (`src/schedule/calendar.ts`).
 * Adapted from the legacy signage `week-calendar-model.ts`, which drew one block per segment.
 * Blocks sit at the wall time of their edges, the time the organiser set and the hour lines show,
 * so a window from 01:00 to 04:00 reads that way also on the day the clock skips an hour.
 */
import type { AgendaLabel } from "../content/agenda.js";
import type { Calendar } from "../content/calendar.js";
import type { CalendarWindow, LostOn, Span, ZoneCalendar } from "../schedule/calendar.js";
import { addDays, columnSpan, localDate, minuteFrom } from "./schedule-axis.js";
import type { Axis } from "./schedule-axis.js";

export interface ScheduleModelInput {
  calendar: Calendar;
  /** The columns: local dates (`YYYY-MM-DD`) in the event's time zone, in order. */
  days: readonly string[];
  axis: Axis;
  zoneNames: ReadonlyMap<string, string>;
  playlistNames: ReadonlyMap<string, string>;
  /** The run-of-show items' titles; a crew item's is used only when the calendar gave its id. */
  labels: ReadonlyMap<string, AgendaLabel>;
  nowMs: number;
}

/** A piece of a column: wall minutes from the column's midnight, and the instants. */
export interface Piece {
  startMinute: number;
  endMinute: number;
  startsAt: string;
  endsAt: string;
}

export interface Losing extends Piece {
  /** The playlist that plays instead. */
  to: string;
  lostOn: LostOn;
}

export interface ScheduleBlock extends Piece {
  scheduleId: string;
  playlistName: string;
  priority: number;
  /** The run-of-show item a bound window follows; null for a weekly window. */
  boundTo: { title: string | null; crew: boolean } | null;
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Its place among the runs it overlaps: sub-column `column` of `columns`. */
  column: number;
  columns: number;
  /** Where another window plays instead, in order. */
  losing: Losing[];
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
  axis: Axis;
  days: ScheduleDay[];
  now: { date: string; minute: number } | null;
}

const WEEK = 7;

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

export function scheduleModel(input: ScheduleModelInput): ScheduleModel {
  const { calendar, axis } = input;
  const tz = calendar.time_zone;
  const columns = input.days.map((date) => {
    const span = columnSpan(date, axis, tz);
    return { date, startMs: Date.parse(span.starts_at), endMs: Date.parse(span.ends_at) };
  });
  const days = columns.map((column) => ({
    date: column.date,
    lanes: calendar.zones.map((zone) => ({
      zoneKey: zone.zone_key,
      zoneName: input.zoneNames.get(zone.zone_key) ?? zone.zone_key,
      blocks: blocksOf(zone, column, input),
      breaks: breakBands(zone, column, tz),
    })),
  }));
  const today = columns.find((d) => d.startMs <= input.nowMs && input.nowMs < d.endMs);
  return {
    axis,
    days,
    now:
      today === undefined
        ? null
        : { date: today.date, minute: minuteFrom(today.date, input.nowMs, tz) },
  };
}

interface Column {
  date: string;
  startMs: number;
  endMs: number;
}

/** The column's piece of a span, or null when it is not in the column. */
function piece(span: Span, column: Column, tz: string) {
  const s = Date.parse(span.starts_at);
  const e = Date.parse(span.ends_at);
  if (e <= column.startMs || s >= column.endMs) return null;
  const startMs = Math.max(s, column.startMs);
  const endMs = Math.min(e, column.endMs);
  const startMinute = minuteFrom(column.date, startMs, tz);
  return {
    startMinute,
    // The repeated hour can put an end's wall time before its start's; keep the piece visible.
    endMinute: Math.max(minuteFrom(column.date, endMs, tz), startMinute + 1),
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    continuesBefore: s < column.startMs,
    continuesAfter: e > column.endMs,
  };
}

/** Where each window loses in the column; segments lost in a row to one window on one rule are one. */
function losingOf(zone: ZoneCalendar, column: Column, input: ScheduleModelInput) {
  const tz = input.calendar.time_zone;
  const playlistOf = new Map(zone.windows.map((w) => [w.schedule_id, w.playlist_id]));
  const losing = new Map<string, Losing[]>();
  for (const segment of zone.segments) {
    const p = piece(segment, column, tz);
    if (p === null) continue;
    const to = playlistName(playlistOf.get(segment.winner) ?? "", input);
    for (const l of segment.losers) {
      const list = losing.get(l.schedule_id) ?? [];
      const last = list.at(-1);
      if (last?.endsAt === p.startsAt && last.to === to && last.lostOn === l.lost_on) {
        last.endMinute = p.endMinute;
        last.endsAt = p.endsAt;
      } else {
        list.push({
          startMinute: p.startMinute,
          endMinute: p.endMinute,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          to,
          lostOn: l.lost_on,
        });
      }
      losing.set(l.schedule_id, list);
    }
  }
  return losing;
}

function blocksOf(zone: ZoneCalendar, column: Column, input: ScheduleModelInput): ScheduleBlock[] {
  const losing = losingOf(zone, column, input);
  const blocks: ScheduleBlock[] = [];
  for (const window of zone.windows) {
    for (const run of window.runs) {
      const p = piece(run, column, input.calendar.time_zone);
      if (p === null) continue;
      blocks.push({
        ...p,
        scheduleId: window.schedule_id,
        playlistName: playlistName(window.playlist_id, input),
        priority: window.priority,
        boundTo: boundTo(window, input),
        column: 0,
        columns: 1,
        losing: (losing.get(window.schedule_id) ?? []).filter(
          (l) => l.startsAt < p.endsAt && l.endsAt > p.startsAt,
        ),
      });
    }
  }
  return sideBySide(blocks);
}

/**
 * Overlapping runs share their lane's width: each takes the first sub-column free at its start,
 * and a group of runs that overlap one another splits the width between as many as it needed.
 * Of two runs that start together the longer goes first, so a whole-day window stays at the left.
 */
function sideBySide(blocks: ScheduleBlock[]): ScheduleBlock[] {
  blocks.sort(
    (a, b) =>
      a.startMinute - b.startMinute ||
      b.endMinute - a.endMinute ||
      a.priority - b.priority ||
      a.scheduleId.localeCompare(b.scheduleId),
  );
  let group: ScheduleBlock[] = [];
  const ends: number[] = [];
  const close = () => {
    for (const b of group) b.columns = ends.length;
    group = [];
    ends.length = 0;
  };
  for (const block of blocks) {
    if (ends.every((end) => end <= block.startMinute)) close();
    let column = ends.findIndex((end) => end <= block.startMinute);
    if (column < 0) column = ends.length;
    ends[column] = block.endMinute;
    block.column = column;
    group.push(block);
  }
  close();
  return blocks;
}

function playlistName(playlistId: string, input: ScheduleModelInput): string {
  return input.playlistNames.get(playlistId) ?? playlistId;
}

function boundTo(window: CalendarWindow, input: ScheduleModelInput): ScheduleBlock["boundTo"] {
  const itemId = window.agenda_item_id;
  const crew = window.agenda_item_crew;
  if (itemId === null && !crew) return null;
  return { title: itemId === null ? null : (input.labels.get(itemId)?.title ?? null), crew };
}

function breakBands(zone: ZoneCalendar, column: Column, timeZone: string) {
  const pieces = zone.breaks
    .flatMap((b) => b.spans)
    .map((s) => piece(s, column, timeZone))
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
