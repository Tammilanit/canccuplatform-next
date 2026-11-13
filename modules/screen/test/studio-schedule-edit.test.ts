// The window editor's arithmetic (#267, plan #190 S4), which static/studio-schedule.js runs in the
// browser: a drag on the 15-minute grid becomes a weekly window's times, a moved or resized window
// keeps the contract's rules (an end of 24:00 is 1440, overnight when the end is not after the
// start), and the form becomes a `Schedule` body.
import { describe, expect, it } from "vitest";
import {
  clock,
  createdTimes,
  isoDay,
  minutesOf,
  movedTimes,
  resizedTimes,
  windowBody,
} from "../static/studio-schedule-edit.js";

describe("the window editor's times", () => {
  it("reads and writes wall-clock times, 24:00 as the end of the day", () => {
    expect(minutesOf("09:30")).toBe(570);
    expect(minutesOf("24:00")).toBe(1440);
    expect(minutesOf("9:30")).toBeNull();
    expect(minutesOf("25:00")).toBeNull();
    expect(minutesOf("")).toBeNull();
    expect(clock(570)).toBe("09:30");
    expect(clock(1440)).toBe("24:00");
    expect(clock(0)).toBe("00:00");
  });

  it("knows a date's ISO weekday", () => {
    expect(isoDay("2026-01-01")).toBe(4);
    expect(isoDay("2026-01-04")).toBe(7);
    expect(isoDay("2026-01-05")).toBe(1);
  });

  it("turns a drag on a column into a window on its day, snapped, in either direction", () => {
    expect(createdTimes("2026-01-01", 545, 610)).toEqual({
      date: "2026-01-01",
      start_minute: 540,
      end_minute: 615,
    });
    expect(createdTimes("2026-01-01", 610, 545)).toEqual({
      date: "2026-01-01",
      start_minute: 540,
      end_minute: 615,
    });
    // A tap is a quarter at least.
    expect(createdTimes("2026-01-01", 600, 600)).toMatchObject({
      start_minute: 600,
      end_minute: 615,
    });
    // Past midnight on an axis that runs on into the small hours: the next day's minutes.
    expect(createdTimes("2026-01-01", 1500, 1560)).toEqual({
      date: "2026-01-02",
      start_minute: 60,
      end_minute: 120,
    });
    // From the evening across midnight: overnight, on the day it starts.
    expect(createdTimes("2026-01-01", 1380, 1500)).toEqual({
      date: "2026-01-01",
      start_minute: 1380,
      end_minute: 60,
    });
    // Up to midnight exactly: 24:00, not 00:00.
    expect(createdTimes("2026-01-01", 1380, 1440)).toMatchObject({ end_minute: 1440 });
  });

  it("moves a window by whole quarters, across midnight too, keeping its length", () => {
    expect(movedTimes({ start_minute: 540, end_minute: 1020 }, 62)).toEqual({
      start_minute: 600,
      end_minute: 1080,
    });
    expect(movedTimes({ start_minute: 1320, end_minute: 1380 }, 60)).toEqual({
      start_minute: 1380,
      end_minute: 1440,
    });
    expect(movedTimes({ start_minute: 1380, end_minute: 1440 }, 60)).toEqual({
      start_minute: 0,
      end_minute: 60,
    });
    expect(movedTimes({ start_minute: 1380, end_minute: 60 }, -60)).toEqual({
      start_minute: 1320,
      end_minute: 1440,
    });
    expect(movedTimes({ start_minute: 30, end_minute: 90 }, -60)).toEqual({
      start_minute: 1410,
      end_minute: 30,
    });
    // A whole day has nowhere to move.
    expect(movedTimes({ start_minute: 0, end_minute: 1440 }, 60)).toBeNull();
    expect(movedTimes({ start_minute: 540, end_minute: 1020 }, 5)).toBeNull();
  });

  it("resizes a window's end, a quarter at least and less than a day", () => {
    expect(resizedTimes({ start_minute: 540, end_minute: 1020 }, 120)).toEqual({
      start_minute: 540,
      end_minute: 1140,
    });
    expect(resizedTimes({ start_minute: 1320, end_minute: 1380 }, 120)).toEqual({
      start_minute: 1320,
      end_minute: 60,
    });
    expect(resizedTimes({ start_minute: 1320, end_minute: 1380 }, 60)).toEqual({
      start_minute: 1320,
      end_minute: 1440,
    });
    expect(resizedTimes({ start_minute: 540, end_minute: 600 }, -120)).toEqual({
      start_minute: 540,
      end_minute: 555,
    });
    // A window that would end where it starts would be refused: it stops a quarter short.
    expect(resizedTimes({ start_minute: 540, end_minute: 600 }, 1440)).toEqual({
      start_minute: 540,
      end_minute: 525,
    });
    expect(resizedTimes({ start_minute: 0, end_minute: 600 }, 1440)).toEqual({
      start_minute: 0,
      end_minute: 1440,
    });
    expect(resizedTimes({ start_minute: 540, end_minute: 600 }, 7)).toBeNull();
  });
});

describe("the window form as a Schedule", () => {
  const base = {
    zone_key: "main",
    playlist_id: "pl_1",
    priority: "10",
    layout_id: "",
    kind: "weekly",
    days: ["4", "5"],
    start: "09:00",
    end: "17:00",
    agenda_item_id: "",
  };

  it("sends a weekly window with its days and minutes, and no layout as null", () => {
    expect(windowBody(base)).toEqual({
      ok: true,
      body: {
        zone_key: "main",
        playlist_id: "pl_1",
        priority: 10,
        layout_id: null,
        days: [4, 5],
        start_minute: 540,
        end_minute: 1020,
      },
    });
    expect(windowBody({ ...base, layout_id: "hero", end: "24:00" })).toMatchObject({
      body: { layout_id: "hero", end_minute: 1440 },
    });
  });

  it("sends a bound window without weekly fields", () => {
    expect(windowBody({ ...base, kind: "bound", agenda_item_id: "it_8" })).toEqual({
      ok: true,
      body: {
        zone_key: "main",
        playlist_id: "pl_1",
        priority: 10,
        layout_id: null,
        agenda_item_id: "it_8",
      },
    });
  });

  it("names what is missing as a message key, before the server is asked", () => {
    expect(windowBody({ ...base, days: [] })).toEqual({ ok: false, error: "window.need_days" });
    expect(windowBody({ ...base, start: "" })).toEqual({ ok: false, error: "window.need_times" });
    expect(windowBody({ ...base, end: "09:00" })).toEqual({
      ok: false,
      error: "window.same_times",
    });
    expect(windowBody({ ...base, start: "24:00" })).toEqual({
      ok: false,
      error: "window.need_times",
    });
    expect(windowBody({ ...base, kind: "bound" })).toEqual({
      ok: false,
      error: "window.need_item",
    });
    expect(windowBody({ ...base, playlist_id: "" })).toEqual({
      ok: false,
      error: "window.need_playlist",
    });
    expect(windowBody({ ...base, priority: "x" })).toEqual({
      ok: false,
      error: "window.need_priority",
    });
  });
});
