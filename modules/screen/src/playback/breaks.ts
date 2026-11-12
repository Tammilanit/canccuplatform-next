/**
 * A zone's breaks (the `break` playlists, the legacy ADVT): which one is due, its daily window,
 * priority chaining and the gap after a chain. Ported from the legacy signage
 * `advt-scheduler.ts`, `advt-window.ts` and `advt-gap-settings.ts`. Legacy kept this state in
 * one global table and wrote it from every read; here it is a value per zone that the tick alone
 * advances and stores, so reading the state never writes (step 3 brief).
 */
import { localClock, MINUTES_PER_DAY, type ValidationResult } from "../schedule/window.js";
import {
  showBreak,
  startingBookmark,
  type BreakPlaylist,
  type BreakPlaylistState,
  type BreakRules,
  type BreakShow,
} from "./break-play.js";
import { pauseBookmark, type Frame } from "./engine.js";
import type { Assets } from "./timeline.js";

export interface BreakState {
  /** By playlist id; only the playlists that interrupt the zone. */
  playlists: Readonly<Record<string, BreakPlaylistState>>;
  active: { playlistId: string; startedAt: number } | null;
  /** When the last chain of breaks ended: the gap counts from here. */
  chainEndedAt: number | null;
}

export const NO_BREAKS: BreakState = { playlists: {}, active: null, chainEndedAt: null };

export interface BreakInput {
  zoneKey: string;
  playlists: readonly BreakPlaylist[];
  assets: Assets;
  timeZone: string;
  /** The event's `break_min_gap_seconds`; 0 turns the gap off. */
  minGapSeconds: number;
}

export interface BreakNow {
  playlistId: string;
  region: BreakRules["region"];
  startedAt: number;
  endsAt: number;
  frame: Frame | null;
}

export interface BreakStep {
  state: BreakState;
  playing: BreakNow | null;
}

/**
 * The daily window in the event's time zone, minute resolution: start inclusive, end exclusive,
 * a start after the end runs past midnight. No window (both bounds null) means always.
 */
export function isInBreakWindow(
  rules: Pick<BreakRules, "windowStartMinute" | "windowEndMinute">,
  atMs: number,
  timeZone: string,
): boolean {
  const { windowStartMinute: start, windowEndMinute: end } = rules;
  if (start === null || end === null) return true;
  return isInBreakWindowAt(rules, localClock(new Date(atMs), timeZone).minuteOfDay);
}

/** The same rule at a local minute of the day, for a caller that already read the clock. */
export function isInBreakWindowAt(
  rules: Pick<BreakRules, "windowStartMinute" | "windowEndMinute">,
  minuteOfDay: number,
): boolean {
  const { windowStartMinute: start, windowEndMinute: end } = rules;
  if (start === null || end === null) return true;
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
}

/** The API's check of a daily window; 1440 is midnight at the end of the day, as in schedules. */
export function validateBreakWindow(start: number | null, end: number | null): ValidationResult {
  if (start === null && end === null) return { ok: true };
  if (start === null || end === null) {
    return { ok: false, error: "Set both the window's start and end, or neither" };
  }
  const minute = (value: number, max: number) =>
    Number.isInteger(value) && value >= 0 && value <= max;
  if (!minute(start, MINUTES_PER_DAY - 1) || !minute(end, MINUTES_PER_DAY)) {
    return { ok: false, error: "The window's times are invalid" };
  }
  if (start === end) return { ok: false, error: "The window's start and end cannot be the same" };
  return { ok: true };
}

