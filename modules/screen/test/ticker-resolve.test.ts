// Which line the ticker shows at an instant: a person's line, else a weekly window's, else none.
// The first cases are the legacy `ticker-store` tests, with the clock passed in and a read that
// never writes: an expired line is ignored, not deleted.
import { describe, expect, it } from "vitest";
import { resolveTicker } from "../src/ticker/resolve.js";
import type { ManualTicker, TickerWindowTimes } from "../src/ticker/resolve.js";

const at = (iso: string) => new Date(iso);
const manual = (text: string, until: string | null, source: "admin" | "bot" = "admin") =>
  ({ text, until: until === null ? null : at(until), source }) satisfies ManualTicker;
const window = (
  id: string,
  text: string,
  days: number[],
  startMinute: number,
  endMinute: number,
): TickerWindowTimes => ({ id, text, days, startMinute, endMinute });
const NONE = { text: null, until: null, source: null };

describe("resolveTicker", () => {
  it("shows a person's line until its end", () => {
    const line = manual("Hello hall", "2026-06-26T10:02:00Z");
    expect(resolveTicker(line, [], "UTC", at("2026-06-26T10:01:00Z"))).toEqual({
      text: "Hello hall",
      until: "2026-06-26T10:02:00.000Z",
      source: "admin",
    });
  });

  it("ignores a line whose end has passed", () => {
    const line = manual("Soon gone", "2026-06-26T10:00:01Z", "bot");
    expect(resolveTicker(line, [], "UTC", at("2026-06-26T10:00:01Z"))).toEqual(NONE);
    expect(resolveTicker(line, [], "UTC", at("2026-06-26T10:00:02Z"))).toEqual(NONE);
  });

  it("keeps a line without an end", () => {
    const line = manual("Winner!", null, "bot");
    expect(resolveTicker(line, [], "UTC", at("2030-01-01T00:00:00Z"))).toMatchObject({
      text: "Winner!",
      until: null,
      source: "bot",
    });
  });

  it("shows nothing with no line and no window", () => {
    expect(resolveTicker(null, [], "UTC", at("2026-06-26T10:00:00Z"))).toEqual(NONE);
  });

  // 2026-06-26 is a Friday (ISO 5).
  it("shows a window's text in its weekly times, until the occurrence ends", () => {
    const w = window("tw_1", "Doors close at 23", [5], 18 * 60, 23 * 60);
    expect(resolveTicker(null, [w], "UTC", at("2026-06-26T18:30:20Z"))).toEqual({
      text: "Doors close at 23",
      until: "2026-06-26T23:00:00.000Z",
      source: "window",
    });
    expect(resolveTicker(null, [w], "UTC", at("2026-06-26T23:00:00Z"))).toEqual(NONE);
    expect(resolveTicker(null, [w], "UTC", at("2026-06-27T18:30:00Z"))).toEqual(NONE);
  });

  it("reads the window in the event's time zone", () => {
    const w = window("tw_1", "Breakfast", [5], 8 * 60, 9 * 60);
    // 08:30 in Helsinki (UTC+3 in summer) is 05:30 UTC.
    expect(resolveTicker(null, [w], "Europe/Helsinki", at("2026-06-26T05:30:00Z"))).toMatchObject({
      text: "Breakfast",
      until: "2026-06-26T06:00:00.000Z",
    });
    expect(resolveTicker(null, [w], "UTC", at("2026-06-26T05:30:00Z"))).toEqual(NONE);
  });

  it("carries an overnight window into the next morning", () => {
    const w = window("tw_1", "Quiet hours", [5], 22 * 60, 6 * 60);
    expect(resolveTicker(null, [w], "UTC", at("2026-06-27T03:00:00Z"))).toMatchObject({
      text: "Quiet hours",
      until: "2026-06-27T06:00:00.000Z",
    });
  });

  it("ends a window at the real instant across a daylight-saving switch", () => {
    // Berlin goes from UTC+1 to UTC+2 at 02:00 local on Sunday 2026-03-29 (ISO 7).
    const w = window("tw_1", "Night", [6], 22 * 60, 6 * 60);
    expect(resolveTicker(null, [w], "Europe/Berlin", at("2026-03-28T23:00:00Z"))).toMatchObject({
      until: "2026-03-29T04:00:00.000Z",
    });
  });

  it("lets the window that started last win, and the same one every time", () => {
    const day = window("tw_b", "All day", [5], 0, 1440);
    const evening = window("tw_a", "Tonight", [5], 18 * 60, 20 * 60);
    const twin = window("tw_c", "Also tonight", [5], 18 * 60, 21 * 60);
    const now = at("2026-06-26T19:00:00Z");
    expect(resolveTicker(null, [day, evening], "UTC", now).text).toBe("Tonight");
    expect(resolveTicker(null, [twin, day, evening], "UTC", now).text).toBe("Tonight");
    expect(resolveTicker(null, [evening, twin, day], "UTC", now).text).toBe("Tonight");
  });

  it("lets a person's line win over a window", () => {
    const w = window("tw_1", "Window", [5], 0, 1440);
    const line = manual("Person", null);
    expect(resolveTicker(line, [w], "UTC", at("2026-06-26T12:00:00Z")).source).toBe("admin");
    const ended = manual("Person", "2026-06-26T11:00:00Z");
    expect(resolveTicker(ended, [w], "UTC", at("2026-06-26T12:00:00Z")).source).toBe("window");
  });
});
