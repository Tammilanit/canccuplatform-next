/**
 * "What plays at…" on the schedule page (#267, plan #190 S3; mockup 09): a day of the event and a
 * 24 h time in its time zone, and a zone, answered by simulate (the API's
 * `GET /schedules/simulate`) from the same read, then told region by region as the screen would
 * show it: the hero's playlist and its item then, the rail's now and next, the ticker's line, the
 * next break, and why a run-of-show delay moved what plays. Why the winner won comes from the
 * calendar's segment at that instant: the same `resolveWinner` judged both, so the reasons never
 * disagree with the answer. A form the page answers itself, so it works without the page's
 * script and holds no time-zone arithmetic in the browser. The view is schedule-at-view.ts.
 */
import type { AgendaItem } from "../compose/widgets.js";
import { railAt } from "../compose/widgets.js";

export { railAt };
import type { Layout, Role } from "../compose/layouts.js";
import { BUILT_IN_LAYOUTS, roleOf } from "../compose/layouts.js";
import type { Sources } from "../compose/sources.js";
import { readCalendar } from "../content/calendar.js";
import { simulateRead } from "../content/schedules.js";
import type { ScheduleDeps } from "../content/schedules.js";
import { resolveFrame, resumeBookmark, START_BOOKMARK } from "../playback/engine.js";
import type { CalendarSegment, LostOn } from "../schedule/calendar.js";
import type { Simulation } from "../schedule/simulate.js";
import { localClock } from "../schedule/window.js";
import { tickerNow } from "../ticker/store.js";
import type { TickerNow } from "../ticker/resolve.js";
import { isDate, localDate, wallInstant } from "./schedule-axis.js";
import type { ViewContext } from "./views.js";

/** What the page needs of a window to say what plays: the API's `Schedule`. */
export interface WindowFacts {
  id: string;
  playlist_id: string;
  priority: number;
  layout_id: string | null;
  days?: number[];
  start_minute?: number;
  end_minute?: number;
  agenda_item_id: string | null;
}

/** A bound window whose item the run of show moved, and so what plays then. */
export interface Moved {
  schedule_id: string;
  /** The item's title, or null when the reader may not see it (a crew item). */
  title: string | null;
  /** `runs`: it plays because of its item now; `ended`: its item's moved end made way. */
  how: "runs" | "ended";
  ends_at: string | null;
  minutes: number;
}

export interface Answer extends Simulation {
  beat: { schedule_id: string; lost_on: LostOn }[];
  /** The regions the layout then has, so the answer names only what the screen shows. */
  roles: ReadonlySet<Role>;
  /** The hero's item then, 1-based; `empty` when nothing in it plays; null for a past time. */
  item: { index: number; count: number } | "empty" | null;
  /** The rail's run of show then; null when the agenda could not be read. */
  rail: { now: AgendaItem[]; next: AgendaItem | null } | null;
  ticker: TickerNow;
  /** The next break after the asked time; null without one ahead, or for a past time. */
  nextBreak: { at: string; seconds: number } | null;
  /** The zone's break playlist when it has one only, so the answer can name it. */
  breakPlaylist: { name: string; everySeconds: number } | null;
  moved: Moved | null;
}

export interface WhatPlays {
  /** The day (`YYYY-MM-DD`) and the `HH:MM` asked, or now's. */
  day: string;
  time: string;
  zone: string;
  /** Null when nothing was asked; `bad` when the time could not be read. */
  answer: Answer | "bad" | null;
}

