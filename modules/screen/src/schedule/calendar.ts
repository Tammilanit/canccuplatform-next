/**
 * The schedule calendar of one zone (`GET /api/screen/schedules/calendar`, contracts/screen.md,
 * Schedule windows): each window's runs, the segments with their winner and the rule each loser
 * lost on, and the break playlists' spans. Adapted from the legacy signage
 * `week-calendar-model.ts`, which cut each weekday at the windows' minutes and asked the scheduler
 * for the winner at a segment's midpoint. Here the cuts are real instants and the winner comes from
 * `resolveWinner` itself, so Studio's calendar never holds a second copy of the rule (plan #190,
 * S3), and daylight-saving days come out right without special cases. Pure, like the scheduler.
 */
import type { BreakPlaylist } from "../playback/break-play.js";
import { isInBreakWindowAt } from "../playback/breaks.js";
import { localClock, minutesSinceStart } from "./window.js";
import {
  isAgendaWindow,
  resolveWinner,
  windowStartedAt,
  type ScheduleWindow,
  type SchedulerInput,
  type WeeklyWindow,
} from "./winner.js";

export interface CalendarInput extends SchedulerInput {
  zoneKey: string;
  breakPlaylists: readonly BreakPlaylist[];
  /** The items only crew may read (visibility `crew`). */
  crewItems: ReadonlySet<string>;
  /** Whether the caller holds `agenda.crew.read`; without it a crew item's id is withheld. */
  revealCrew: boolean;
}

export interface Span {
  starts_at: string;
  ends_at: string;
}

export interface CalendarWindow {
  schedule_id: string;
  playlist_id: string;
  priority: number;
  layout_id: string | null;
  agenda_item_id: string | null;
  agenda_item_crew: boolean;
  runs: Span[];
}

export type LostOn = "priority" | "start" | "playlist_priority" | "id";

export interface CalendarSegment extends Span {
  winner: string;
  losers: { schedule_id: string; lost_on: LostOn }[];
}

export interface CalendarBreak {
  playlist_id: string;
  period_seconds: number;
  break_seconds: number;
  spans: Span[];
}

export interface ZoneCalendar {
  zone_key: string;
  windows: CalendarWindow[];
  segments: CalendarSegment[];
  breaks: CalendarBreak[];
}

const MINUTE_MS = 60_000;

interface Run {
  startMs: number;
  endMs: number;
}

/** An open run of a weekly window while the walk goes on: its real start tells one run from the next. */
interface Open {
  fromMs: number;
  startedMs: number;
  elapsed: number;
  atMs: number;
}

export function zoneCalendar(input: CalendarInput, from: Date, to: Date): ZoneCalendar {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const windows = input.windows.filter((w) => w.zoneKey === input.zoneKey);
  const zoneInput: SchedulerInput = { ...input, windows };
  const breaks = input.breakPlaylists.filter(
    (p) => p.break.zones.length === 0 || p.break.zones.includes(input.zoneKey),
  );
  const runs = new Map<string, Run[]>(windows.map((w) => [w.id, []]));
  const spans = new Map<string, Run[]>(breaks.map((p) => [p.id, []]));

  for (const window of windows) {
    if (!isAgendaWindow(window)) continue;
    const item = input.agendaItems?.get(window.agendaItemId);
    if (item === undefined || item.status !== "scheduled" || item.endsAt === null) continue;
    const startMs = Math.max(item.startsAt.getTime(), fromMs);
    const endMs = Math.min(item.endsAt.getTime(), toMs);
    if (startMs < endMs) runs.get(window.id)?.push({ startMs, endMs });
  }
  walkMinutes(input, zoneInput, windows, breaks, fromMs, toMs, runs, spans);

  return {
    zone_key: input.zoneKey,
    windows: windows
      .filter((w) => (runs.get(w.id) ?? []).length > 0)
      .map((w) => windowView(w, runs.get(w.id) ?? [], input)),
    segments: segmentsOf(zoneInput, windows, runs, fromMs, toMs),
    breaks: breaks.map((p) => ({
      playlist_id: p.id,
      period_seconds: p.break.periodSeconds,
      break_seconds: p.break.breakSeconds,
      spans: (spans.get(p.id) ?? []).map(span),
    })),
  };
}

/**
 * Weekly windows and daily break windows change only on whole minutes of the local clock, so one
 * read of the clock per real minute finds every edge, and walking real minutes rather than wall
 * ones keeps the skipped and the repeated hour right. A run goes on while its elapsed time grows a
 * minute a minute; any other step (midnight, a switch of the clock) asks the scheduler when the
 * run began, so a new run is told from the same run across a repeated hour.
 */
