// The calendar's pointer maths, ported from the legacy signage `calendar-pointer.test.ts`. Its
// `createDragSelectionStyle` case becomes `placement`: inline styles are refused by the Studio's
// CSP, so a block's place goes into the page's nonce'd style block as numbers.
import { describe, expect, test } from "vitest";

import {
  minuteFromDayOffset,
  normalizeDragRange,
  placement,
  snapMinuteDelta,
  snapMinuteOfDay,
} from "../src/studio/calendar-pointer.js";

describe("calendar-pointer", () => {
  test("snaps minutes to 15-minute grid", () => {
    expect(snapMinuteOfDay(0)).toBe(0);
    expect(snapMinuteOfDay(7)).toBe(0);
    expect(snapMinuteOfDay(8)).toBe(15);
    expect(snapMinuteOfDay(4 * 60 + 7)).toBe(4 * 60);
    expect(snapMinuteOfDay(1439)).toBe(1440);
  });

  test("maps vertical offset to minute of day", () => {
    expect(minuteFromDayOffset(0, 1440)).toBe(0);
    expect(minuteFromDayOffset(720, 1440)).toBe(12 * 60);
    expect(minuteFromDayOffset(5000, 1440)).toBe(1440);
    expect(minuteFromDayOffset(10, 0)).toBe(0);
  });

  test("normalizes drag ranges with minimum duration", () => {
    expect(normalizeDragRange(60, 60)).toEqual({ startMinute: 60, endMinute: 75 });
    expect(normalizeDragRange(11 * 60, 9 * 60)).toEqual({
      startMinute: 9 * 60,
      endMinute: 11 * 60,
    });
    expect(normalizeDragRange(1440, 1440)).toEqual({ startMinute: 1440, endMinute: 1440 });
  });

  test("snaps a drag's move to whole quarters", () => {
    expect(snapMinuteDelta(22)).toBe(15);
    expect(snapMinuteDelta(-38)).toBe(-45);
  });

  test("places a block by percent of the day, never thinner than one quarter", () => {
    expect(placement(9 * 60, 11 * 60)).toEqual({ top: 37.5, height: (120 / 1440) * 100 });
    expect(placement(600, 601).height).toBeCloseTo((15 / 1440) * 100);
  });
});
