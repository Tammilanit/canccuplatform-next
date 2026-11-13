/**
 * Break playlists of one zone whose daily windows share time: they then take turns by priority,
 * with the event's gap between chains, so the organiser is told where. Adapted from the legacy
 * signage `advt-overlap.ts`, which predicted each playlist's break starts from its period and
 * warned at the first two that met. The engine now chains breaks by priority from the tick's own
 * state, so a predicted start would not be what plays; the daily windows are what the organiser
 * sets, and their first shared span is what this names.
 */
import type { CalendarBreak, Span } from "../schedule/calendar.js";

export interface BreakOverlap extends Span {
  a: string;
  b: string;
}

export function breakOverlaps(breaks: readonly CalendarBreak[]): BreakOverlap[] {
  const out: BreakOverlap[] = [];
  for (let i = 0; i < breaks.length; i += 1) {
    for (let j = i + 1; j < breaks.length; j += 1) {
      const a = breaks[i] as CalendarBreak;
      const b = breaks[j] as CalendarBreak;
      const found = firstOverlap(a.spans, b.spans);
      if (found !== null) out.push({ a: a.playlist_id, b: b.playlist_id, ...found });
    }
  }
  return out.sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at));
}

function firstOverlap(left: readonly Span[], right: readonly Span[]): Span | null {
  let best: Span | null = null;
  for (const l of left) {
    for (const r of right) {
      const start = Math.max(Date.parse(l.starts_at), Date.parse(r.starts_at));
      const end = Math.min(Date.parse(l.ends_at), Date.parse(r.ends_at));
      if (start < end && (best === null || start < Date.parse(best.starts_at))) {
        best = { starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() };
      }
    }
  }
  return best;
}
