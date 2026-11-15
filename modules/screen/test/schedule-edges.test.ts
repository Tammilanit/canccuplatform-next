// The schedule calendar's edges (#544): a day whose midnight daylight saving skips, a `from` that
// is not RFC 3339, the first shown day's small hours and the evening before it, a losing stretch
// that crosses a run's end, and a block that ends at midnight.
//   America/Havana 2026: 8 March 05:00 UTC, local midnight skipped (00:00 → 01:00).
import { html } from "@canccu/ui";
import { describe, expect, test } from "vitest";

import type { Calendar } from "../src/content/calendar.js";
import { calendarRange } from "../src/content/calendar.js";
import { zoneCalendar } from "../src/schedule/calendar.js";
import type { ScheduleWindow } from "../src/schedule/winner.js";
import {
  columnSpan,
  dayStartMs,
  FULL_DAY,
  localDate,
  pageReadRange,
  scheduleAxis,
  wallInstant,
} from "../src/studio/schedule-axis.js";
import type { Axis } from "../src/studio/schedule-axis.js";
import { scheduleModel } from "../src/studio/schedule-model.js";
import { scheduleView } from "../src/studio/schedule-view.js";
import { translator } from "../src/studio/messages.js";

const TZ = "Europe/Helsinki";
const HAVANA = "America/Havana";
const WED = 3;
const THU = 4;
const FRI = 5;
// Thursday to Saturday, 16–18 April 2026 in Helsinki (UTC+3).
const DAYS = ["2026-04-16", "2026-04-17", "2026-04-18"];

function weekly(id: string, days: number[], start: number, end: number, priority: number) {
  const w: ScheduleWindow = {
    id,
    zoneKey: "main",
    playlistId: id,
    priority,
    layoutId: null,
    days,
    startMinute: start,
    endMinute: end,
    agendaItemId: null,
  };
  return w;
}

function calendarOf(windows: ScheduleWindow[], ms: { from: number; to: number }): Calendar {
  const range = { from: new Date(ms.from), to: new Date(ms.to) };
  const zone = zoneCalendar(
    {
      zoneKey: "main",
      windows,
      timeZone: TZ,
      playlistPriorities: new Map(),
      breakPlaylists: [],
      crewItems: new Set(),
      revealCrew: true,
    },
    range.from,
    range.to,
  );
  const iso = (d: Date) => d.toISOString();
  return { from: iso(range.from), to: iso(range.to), time_zone: TZ, zones: [zone] };
}

function modelOf(calendar: Calendar, axis: Axis) {
  return scheduleModel({
    calendar,
    days: DAYS,
    axis,
    zoneNames: new Map([["main", "Main hall"]]),
    playlistNames: new Map(),
    labels: new Map(),
    nowMs: 0,
  });
}