function walkMinutes(
  input: CalendarInput,
  zoneInput: SchedulerInput,
  windows: readonly ScheduleWindow[],
  breaks: readonly BreakPlaylist[],
  fromMs: number,
  toMs: number,
  runs: Map<string, Run[]>,
  spans: Map<string, Run[]>,
): void {
  const weekly = windows.filter((w): w is WeeklyWindow => !isAgendaWindow(w));
  const open = new Map<string, Open>();
  const openBreaks = new Map<string, number>();
  const daily = breaks.filter((p) => p.break.windowStartMinute !== null);
  for (const p of breaks) {
    if (p.break.windowStartMinute === null && fromMs < toMs) {
      spans.get(p.id)?.push({ startMs: fromMs, endMs: toMs });
    }
  }
  if (weekly.length === 0 && daily.length === 0) return;
  for (let t = fromMs; t < toMs; t = Math.floor(t / MINUTE_MS) * MINUTE_MS + MINUTE_MS) {
    const clock = localClock(new Date(t), input.timeZone);
    for (const window of weekly) {
      const elapsed = minutesSinceStart(window, clock.isoDay, clock.minuteOfDay);
      const current = open.get(window.id);
      if (elapsed === null) {
        if (current !== undefined) close(runs, window.id, current.fromMs, t, open);
        continue;
      }
      const steps = current === undefined ? 0 : Math.round((t - current.atMs) / MINUTE_MS);
      if (current !== undefined && elapsed === current.elapsed + steps) {
        open.set(window.id, { ...current, elapsed, atMs: t });
        continue;
      }
      const startedMs = windowStartedAt(window, new Date(t), zoneInput)?.getTime() ?? t;
      if (current !== undefined && startedMs === current.startedMs) {
        open.set(window.id, { ...current, elapsed, atMs: t });
        continue;
      }
      if (current !== undefined) close(runs, window.id, current.fromMs, t, open);
      open.set(window.id, { fromMs: t, startedMs, elapsed, atMs: t });
    }
    for (const p of daily) {
      const inside = isInBreakWindowAt(p.break, clock.minuteOfDay);
      const since = openBreaks.get(p.id);
      if (inside && since === undefined) openBreaks.set(p.id, t);
      if (!inside && since !== undefined) {
        spans.get(p.id)?.push({ startMs: since, endMs: t });
        openBreaks.delete(p.id);
      }
    }
  }
  for (const [id, current] of open) close(runs, id, current.fromMs, toMs, open);
  for (const [id, since] of openBreaks) spans.get(id)?.push({ startMs: since, endMs: toMs });
}

function close(
  runs: Map<string, Run[]>,
  id: string,
  startMs: number,
  endMs: number,
  open: Map<string, Open>,
): void {
  runs.get(id)?.push({ startMs, endMs });
  open.delete(id);
}

/**
 * Cut wherever a run starts or ends (a new run of a window that is already active can change the
 * winner, as at midnight), and ask the scheduler for the winner at each cut.
 */
function segmentsOf(
  zoneInput: SchedulerInput,
  windows: readonly ScheduleWindow[],
  runs: ReadonlyMap<string, Run[]>,
  fromMs: number,
  toMs: number,
): CalendarSegment[] {
  const cuts = new Set<number>([fromMs, toMs]);
  for (const list of runs.values()) {
    for (const run of list) {
      cuts.add(run.startMs);
      cuts.add(run.endMs);
    }
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const segments: CalendarSegment[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const startMs = sorted[i] as number;
    const endMs = sorted[i + 1] as number;
    const active = windows.filter((w) =>
      (runs.get(w.id) ?? []).some((r) => r.startMs <= startMs && startMs < r.endMs),
    );
    if (active.length === 0) continue;
    const at = new Date(startMs);
    const winner = resolveWinner(zoneInput, at);
    if (winner === null) continue;
    segments.push({
      ...span({ startMs, endMs }),
      winner: winner.id,
      losers: active
        .filter((w) => w.id !== winner.id)
        .map((w) => ({ schedule_id: w.id, lost_on: lostOn(winner, w, at, zoneInput) })),
    });
  }
  return segments;
}

/** The first rule of the winner choice on which `loser` fell behind (`resolveWinner`'s order). */
function lostOn(
  winner: ScheduleWindow,
  loser: ScheduleWindow,
  at: Date,
  input: SchedulerInput,
): LostOn {
  if (loser.priority !== winner.priority) return "priority";
  const started = (w: ScheduleWindow) => windowStartedAt(w, at, input)?.getTime() ?? 0;
  if (started(loser) !== started(winner)) return "start";
  const priority = (w: ScheduleWindow) => input.playlistPriorities?.get(w.playlistId) ?? 0;
  if (priority(loser) !== priority(winner)) return "playlist_priority";
  return "id";
}

function windowView(
  window: ScheduleWindow,
  list: readonly Run[],
  input: CalendarInput,
): CalendarWindow {
  const itemId = isAgendaWindow(window) ? window.agendaItemId : null;
  const crew = itemId !== null && input.crewItems.has(itemId);
  return {
    schedule_id: window.id,
    playlist_id: window.playlistId,
    priority: window.priority,
    layout_id: window.layoutId,
    agenda_item_id: crew && !input.revealCrew ? null : itemId,
    agenda_item_crew: crew,
    runs: [...list].sort((a, b) => a.startMs - b.startMs).map(span),
  };
}

function span(run: Run): Span {
  return {
    starts_at: new Date(run.startMs).toISOString(),
    ends_at: new Date(run.endMs).toISOString(),
  };
}
