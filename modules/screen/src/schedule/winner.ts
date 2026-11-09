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

/** `agendaItemId` may be left out: only a string makes a window agenda-bound. */
export type WeeklyWindow = WindowBase & WeeklyTimes & { agendaItemId?: null };
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
  return typeof window.agendaItemId === "string";
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
  const active = activeSince(window, at, input, () => localClock(at, input.timeZone));
  return active === null ? null : new Date(startMs(active, input.timeZone));
}

/** An active window and what its start needs: a bound item's instant, or a weekly wall time. */
type Active =
  { window: ScheduleWindow; startedMs: number } | { window: WeeklyWindow; wallStartMs: number };

function activeSince(
  window: ScheduleWindow,
  at: Date,
  input: SchedulerInput,
  readClock: () => LocalClock,
): Active | null {
  if (isAgendaWindow(window)) {
    const item = runningItem(window, at, input);
    return item === null ? null : { window, startedMs: item.startsAt.getTime() };
  }
  const clock = readClock();
  const elapsed = minutesSinceStart(window, clock.isoDay, clock.minuteOfDay);
  if (elapsed === null) return null;
  // The start as a wall-clock time written in UTC terms: `elapsed` wall minutes before now.
  const wallNowMs =
    Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS + clock.offsetMinutes * MINUTE_MS;
  return { window, wallStartMs: wallNowMs - elapsed * MINUTE_MS };
}

const MINUTE_MS = 60_000;
// Every UTC offset lies within ±14 hours, so the offsets at these distances bracket every
// switch the start could be near (no zone switches twice within a day).
const BRACKET_MS = 14 * 60 * MINUTE_MS;

/**
 * The real instant a weekly window's run began. A wall time maps to one instant, to none (the
 * spring switch skipped it: the run began when the clock jumped past it) or to two (the autumn
 * switch repeated it: the earlier one if the window ran through the switch, else the later).
 */
function startMs(active: Active, timeZone: string): number {
  if ("startedMs" in active) return active.startedMs;
  const { window, wallStartMs } = active;
  const offsetMs = (t: number) => localClock(new Date(t), timeZone).offsetMinutes * MINUTE_MS;
  const before = offsetMs(wallStartMs - BRACKET_MS);
  const after = offsetMs(wallStartMs + BRACKET_MS);
  if (before === after) return wallStartMs - before;
  const instants = [wallStartMs - before, wallStartMs - after].sort((x, y) => x - y);
  const [early, late] = instants as [number, number];
  const valid = instants.filter((t) => t + offsetMs(t) === wallStartMs);
  if (valid.length === 2) {
    const justBefore = localClock(new Date(late - MINUTE_MS), timeZone);
    const ranThrough =
      minutesSinceStart(window, justBefore.isoDay, justBefore.minuteOfDay) !== null;
    return ranThrough ? early : late;
  }
  if (valid.length === 1) return valid[0] as number;
  // Skipped: the first minute whose wall time has passed the start is the switch itself.
  let low = early;
  let high = late;
  while (high - low > MINUTE_MS) {
    const mid = low + Math.floor((high - low) / 2 / MINUTE_MS) * MINUTE_MS;
    if (mid + offsetMs(mid) >= wallStartMs) high = mid;
    else low = mid;
  }
  return high;
}

/**
 * The winner among the windows active at `at`: the highest priority, then the later start, then
 * the playlist's priority, then the id, so every container picks the same one. "Later start" is
 * the real instant the occurrence began, so a window still running from last night ranks below
 * one that began this morning (legacy compared the start minute alone) and bound windows compare
 * with weekly ones. Starts cost several clock reads, so they are worked out only on a tie.
 */
export function resolveWinner(input: SchedulerInput, at: Date): ScheduleWindow | null {
  let clock: LocalClock | undefined;
  const readClock = () => (clock ??= localClock(at, input.timeZone));
  let top: Active[] = [];
  let topPriority = -1;
  for (const window of input.windows) {
    if (window.priority < topPriority) continue;
    const active = activeSince(window, at, input, readClock);
    if (active === null) continue;
    if (window.priority > topPriority) {
      top = [];
      topPriority = window.priority;
    }
    top.push(active);
  }
  if (top.length <= 1) return top[0]?.window ?? null;
  const ranked = top.map((active) => ({
    window: active.window,
    startedMs: startMs(active, input.timeZone),
  }));
  return ranked.reduce((best, next) => (outranks(next, best, input) ? next : best)).window;
}

function outranks(
  a: { window: ScheduleWindow; startedMs: number },
  b: { window: ScheduleWindow; startedMs: number },
  input: SchedulerInput,
): boolean {
  if (a.startedMs !== b.startedMs) return a.startedMs > b.startedMs;
  const playlistA = input.playlistPriorities?.get(a.window.playlistId) ?? 0;
  const playlistB = input.playlistPriorities?.get(b.window.playlistId) ?? 0;
  if (playlistA !== playlistB) return playlistA > playlistB;
  return a.window.id < b.window.id;
}
