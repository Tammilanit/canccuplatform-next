/** The event day (D4, E8): it turns at 06:00 in the event's time zone, across a clock change too. */
import { describe, expect, it } from "vitest";
import { dayTurn, eventDay, formatDayLabel, localTime, withOffset } from "../src/time.js";

const HKI = "Europe/Helsinki";

describe("eventDay", () => {
  it("keeps a 01:00 order on the night it was in", () => {
    expect(eventDay(new Date("2026-11-21T23:00:00Z"), HKI)).toBe("2026-11-21"); // 01:00 local
    expect(eventDay(new Date("2026-11-22T03:59:00Z"), HKI)).toBe("2026-11-21"); // 05:59 local
    expect(eventDay(new Date("2026-11-22T04:00:00Z"), HKI)).toBe("2026-11-22"); // 06:00 local
  });
  it("follows the zone on both sides of the October clock change", () => {
    expect(eventDay(new Date("2026-10-24T03:30:00Z"), HKI)).toBe("2026-10-24"); // 06:30, +3
    expect(eventDay(new Date("2026-10-26T03:30:00Z"), HKI)).toBe("2026-10-25"); // 05:30, +2
  });
  it("turns at 06:00 local on the March night the clocks go forward", () => {
    expect(eventDay(new Date("2026-03-29T03:30:00Z"), HKI)).toBe("2026-03-29"); // 06:30, +3
    expect(eventDay(new Date("2026-03-29T02:59:00Z"), HKI)).toBe("2026-03-28"); // 05:59, +3
    expect(eventDay(new Date("2026-03-29T00:30:00Z"), HKI)).toBe("2026-03-28"); // 02:30, +2
  });
  it("uses UTC as given", () => {
    expect(eventDay(new Date("2026-01-01T05:59:59Z"), "UTC")).toBe("2025-12-31");
  });
});

describe("dayTurn", () => {
  it("is 06:00 local on the day after", () => {
    expect(dayTurn("2026-11-21", HKI).toISOString()).toBe("2026-11-22T04:00:00.000Z");
    expect(dayTurn("2026-10-24", HKI).toISOString()).toBe("2026-10-25T04:00:00.000Z"); // +2 by then
    expect(dayTurn("2026-01-01", "UTC").toISOString()).toBe("2026-01-02T06:00:00.000Z");
  });
});

describe("formatting", () => {
  it("shows local times on both sides of the clock change", () => {
    expect(localTime(new Date("2026-10-24T16:00:00Z"), HKI)).toBe("19:00");
    expect(localTime(new Date("2026-10-26T16:00:00Z"), HKI)).toBe("18:00");
  });
  it("writes ISO 8601 with the event's offset, as the export's ordered_at", () => {
    expect(withOffset(new Date("2026-11-21T15:20:00Z"), HKI)).toBe("2026-11-21T17:20:00+02:00");
    expect(withOffset(new Date("2026-07-01T09:05:00Z"), HKI)).toBe("2026-07-01T12:05:00+03:00");
    expect(withOffset(new Date("2026-07-01T09:05:00Z"), "UTC")).toBe("2026-07-01T09:05:00+00:00");
  });
  it("labels a day", () => {
    expect(formatDayLabel("2026-10-29")).toBe("Thu 29.10.");
  });
});
