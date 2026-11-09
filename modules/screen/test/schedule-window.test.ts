// Ported from the legacy signage tests (schedule-window.test.ts, the scheduler half of
// scheduler.test.ts), adapted to the contract's windows: ISO `days` (1 = Monday) instead of one
// Sunday-based day. The calendar drag helpers' tests go with Studio planning (#190).
import { describe, expect, test } from "vitest";

import {
  isWeeklyActiveAt,
  localClock,
  spansMidnight,
  validateWeekly,
} from "../src/schedule/window.js";

const MON = 1;
const TUE = 2;
const SUN = 7;

describe("spansMidnight", () => {
  test("detects overnight when end is before or equal to start", () => {
    expect(spansMidnight(4 * 60, 3 * 60 + 59)).toBe(true);
    expect(spansMidnight(9 * 60, 9 * 60)).toBe(true);
    expect(spansMidnight(9 * 60, 17 * 60)).toBe(false);
  });

  test("an end of 1440 is midnight at the end of the same day, not overnight", () => {
    expect(spansMidnight(22 * 60, 1440)).toBe(false);
  });
});

describe("isWeeklyActiveAt", () => {
  const overnight = { days: [MON], startMinute: 4 * 60, endMinute: 3 * 60 + 59 };

  test("is active late on the start day", () => {
    expect(isWeeklyActiveAt(overnight, MON, 5 * 60)).toBe(true);
    expect(isWeeklyActiveAt(overnight, MON, 3 * 60)).toBe(false);
  });

  test("is active early on the next day", () => {
    expect(isWeeklyActiveAt(overnight, TUE, 2 * 60)).toBe(true);
    expect(isWeeklyActiveAt(overnight, TUE, 4 * 60)).toBe(false);
  });

  test("a Sunday overnight window runs into Monday", () => {
    const sunday = { days: [SUN], startMinute: 22 * 60, endMinute: 2 * 60 };
    expect(isWeeklyActiveAt(sunday, MON, 60)).toBe(true);
    expect(isWeeklyActiveAt(sunday, SUN, 60)).toBe(false);
  });

  test("starts inclusive and ends exclusive", () => {
    const day = { days: [MON], startMinute: 9 * 60, endMinute: 17 * 60 };
    expect(isWeeklyActiveAt(day, MON, 9 * 60)).toBe(true);
    expect(isWeeklyActiveAt(day, MON, 17 * 60 - 1)).toBe(true);
    expect(isWeeklyActiveAt(day, MON, 17 * 60)).toBe(false);
  });

  test("an end of 1440 runs to the last minute of the day", () => {
    const late = { days: [MON], startMinute: 20 * 60, endMinute: 1440 };
    expect(isWeeklyActiveAt(late, MON, 1439)).toBe(true);
    expect(isWeeklyActiveAt(late, TUE, 0)).toBe(false);
  });

  test("every listed day opens the window", () => {
    const weekdays = { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 10 * 60 };
    expect(isWeeklyActiveAt(weekdays, 3, 9 * 60 + 30)).toBe(true);
    expect(isWeeklyActiveAt(weekdays, 6, 9 * 60 + 30)).toBe(false);
  });

  test("an empty window is never active", () => {
    expect(isWeeklyActiveAt({ days: [MON], startMinute: 0, endMinute: 0 }, MON, 0)).toBe(false);
  });
});

describe("localClock", () => {
  test("reads the ISO weekday and minute in the event's time zone", () => {
    // 2026-04-13 is a Monday; 23:00 UTC is 02:00 on Tuesday in Helsinki (UTC+3 in summer).
    expect(localClock(new Date("2026-04-13T23:00:00Z"), "Europe/Helsinki")).toMatchObject({
      isoDay: TUE,
      minuteOfDay: 2 * 60,
      offsetMinutes: 180,
    });
  });

  test("Sunday is 7", () => {
    expect(localClock(new Date("2026-04-12T12:00:00Z"), "UTC").isoDay).toBe(SUN);
  });
});

describe("validateWeekly", () => {
  const ok = { days: [MON], startMinute: 9 * 60, endMinute: 17 * 60 };

  test("accepts a day window", () => {
    expect(validateWeekly(ok)).toEqual({ ok: true });
  });

  test("rejects equal start and end", () => {
    expect(validateWeekly({ ...ok, endMinute: 9 * 60 }).ok).toBe(false);
  });

  test("allows overnight end before start", () => {
    expect(validateWeekly({ ...ok, startMinute: 4 * 60, endMinute: 3 * 60 + 59 }).ok).toBe(true);
  });

  test("allows an end of 1440", () => {
    expect(validateWeekly({ ...ok, endMinute: 1440 }).ok).toBe(true);
  });

  test("rejects a start of 1440, which is the end of the day", () => {
    expect(validateWeekly({ ...ok, startMinute: 1440, endMinute: 60 }).ok).toBe(false);
  });

  test.each([[[]], [[0]], [[8]], [[1, 1]], [[1.5]]])("rejects days %j", (days) => {
    expect(validateWeekly({ ...ok, days }).ok).toBe(false);
  });

  test.each([
    [-1, 60],
    [60, 1441],
    [60.5, 120],
  ])("rejects minutes %d to %d", (startMinute, endMinute) => {
    expect(validateWeekly({ ...ok, startMinute, endMinute }).ok).toBe(false);
  });
});