describe("a day whose midnight is skipped", () => {
  test("starts at the date's first instant, not at the day before's 23:00", () => {
    const start = dayStartMs("2026-03-08", HAVANA);
    expect(new Date(start).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(localDate(start, HAVANA)).toBe("2026-03-08");
    // A wall time the switch skips is read on the far side of the gap, as the window rule does.
    expect(new Date(wallInstant("2026-03-08", 30, HAVANA)).toISOString()).toBe(
      "2026-03-08T05:30:00.000Z",
    );
    // Times that exist are unchanged, on the day and the day before.
    expect(new Date(wallInstant("2026-03-08", 120, HAVANA)).toISOString()).toBe(
      "2026-03-08T06:00:00.000Z",
    );
    expect(new Date(dayStartMs("2026-03-07", HAVANA)).toISOString()).toBe(
      "2026-03-07T05:00:00.000Z",
    );
  });

  test("its column starts there too", () => {
    expect(columnSpan("2026-03-08", FULL_DAY, HAVANA)).toEqual({
      starts_at: "2026-03-08T05:00:00.000Z",
      ends_at: "2026-03-09T04:00:00.000Z",
    });
  });
});

describe("calendarRange", () => {
  const to = "2026-04-18T00:00:00Z";
  test.each([
    ["a date alone", "2026-04-17"],
    ["a time without an offset", "2026-04-17T00:00:00"],
    ["an engine's own format", "Fri Apr 17 2026 00:00:00 GMT+0300"],
    ["a number", "1776373200000"],
  ])("refuses %s as `from` with 400", (_, from) => {
    expect(() => calendarRange(from, to)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => calendarRange(to.replace("18", "16"), from)).toThrow();
  });

  test("takes RFC 3339 times with Z or an offset and fractions", () => {
    expect(calendarRange("2026-04-17T00:00:00.5+03:00", to).from.toISOString()).toBe(
      "2026-04-16T21:00:00.500Z",
    );
  });
});

describe("the first shown day", () => {
  // Every day 08:00–22:00 is used and a window runs Thursday into Friday 22:00–02:00, so the
  // longest empty stretch is the small hours and the axis runs past midnight.
  const base = [
    weekly("day", [THU, FRI], 9 * 60, 21 * 60, 10),
    weekly("late", [THU], 22 * 60, 120, 5),
  ];
  const range = pageReadRange(DAYS, TZ);

  test("the page reads from the day before and a day past the last", () => {
    expect(new Date(range.from).toISOString()).toBe("2026-04-14T21:00:00.000Z");
    expect(new Date(range.to).toISOString()).toBe("2026-04-19T21:00:00.000Z");
  });

  test("a run starting in its small hours keeps them on the axis", () => {
    expect(scheduleAxis(calendarOf(base, range).zones, DAYS, TZ)).toEqual({
      startMinute: 480,
      endMinute: 1560,
    });
    const early = [...base, weekly("early", [THU], 30, 90, 1)];
    const calendar = calendarOf(early, range);
    const axis = scheduleAxis(calendar.zones, DAYS, TZ);
    expect(axis).toEqual(FULL_DAY);
    const blocks = modelOf(calendar, axis).days[0]?.lanes[0]?.blocks ?? [];
    expect(blocks.map((b) => [b.scheduleId, b.startMinute, b.endMinute])).toContainEqual([
      "early",
      30,
      90,
    ]);
  });

  test("a run that began the evening before shows as going on from it", () => {
    const calendar = calendarOf([weekly("eve", [WED], 22 * 60, 120, 5)], range);
    const block = modelOf(calendar, FULL_DAY).days[0]?.lanes[0]?.blocks[0];
    expect(block).toMatchObject({
      scheduleId: "eve",
      startMinute: 0,
      endMinute: 120,
      continuesBefore: true,
    });
  });
});

describe("a losing stretch", () => {
  test("stays inside each block where it crosses the run's end at midnight", () => {
    // An all-day window loses to a 22:00–02:00 one on both sides of midnight; on an axis that
    // runs past midnight the two runs are two blocks in one column.
    const windows = [
      weekly("all", [THU, FRI], 0, 1440, 1),
      weekly("night", [THU], 22 * 60, 120, 9),
    ];
    const axis = { startMinute: 480, endMinute: 1560 };
    const calendar = calendarOf(windows, pageReadRange(DAYS, TZ));
    const blocks = (modelOf(calendar, axis).days[0]?.lanes[0]?.blocks ?? []).filter(
      (b) => b.scheduleId === "all",
    );
    expect(
      blocks.map((b) => [
        b.startMinute,
        b.endMinute,
        b.losing.map((l) => [l.startMinute, l.endMinute, l.startsAt, l.endsAt]),
      ]),
    ).toEqual([
      [480, 1440, [[1320, 1440, "2026-04-16T19:00:00.000Z", "2026-04-16T21:00:00.000Z"]]],
      [1440, 1560, [[1440, 1560, "2026-04-16T21:00:00.000Z", "2026-04-16T23:00:00.000Z"]]],
    ]);
  });
});

describe("a block that ends at midnight", () => {
  test("reads 24:00 on the block as in its popover", () => {
    const calendar = calendarOf(
      [weekly("morning", [FRI], 7 * 60, 1440, 5)],
      pageReadRange(DAYS, TZ),
    );
    const model = modelOf(calendar, FULL_DAY);
    const c = {
      t: translator("en"),
      rights: new Set<string>(),
      nowMs: 0,
      timeZone: TZ,
      startUrl: null,
    };
    const { body } = scheduleView(c, {
      model,
      calendar,
      zones: [{ key: "main", name: "Main hall" }] as never,
      zone: "main",
      page: { days: DAYS, prev: null, next: null },
      day: DAYS[1] as string,
      playlists: new Map([["morning", { name: "Morning", break: null }]]),
      at: html``,
      editor: null,
    });
    const text = String(body);
    expect(text).toContain("07:00–24:00");
    expect(text).not.toContain("07:00–00:00");
  });
});
