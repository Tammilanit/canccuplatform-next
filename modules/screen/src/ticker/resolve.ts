/**
 * The ticker at an instant (contracts/screen.md, Ticker; 0018): a person's line wins over a
 * weekly ticker window; with neither, nothing. Ported from the legacy `ticker-store.ts`, whose
 * read deleted an expired line; here the clock comes in and nothing is written, so the tick, the
 * routes and the tests share one rule (plan #108, D5).
 */
import {
  MINUTES_PER_DAY,
  localClock,
  minutesSinceStart,
  spansMidnight,
} from "../schedule/window.js";
import type { WeeklyTimes } from "../schedule/window.js";

export interface ManualTicker {
  text: string;
  until: Date | null;
  source: "admin" | "bot";
}

export interface TickerWindowTimes extends WeeklyTimes {
  id: string;
  text: string;
}

/** The contract's `Ticker` without `appearance`, which is a setting, not a state. */
export interface TickerNow {
  text: string | null;
  until: string | null;
  source: "admin" | "bot" | "window" | null;
}

export const NO_TICKER: TickerNow = { text: null, until: null, source: null };

export function resolveTicker(
  manual: ManualTicker | null,
  windows: readonly TickerWindowTimes[],
  timeZone: string,
  at: Date,
): TickerNow {
  if (manual !== null && (manual.until === null || manual.until.getTime() > at.getTime())) {
    return { text: manual.text, until: manual.until?.toISOString() ?? null, source: manual.source };
  }
  const clock = localClock(at, timeZone);
  let best: { window: TickerWindowTimes; elapsed: number } | null = null;
  for (const window of windows) {
    const elapsed = minutesSinceStart(window, clock.isoDay, clock.minuteOfDay);
    if (elapsed === null) continue;
    // The window that began last is the newer message; the id breaks a tie, so every container
    // and every read picks the same one.
    if (
      best === null ||
      elapsed < best.elapsed ||
      (elapsed === best.elapsed && window.id < best.window.id)
    ) {
      best = { window, elapsed };
    }
  }
  if (best === null) return NO_TICKER;
  return {
    text: best.window.text,
    until: occurrenceEnd(
      best.window,
      best.elapsed,
      at,
      clock.offsetMinutes,
      timeZone,
    ).toISOString(),
    source: "window",
  };
}

/**
 * The instant the active occurrence ends: its wall-clock end, converted with the offset in force
 * then, so a window across a daylight-saving switch ends at its written local time.
 */
function occurrenceEnd(
  window: WeeklyTimes,
  elapsed: number,
  at: Date,
  nowOffset: number,
  timeZone: string,
): Date {
  const length = spansMidnight(window.startMinute, window.endMinute)
    ? window.endMinute + MINUTES_PER_DAY - window.startMinute
    : window.endMinute - window.startMinute;
  const minuteMs = Math.floor(at.getTime() / 60_000) * 60_000;
  const wallEndMs = minuteMs + (nowOffset + length - elapsed) * 60_000;
  const guess = new Date(wallEndMs - nowOffset * 60_000);
  return new Date(wallEndMs - localClock(guess, timeZone).offsetMinutes * 60_000);
}
