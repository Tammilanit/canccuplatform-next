/**
 * Which schedule window a zone plays: ported from the legacy signage `resolveActiveSchedule`,
 * extended to windows bound to run-of-show items (contracts/screen.md, Schedule windows).
 * Pure: the time zone, the screen's copy of the agenda items and the playlists' priorities come
 * in, so the tick and simulate share one rule and the tests pin every input.
 */
import { localClock, minutesSinceStart, type LocalClock, type WeeklyTimes } from "./window.js";

interface WindowBase {
  id: string;
  zoneKey: string;
  playlistId: string;
  priority: number;
  layoutId: string | null;
}

export type WeeklyWindow = WindowBase & WeeklyTimes & { agendaItemId: null };
export type AgendaWindow = WindowBase & { agendaItemId: string };
export type ScheduleWindow = WeeklyWindow | AgendaWindow;

/** The screen's copy of a run-of-show item: its current times, so a delay moves the window. */
export interface AgendaTimes {
  id: string;
  startsAt: Date;
  endsAt: Date | null;
  status: "scheduled" | "cancelled";
}

export interface SchedulerInput {
  windows: readonly ScheduleWindow[];
  timeZone: string;
  agendaItems?: ReadonlyMap<string, AgendaTimes>;
  /** Playlist id → the playlist's own priority, the third tie-break; missing is 0. */
  playlistPriorities?: ReadonlyMap<string, number>;
}

export function isAgendaWindow(window: ScheduleWindow): window is AgendaWindow {
  return window.agendaItemId !== null;
}

/**
 * The item a bound window follows, while it runs. A cancelled or removed item, or one with no end
 * (a moment such as "doors open"), never runs a window: it would have no end to stop at.
 */
function runningItem(window: AgendaWindow, at: Date, input: SchedulerInput): AgendaTimes | null {
  const item = input.agendaItems?.get(window.agendaItemId);
  if (item === undefined || item.status !== "scheduled" || item.endsAt === null) return null;
  const t = at.getTime();
  return item.startsAt.getTime() <= t && t < item.endsAt.getTime() ? item : null;
}

/** The instant the window's current occurrence began, or null when it is not active at `at`. */
export function windowStartedAt(
  window: ScheduleWindow,
  at: Date,
  input: SchedulerInput,
): Date | null {
  return startedAt(window, at, input, () => localClock(at, input.timeZone));
}

/** `clock` is read at most once, and only for weekly windows. */
function startedAt(
  window: ScheduleWindow,
  at: Date,
  input: SchedulerInput,
  readClock: () => LocalClock,
): Date | null {
  if (isAgendaWindow(window)) return runningItem(window, at, input)?.startsAt ?? null;
  const clock = readClock();
  const elapsed = minutesSinceStart(window, clock.isoDay, clock.minuteOfDay);
  if (elapsed === null) return null;
  // The local start is `elapsed` wall-clock minutes back; a daylight-saving switch in between
  // makes the real distance an offset change longer or shorter. Two rounds settle the offset at
  // the start even when the first guess lands on the other side of the switch.
  const wallStartMs =
    Math.floor(at.getTime() / 60_000) * 60_000 + (clock.offsetMinutes - elapsed) * 60_000;
  let startMs = wallStartMs - clock.offsetMinutes * 60_000;
  for (let round = 0; round < 2; round += 1) {
    startMs = wallStartMs - localClock(new Date(startMs), input.timeZone).offsetMinutes * 60_000;
  }
  return new Date(startMs);
}

/**
 * The winner among the windows active at `at`: the highest priority, then the later start, then
 * the playlist's priority, then the id, so every container picks the same one. "Later start" is
 * the real instant the occurrence began, so a window still running from last night ranks below
 * one that began this morning (legacy compared the start minute alone) and bound windows compare
 * with weekly ones.
 */
export function resolveWinner(input: SchedulerInput, at: Date): ScheduleWindow | null {
  let clock: LocalClock | undefined;
  const readClock = () => (clock ??= localClock(at, input.timeZone));
  let best: { window: ScheduleWindow; startedMs: number } | null = null;
  for (const window of input.windows) {
    const started = startedAt(window, at, input, readClock);
    if (started === null) continue;
    const candidate = { window, startedMs: started.getTime() };
    if (best === null || outranks(candidate, best, input)) best = candidate;
  }
  return best?.window ?? null;
}

function outranks(
  a: { window: ScheduleWindow; startedMs: number },
  b: { window: ScheduleWindow; startedMs: number },
  input: SchedulerInput,
): boolean {
  if (a.window.priority !== b.window.priority) return a.window.priority > b.window.priority;
  if (a.startedMs !== b.startedMs) return a.startedMs > b.startedMs;
  const playlistA = input.playlistPriorities?.get(a.window.playlistId) ?? 0;
  const playlistB = input.playlistPriorities?.get(b.window.playlistId) ?? 0;
  if (playlistA !== playlistB) return playlistA > playlistB;
  return a.window.id < b.window.id;
}