export interface AtDeps extends Pick<ScheduleDeps, "db" | "settings"> {
  sources: Sources;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HOUR_MS = 60 * 60 * 1000;

const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export async function readWhatPlays(
  deps: AtDeps,
  c: ViewContext,
  q: { tenantId: string; layouts: readonly Layout[] },
  zone: string | undefined,
  asked: { day: string | undefined; time: string | undefined },
): Promise<WhatPlays> {
  const nowDay = localDate(c.nowMs, c.timeZone);
  const nowTime = clock(localClock(new Date(c.nowMs), c.timeZone).minuteOfDay);
  // A query value may be an array (a repeated key) or an unreal date, whatever its type says.
  const day: unknown = asked.day ?? nowDay;
  const time: unknown = asked.time ?? nowTime;
  if (!isDate(day)) return { day: "", time: "", zone: zone ?? "", answer: "bad" };
  if (zone === undefined || asked.time === undefined)
    return { day, time: nowTime, zone: zone ?? "", answer: null };
  const m = typeof time === "string" ? TIME_RE.exec(time) : null;
  if (m === null) return { day, time: "", zone, answer: "bad" };
  const atMs = wallInstant(day, Number(m[1]) * 60 + Number(m[2]), c.timeZone);
  const read = await simulateRead(deps, c.timeZone, zone, atMs, c.nowMs);
  const sim = read.simulation;
  const [segments, ticker] = await deps.db.tenant(
    async (t) =>
      [
        // A day back, so the run that holds the asked time starts where it really starts.
        (
          await readCalendar(t, {
            from: new Date(atMs - 24 * HOUR_MS),
            to: new Date(atMs + 60_000),
            zone,
            timeZone: c.timeZone,
            revealCrew: false,
          })
        ).zones[0]?.segments ?? [],
        await tickerNow(t, c.timeZone, atMs),
      ] as const,
  );
  const here = segments.findIndex(
    (s) => Date.parse(s.starts_at) <= atMs && atMs < Date.parse(s.ends_at),
  );
  const segment = segments[here];
  const beat = segment?.winner === sim.schedule_id ? segment.losers : [];
  const agenda = await deps.sources.agendaItems(q.tenantId).catch(() => null);
  const layout =
    q.layouts.find((l) => l.id === sim.layout_id) ?? BUILT_IN_LAYOUTS.find((l) => l.id === "pulse");
  const playlist =
    sim.playlist_id === null ? undefined : read.content.playlists.get(sim.playlist_id);
  let item: Answer["item"] = null;
  // The present's bookmarks say nothing of the past, so only an instant ahead has an item.
  if (playlist !== undefined && atMs >= c.nowMs) {
    const since = Math.max(runStart(segments, here, atMs), c.nowMs);
    const bookmark = resumeBookmark(read.state.bookmarks[playlist.id] ?? START_BOOKMARK, since);
    const frame = resolveFrame(playlist, read.content.assets, bookmark, atMs);
    const index = playlist.items.findIndex((i) => i.id === frame?.itemId);
    item = index >= 0 ? { index: index + 1, count: playlist.items.length } : "empty";
  }
  const only = read.breakInput.playlists.length === 1 ? read.breakInput.playlists[0] : undefined;
  const next = read.breaks.find((b) => b.startsAt.getTime() > atMs);
  return {
    day,
    time: m[0],
    zone,
    answer: {
      ...sim,
      beat,
      roles: new Set((layout?.regions ?? []).flatMap((r) => roleOf(r.id, undefined) ?? [])),
      item,
      rail: agenda === null ? null : railAt(agenda, zone, atMs),
      ticker,
      nextBreak:
        next === undefined
          ? null
          : {
              at: next.startsAt.toISOString(),
              seconds: Math.round((next.endsAt.getTime() - next.startsAt.getTime()) / 1000),
            },
      breakPlaylist:
        only === undefined ? null : { name: only.name, everySeconds: only.break.periodSeconds },
      moved: movedAt(c, { sim, segments, here, atMs, agenda }, (id) => {
        const w = read.content.windows.find((x) => x.id === id);
        return typeof w?.agendaItemId === "string" ? w.agendaItemId : null;
      }),
    },
  };
}

/** Where the winner's run at `atMs` began: back over the segments it won without a gap. */
function runStart(segments: readonly CalendarSegment[], here: number, atMs: number): number {
  if (here < 0) return atMs;
  let i = here;
  while (
    i > 0 &&
    segments[i - 1]?.winner === segments[here]?.winner &&
    segments[i - 1]?.ends_at === segments[i]?.starts_at
  ) {
    i--;
  }
  return Date.parse(segments[i]?.starts_at ?? new Date(atMs).toISOString());
}

/** Minutes a delay moved the item: its start's delay, else its end's (a running item's end). */
function shiftOf(item: AgendaItem): number {
  if (item.delay_minutes !== 0) return item.delay_minutes;
  if (!item.planned_ends_at || item.ends_at === null) return 0;
  return Math.round((Date.parse(item.ends_at) - Date.parse(item.planned_ends_at)) / 60_000);
}

/**
 * Why a bound window decides what plays at `atMs` with times the run of show moved: it plays
 * then, or it won up to the moment the asked time's run began (or, with nothing playing, up to
 * the last change before it) and its item's moved end ended it.
 */
function movedAt(
  c: ViewContext,
  r: {
    sim: Simulation;
    segments: readonly CalendarSegment[];
    here: number;
    atMs: number;
    agenda: readonly AgendaItem[] | null;
  },
  boundTo: (scheduleId: string) => string | null,
): Moved | null {
  const { sim, segments, here, atMs, agenda } = r;
  if (agenda === null) return null;
  const byId = new Map(agenda.map((i) => [i.id, i]));
  const facts = (scheduleId: string, how: Moved["how"]): Moved | null => {
    const id = boundTo(scheduleId);
    const item = id === null ? undefined : byId.get(id);
    if (item === undefined || shiftOf(item) === 0) return null;
    const open = item.visibility === "public" || item.visibility === "attendees";
    return {
      schedule_id: scheduleId,
      title: open || c.rights.has("agenda.crew.read") ? item.title : null,
      how,
      ends_at: item.ends_at,
      minutes: shiftOf(item),
    };
  };
  if (sim.schedule_id !== null) {
    const runs = facts(sim.schedule_id, "runs");
    if (runs !== null) return runs;
  }
  const edge = here >= 0 ? Date.parse(segments[here]?.starts_at ?? "") : atMs;
  const before = segments.filter((s) => Date.parse(s.ends_at) <= edge).at(-1);
  if (before === undefined || (here >= 0 && Date.parse(before.ends_at) !== edge)) return null;
  const ended = facts(before.winner, "ended");
  const endsAt = ended?.ends_at;
  return ended !== null && endsAt != null && Date.parse(endsAt) === Date.parse(before.ends_at)
    ? ended
    : null;
}