/** One tick of the zone's breaks at `nowMs`: the next state and the break playing, if any. */
export function stepBreaks(state: BreakState, input: BreakInput, nowMs: number): BreakStep {
  const eligible = input.playlists.filter(
    (p) =>
      p.type === "break" && (p.break.zones.length === 0 || p.break.zones.includes(input.zoneKey)),
  );
  const entries: Record<string, BreakPlaylistState> = {};
  // A playlist that no longer interrupts the zone leaves its state behind.
  for (const playlist of eligible) {
    const entry = state.playlists[playlist.id];
    if (entry !== undefined) entries[playlist.id] = entry;
  }
  const next: Mutable = {
    playlists: entries,
    active: state.active,
    chainEndedAt: state.chainEndedAt,
  };
  if (next.active === null) return startDue(next, eligible, input, nowMs, false);

  const { playlistId, startedAt } = next.active;
  const playlist = eligible.find((p) => p.id === playlistId);
  const entry = entries[playlistId];
  const show =
    playlist === undefined || entry === undefined
      ? null
      : showBreak(playlist, input.assets, entry, input.zoneKey, startedAt, nowMs);
  if (playlist !== undefined && show !== null && nowMs < show.endsAt) {
    return { state: next, playing: playingOf(playlist, startedAt, show) };
  }
  if (playlist !== undefined && entry !== undefined) {
    const endedAt = show === null ? nowMs : Math.min(nowMs, show.endsAt);
    entries[playlistId] = {
      ...entry,
      bookmark: entry.bookmark && pauseBookmark(playlist, input.assets, entry.bookmark, endedAt),
      nextImageId: show === null ? entry.nextImageId : show.nextImageId,
    };
  }
  next.active = null;
  // The break ended: the next due one follows with nothing between, else the chain is over.
  const chained = startDue(next, eligible, input, nowMs, true);
  if (chained.playing === null) next.chainEndedAt = nowMs;
  return chained;
}

type Mutable = { playlists: Record<string, BreakPlaylistState> } & Omit<BreakState, "playlists">;

function playingOf(playlist: BreakPlaylist, startedAt: number, show: BreakShow): BreakNow {
  const { region } = playlist.break;
  return { playlistId: playlist.id, region, startedAt, endsAt: show.endsAt, frame: show.frame };
}

/**
 * Starts the first due break, in play order: priority, then the earlier due time, then the name,
 * then the id (code units, so every container agrees). A break outside its daily window is
 * skipped before the due check, so it never starts, chains or takes part in the order; its due
 * time is pulled back to now while closed, so it is due at once when the window opens. Only
 * starts are gated: a running break finishes after its window closes.
 */
function startDue(
  next: Mutable,
  eligible: readonly BreakPlaylist[],
  input: BreakInput,
  nowMs: number,
  chaining: boolean,
): BreakStep {
  const due: BreakPlaylist[] = [];
  for (const playlist of eligible) {
    const open = isInBreakWindow(playlist.break, nowMs, input.timeZone);
    const entry = next.playlists[playlist.id];
    if (entry === undefined) {
      const dueAt = open ? nowMs + playlist.break.periodSeconds * 1000 : nowMs;
      next.playlists[playlist.id] = { dueAt, bookmark: null, nextImageId: null };
    } else if (!open) {
      if (entry.dueAt > nowMs) next.playlists[playlist.id] = { ...entry, dueAt: nowMs };
    } else if (entry.dueAt <= nowMs) {
      due.push(playlist);
    }
  }
  const idle = { state: next, playing: null };
  const gapMs = input.minGapSeconds * 1000;
  if (!chaining && gapMs > 0 && next.chainEndedAt !== null && nowMs < next.chainEndedAt + gapMs) {
    return idle;
  }
  const dueAt = (p: BreakPlaylist) => (next.playlists[p.id] as BreakPlaylistState).dueAt;
  due.sort(
    (a, b) =>
      b.priority - a.priority ||
      dueAt(a) - dueAt(b) ||
      compare(a.name, b.name) ||
      compare(a.id, b.id),
  );
  for (const playlist of due) {
    const entry = next.playlists[playlist.id] as BreakPlaylistState;
    const nextDueAt = nowMs + playlist.break.periodSeconds * 1000;
    const started = { ...entry, bookmark: startingBookmark(playlist, entry, nowMs) };
    const show = showBreak(playlist, input.assets, started, input.zoneKey, nowMs, nowMs);
    if (show === null) {
      // Nothing to show: this break is skipped and tries again a period later.
      next.playlists[playlist.id] = { ...entry, dueAt: nextDueAt };
      continue;
    }
    next.playlists[playlist.id] = { ...started, dueAt: nextDueAt };
    next.active = { playlistId: playlist.id, startedAt: nowMs };
    return { state: next, playing: playingOf(playlist, nowMs, show) };
  }
  return idle;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
