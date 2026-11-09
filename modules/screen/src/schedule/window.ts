/**
 * Weekly windows: wall-clock times in the event's time zone (contracts/screen.md, Content and
 * scheduling). Ported from the legacy signage `schedule-window.ts` and `getScheduleClock`, with
 * the contract's ISO `days` (1 = Monday, several per window) in place of one Sunday-based day.
 * Pure: the clock and the time zone come in, so the daylight-saving tests can pin both.
 */

export const MINUTES_PER_DAY = 1440;

export interface WeeklyTimes {
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  days: readonly number[];
  startMinute: number;
  /** 1440 is midnight at the end of the day. */
  endMinute: number;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** True when the window runs past midnight into the next day. An end of 1440 does not. */
export function spansMidnight(startMinute: number, endMinute: number): boolean {
  return endMinute <= startMinute;
}

export function nextIsoDay(isoDay: number): number {
  return (isoDay % 7) + 1;
}

/**
 * Minutes since the occurrence active at this local day and minute began, or null when none is.
 * An overnight window opened on day d still runs early on the day after d.
 */
export function minutesSinceStart(
  window: WeeklyTimes,
  isoDay: number,
  minuteOfDay: number,
): number | null {
  const { days, startMinute, endMinute } = window;
  if (startMinute === endMinute) return null;
  if (!spansMidnight(startMinute, endMinute)) {
    const inside = days.includes(isoDay) && minuteOfDay >= startMinute && minuteOfDay < endMinute;
    return inside ? minuteOfDay - startMinute : null;
  }
  // A window on two adjacent days is still active at 23:30 of the first: the evening occurrence
  // began later than the one carried over from the night before, so it is checked first.
  if (days.includes(isoDay) && minuteOfDay >= startMinute) return minuteOfDay - startMinute;
  const dayBefore = ((isoDay + 5) % 7) + 1;
  if (days.includes(dayBefore) && minuteOfDay < endMinute) {
    return minuteOfDay + MINUTES_PER_DAY - startMinute;
  }
  return null;
}

export function isWeeklyActiveAt(
  window: WeeklyTimes,
  isoDay: number,
  minuteOfDay: number,
): boolean {
  return minutesSinceStart(window, isoDay, minuteOfDay) !== null;
}

export interface LocalClock {
  isoDay: number;
  minuteOfDay: number;
  /** Local time minus UTC, in minutes, at that instant. */
  offsetMinutes: number;
}

// Building an Intl formatter costs far more than using one; simulate reads the clock once per
// minute of a whole day.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

const ISO_DAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The wall clock of `timeZone` at `at`. Throws a RangeError for an unknown time zone. */
export function localClock(at: Date, timeZone: string): LocalClock {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(at)) parts[part.type] = part.value;
  const isoDay = ISO_DAYS[parts.weekday ?? ""];
  // A silent default would shift every window by days on an ICU that labels weekdays otherwise.
  if (isoDay === undefined) throw new RangeError(`unknown weekday label: ${parts.weekday}`);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const wallMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    minute,
  );
  const atMinuteMs = Math.floor(at.getTime() / 60_000) * 60_000;
  return {
    isoDay,
    minuteOfDay: hour * 60 + minute,
    offsetMinutes: Math.round((wallMs - atMinuteMs) / 60_000),
  };
}

/** The API's check of a weekly window's times; the message is for the organiser. */
export function validateWeekly(window: WeeklyTimes): ValidationResult {
  const { days, startMinute, endMinute } = window;
  if (
    days.length === 0 ||
    new Set(days).size !== days.length ||
    days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  ) {
    return { ok: false, error: "Days must be one or more of Monday (1) to Sunday (7), each once" };
  }
  // 1440 is the end of a day, so a window cannot start there.
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute >= MINUTES_PER_DAY) {
    return { ok: false, error: "Start time is invalid" };
  }
  if (!Number.isInteger(endMinute) || endMinute < 0 || endMinute > MINUTES_PER_DAY) {
    return { ok: false, error: "End time is invalid" };
  }
  if (startMinute === endMinute) {
    return { ok: false, error: "Start and end time cannot be the same" };
  }
  return { ok: true };
}
