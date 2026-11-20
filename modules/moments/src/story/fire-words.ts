/**
 * What Fire says it did (#638; P16, V7): a story fired on a later item waits for its rounds, so
 * the crew is told when it plays, in the event's clock and at which round of the item ("at T−15"),
 * never just "Fired." while the screens stay as they are. Pure: the clock comes in.
 */
import type { RunItem } from "../announce/store.js";
import { nextItemOf } from "./fire.js";
import type { Story } from "./model.js";
import { videoMs } from "./runner.js";
import { localParts, patienceMs, plannedEnd, roundAt } from "./schedule.js";
import { compileRound } from "./timing.js";
import type { Timing } from "./timing.js";

export interface FireWhen {
  story: Story;
  /** The run's T: its item's start (or end), or the moment of the fire. */
  t: number;
  /** Fired on an item, so its rounds are named by their offset from T. */
  anchored: boolean;
  settings: Timing;
  /** When the run started (the take's own time for Fire): a `for` end counts from it. */
  startedAt: number;
  /** When its `until_event` comes, as the run of show says (`untilEventAt`), or null. */
  untilAt: number | null;
  now: number;
  timeZone: string;
}

/**
 * When a run's `until_event` comes, from the run of show: its item's start or end, or the next
 * public item's start after T (as fire.ts picks it); null for a domain event or an unknown item.
 */
export function untilEventAt(
  story: Story,
  item: (RunItem & { zone?: string | null }) | undefined,
  agenda: RunItem[],
  t: number,
): number | null {
  const u = story.end.until_event;
  if (u === null || u.kind === "domain") return null;
  if (u.kind === "next_item_starts") {
    const next = nextItemOf(agenda, item?.zone ?? null, t);
    return next === undefined ? null : Date.parse(next.starts_at);
  }
  if (item === undefined) return null;
  const when = u.kind === "item_starts" ? item.starts_at : (item.ends_at ?? null);
  return when === null ? null : Date.parse(when);
}

/** A time in the event's clock, with the weekday when it is not the event's today. */
export function itemTime(iso: string | number, now: number, timeZone: string): string {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  const at = localParts(ms, timeZone);
  if (at.date === localParts(now, timeZone).date) return at.hhmm;
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone }).format(ms);
  return `${day} ${at.hhmm}`;
}

const offsetOf = (s: Story, n: number): number =>
  s.rounds.mode === "offsets"
    ? (s.rounds.offsets_minutes[n] ?? 0)
    : s.rounds.from_minutes + n * s.rounds.every_minutes;

const tLabel = (minutes: number): string =>
  minutes === 0 ? "T" : `T${minutes < 0 ? "−" : "+"}${String(Math.abs(minutes))}`;

/**
 * The first round still to play: its time, its offset from T, and whether it is due now (within
 * its patience). A live loop's due round has already played, so On air asks for later ones only.
 * A round at or after the loop's end never plays (runner.ts ends the run first), so none is named.
 */
function upcoming(
  o: FireWhen,
  takeDue: boolean,
): { at: number; offset: number; due: boolean } | null {
  const lead = compileRound(o.story.round, o.settings, videoMs).lead_ms;
  const patience = takeDue ? patienceMs(o.story) : 0;
  const ends = [plannedEnd(o.story, o.t, o.startedAt, o.timeZone), o.untilAt].filter(
    (x): x is number => x !== null,
  );
  const end = ends.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...ends);
  for (let n = 0; ; n += 1) {
    const at = roundAt(o.story, o.t, n, lead);
    if (at === null || at >= end) return null;
    if (at + patience >= o.now && (takeDue || at > o.now))
      return { at, offset: offsetOf(o.story, n), due: at <= o.now };
  }
}

/** The notice after Fire: "Starting soon starts at 18:45, at T−15." */
export function fireResult(o: FireWhen): string {
  const name = o.story.name;
  const next = upcoming(o, true);
  if (next === null)
    return o.story.finale === null
      ? `${name} has no round left to play.`
      : `${name} plays its finale now.`;
  if (next.due) return `${name} is on now.`;
  const when = itemTime(next.at, o.now, o.timeZone);
  return o.anchored
    ? `${name} starts at ${when}, at ${tLabel(next.offset)}.`
    : `${name} starts at ${when}.`;
}

/** On air's line for a live loop between rounds: "next round 18:55 (T−5)", or null. */
export function nextRound(o: FireWhen): string | null {
  const next = upcoming(o, false);
  if (next === null) return null;
  const when = itemTime(next.at, o.now, o.timeZone);
  return o.anchored ? `next round ${when} (${tLabel(next.offset)})` : `next round ${when}`;
}
