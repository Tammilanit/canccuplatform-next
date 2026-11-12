/**
 * What the schedule page says about a zone beside its calendar: what plays now and how many windows
 * overlap there, when the winner next changes, every conflict (a window that loses, and the rule
 * it lost on) and the gaps where no window runs, so the hero's idle rule shows. Adapted from the
 * legacy signage `schedule-insights.ts`, which asked the scheduler minute by minute; here it reads
 * the calendar answer, whose segments already hold the scheduler's winners.
 */
import type { LostOn, Span, ZoneCalendar } from "../schedule/calendar.js";

export interface Conflict extends Span {
  winner: string;
  loser: string;
  lost_on: LostOn;
}

export interface ZoneInsight {
  now: { winner: string; overlapping: number; until: string } | null;
  next: { at: string; winner: string | null } | null;
  conflicts: Conflict[];
  gaps: Span[];
}

/** `range` is the calendar's own (`from`, `to`): gaps and the next change stay within it. */
export function zoneInsight(zone: ZoneCalendar, nowMs: number, range: Span): ZoneInsight {
  const current = zone.segments.find(
    (s) => Date.parse(s.starts_at) <= nowMs && nowMs < Date.parse(s.ends_at),
  );
  return {
    now:
      current === undefined
        ? null
        : {
            winner: current.winner,
            overlapping: current.losers.length + 1,
            until: current.ends_at,
          },
    next: nextChange(zone, nowMs, current?.winner ?? null, Date.parse(range.ends_at)),
    conflicts: conflicts(zone),
    gaps: gapsWithin(zone, range),
  };
}

/**
 * The first instant after now at which another window, or none, wins. `at` is how far the one
 * playing now (or nothing) is known to go on.
 */
function nextChange(zone: ZoneCalendar, nowMs: number, winner: string | null, endMs: number) {
  let at = nowMs;
  for (const s of zone.segments) {
    const start = Date.parse(s.starts_at);
    if (Date.parse(s.ends_at) <= nowMs) continue;
    if (start > at) {
      return winner === null
        ? { at: s.starts_at, winner: s.winner as string | null }
        : { at: new Date(at).toISOString(), winner: null };
    }
    if (s.winner !== winner) return { at: s.starts_at, winner: s.winner as string | null };
    at = Date.parse(s.ends_at);
  }
  // Past the range nothing is known, so a winner that runs to its end has no change to name.
  return winner === null || at >= endMs ? null : { at: new Date(at).toISOString(), winner: null };
}
/** One line per loser and winner over consecutive segments, as the organiser reads it. */
function conflicts(zone: ZoneCalendar): Conflict[] {
  const out: Conflict[] = [];
  for (const s of zone.segments) {
    for (const l of s.losers) {
      const same = out.find(
        (c) =>
          c.winner === s.winner &&
          c.loser === l.schedule_id &&
          c.lost_on === l.lost_on &&
          c.ends_at === s.starts_at,
      );
      if (same !== undefined) same.ends_at = s.ends_at;
      else
        out.push({
          starts_at: s.starts_at,
          ends_at: s.ends_at,
          winner: s.winner,
          loser: l.schedule_id,
          lost_on: l.lost_on,
        });
    }
  }
  return out;
}

function gapsWithin(zone: ZoneCalendar, range: Span): Span[] {
  const gaps: Span[] = [];
  let at = Date.parse(range.starts_at);
  const end = Date.parse(range.ends_at);
  if (Number.isNaN(at) || Number.isNaN(end)) return gaps;
  for (const s of zone.segments) {
    const start = Date.parse(s.starts_at);
    if (start > at) gaps.push({ starts_at: new Date(at).toISOString(), ends_at: s.starts_at });
    at = Math.max(at, Date.parse(s.ends_at));
  }
  if (at < end) gaps.push({ starts_at: new Date(at).toISOString(), ends_at: range.ends_at });
  return gaps;
}
