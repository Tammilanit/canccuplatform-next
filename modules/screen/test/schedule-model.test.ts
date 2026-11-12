// The schedule page's view-models: the week calendar's days and blocks, the insights and the break
// overlaps. Ported from the legacy signage `week-calendar-model.test.ts` and
// `schedule-insights.test.ts` (the same Friday in Helsinki and the same windows), now fed by the
// calendar answer, so every winner they show is the scheduler's.
import { describe, expect, test } from "vitest";

import type { Calendar } from "../src/content/calendar.js";
import { zoneCalendar } from "../src/schedule/calendar.js";
import type { CalendarBreak, ZoneCalendar } from "../src/schedule/calendar.js";
import type { ScheduleWindow, WeeklyWindow } from "../src/schedule/winner.js";
import { breakOverlaps } from "../src/studio/break-overlap.js";
import { clipCalendar, dayStartMs, FULL_DAY, scheduleAxis } from "../src/studio/schedule-axis.js";
import { eventDays, pageOfDays, scheduleModel } from "../src/studio/schedule-model.js";
import type { ScheduleModelInput } from "../src/studio/schedule-model.js";
import { zoneInsight } from "../src/studio/schedule-insights.js";

const TZ = "Europe/Helsinki";
const FRI = 5;

function weekly(
  id: string,
  playlistId: string,
  day: number,
  start: number,
  end: number,
  priority: number,
): WeeklyWindow {
  return {
    id,
    zoneKey: "main",
    playlistId,
    priority,
    layoutId: null,
    days: [day],
    startMinute: start,
    endMinute: end,
    agendaItemId: null,
  };
}

// The legacy fixtures: Friday 2026-04-17 in Helsinki (UTC+3).
const schedules: ScheduleWindow[] = [
  weekly("fri-main", "main", FRI, 9 * 60, 17 * 60, 10),
  weekly("fri-evening", "evening", FRI, 17 * 60, 22 * 60, 5),
  weekly("fri-ads", "evening", FRI, 10 * 60, 11 * 60, 50),
];
const DAYS = ["2026-04-16", "2026-04-17", "2026-04-18"];

function calendarOf(windows: ScheduleWindow[], days = DAYS, extra = {}): Calendar {
  const from = new Date(dayStartMs(days[0] as string, TZ));
  const to = new Date(dayStartMs(nextDay(days.at(-1) as string), TZ));
  const zone = zoneCalendar(
    {
      zoneKey: "main",
      windows,
      timeZone: TZ,
      playlistPriorities: new Map([
        ["main", 10],
        ["evening", 5],
      ]),
      breakPlaylists: [],
      crewItems: new Set(),
      revealCrew: true,
      ...extra,
    },
    from,
    to,
  );
  return { from: from.toISOString(), to: to.toISOString(), time_zone: TZ, zones: [zone] };
}

function item(id: string, startsAt: string, endsAt: string) {
  const status = "scheduled" as const;
  return { id, startsAt: new Date(startsAt), endsAt: new Date(endsAt), status };
}

function nextDay(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function input(calendar: Calendar, nowIso = "2026-04-17T07:00:00.000Z"): ScheduleModelInput {
  return {
    calendar,
    days: DAYS,
    axis: FULL_DAY,
    zoneNames: new Map([["main", "Main hall"]]),
    playlistNames: new Map([
      ["main", "Main rotation"],
      ["evening", "Evening sponsors"],
    ]),
    labels: new Map(),
    nowMs: Date.parse(nowIso),
  };
}

describe("eventDays and pageOfDays", () => {
  test("the event's local dates, its last day included only when it reaches into it", () => {
    expect(eventDays("2026-03-13T08:00:00Z", "2026-03-15T22:00:00Z", "UTC", 0)).toEqual([
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
    ]);
    expect(eventDays("2026-03-13T08:00:00Z", "2026-03-15T00:00:00Z", "UTC", 0)).toEqual([
      "2026-03-13",
      "2026-03-14",
    ]);
    // 23:30Z on the 12th is already the 13th in Helsinki.
    expect(eventDays("2026-03-12T23:30:00Z", "2026-03-13T20:00:00Z", TZ, 0)).toEqual([
      "2026-03-13",
    ]);
  });

  test("a week from today when the event has no dates", () => {
    const days = eventDays(undefined, undefined, TZ, Date.parse("2026-04-17T22:30:00Z"));
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-04-18");
  });

  test("pages seven days at a time, starting at the day asked for", () => {
    const days = eventDays("2026-03-01T00:00:00Z", "2026-03-11T00:00:00Z", "UTC", 0);
    expect(pageOfDays(days, undefined)).toEqual({
      days: days.slice(0, 7),
      prev: null,
      next: "2026-03-08",
    });
    expect(pageOfDays(days, "2026-03-08")).toEqual({
      days: days.slice(7),
      prev: "2026-03-01",
      next: null,
    });
    expect(pageOfDays(days, "1999-01-01").days[0]).toBe("2026-03-01");
  });

  test("a day's start is local midnight, also on a daylight-saving day", () => {
    expect(new Date(dayStartMs("2026-04-17", TZ)).toISOString()).toBe("2026-04-16T21:00:00.000Z");
    expect(new Date(dayStartMs("2026-03-29", TZ)).toISOString()).toBe("2026-03-28T22:00:00.000Z");
  });
});

describe("scheduleModel", () => {
  test("one column per event day and one lane per zone; an empty day has no blocks", () => {
    const model = scheduleModel(input(calendarOf(schedules)));
    expect(model.days.map((d) => d.date)).toEqual(DAYS);
    expect(model.days[0]?.lanes).toEqual([
      { zoneKey: "main", zoneName: "Main hall", blocks: [], breaks: [] },
    ]);
  });

  test("draws one block per window, side by side where they overlap, and where each loses", () => {
    const friday = scheduleModel(input(calendarOf(schedules))).days[1];
    const blocks = friday?.lanes[0]?.blocks ?? [];
    expect(
      blocks.map((b) => [b.scheduleId, b.startMinute, b.endMinute, b.column, b.columns]),
    ).toEqual([
      ["fri-main", 540, 1020, 0, 2],
      ["fri-ads", 600, 660, 1, 2],
      ["fri-evening", 1020, 1320, 0, 1],
    ]);
    // The scheduler's winner: fri-ads (priority 50) beats fri-main from 10:00 to 11:00.
    expect(blocks[0]).toMatchObject({ playlistName: "Main rotation", priority: 10 });
    expect(blocks[0]?.losing).toEqual([
      expect.objectContaining({
        startMinute: 600,
        endMinute: 660,
        to: "Evening sponsors",
        lostOn: "priority",
      }),
    ]);
    expect(blocks[1]?.losing).toEqual([]);
  });

  test("splits a three-way overlap in three, and both losers lose to the winner", () => {
    const triple = [
      weekly("wed-low", "ads", 4, 12 * 60, 14 * 60, 5),
      weekly("wed-mid", "main", 4, 12 * 60, 14 * 60, 10),
      weekly("wed-high", "evening", 4, 12 * 60, 14 * 60, 20),
    ];
    const blocks = scheduleModel(input(calendarOf(triple))).days[0]?.lanes[0]?.blocks ?? [];
    expect(blocks.map((b) => [b.scheduleId, b.column, b.columns])).toEqual([
      ["wed-low", 0, 3],
      ["wed-mid", 1, 3],
      ["wed-high", 2, 3],
    ]);
    expect(blocks.map((b) => b.losing.map((l) => l.to))).toEqual([
      ["Evening sponsors"],
      ["Evening sponsors"],
      [],
    ]);
  });

  test("on a whole-day axis, cuts a run at midnight and marks both pieces", () => {
    const night = [weekly("late", "main", 4, 22 * 60, 2 * 60, 1)];
    const model = scheduleModel(input(calendarOf(night)));
    expect(model.days[0]?.lanes[0]?.blocks[0]).toMatchObject({
      startMinute: 1320,
      endMinute: 1440,
      continuesAfter: true,
    });
    expect(model.days[1]?.lanes[0]?.blocks[0]).toMatchObject({
      startMinute: 0,
      endMinute: 120,
      continuesBefore: true,
    });
  });

  test("on an axis past midnight, keeps an evening run that ends at 02:00 one block", () => {
    const night = [weekly("late", "main", 4, 22 * 60, 2 * 60, 1)];
    const axis = { startMinute: 1200, endMinute: 1560 };
    const model = scheduleModel({ ...input(calendarOf(night)), axis });
    expect(model.days[0]?.lanes[0]?.blocks).toEqual([
      expect.objectContaining({
        startMinute: 1320,
        endMinute: 1560,
        continuesBefore: false,
        continuesAfter: false,
      }),
    ]);
    expect(model.days[1]?.lanes[0]?.blocks).toEqual([]);
  });

  test("names a bound window's item, or says it is a crew item when its id is withheld", () => {
    const calendar = calendarOf(
      [
        {
          id: "menu",
          zoneKey: "main",
          playlistId: "main",
          priority: 50,
          layoutId: null,
          agendaItemId: "dinner",
        },
        {
          id: "brief",
          zoneKey: "main",
          playlistId: "main",
          priority: 50,
          layoutId: null,
          agendaItemId: "crew",
        },
      ],
      DAYS,
      {
        agendaItems: new Map([
          ["dinner", item("dinner", "2026-04-17T15:00:00Z", "2026-04-17T16:00:00Z")],
          ["crew", item("crew", "2026-04-17T05:00:00Z", "2026-04-17T06:00:00Z")],
        ]),
        crewItems: new Set(["crew"]),
        revealCrew: false,
      },
    );
    const model = scheduleModel({
      ...input(calendar),
      labels: new Map([
        ["dinner", { title: "Dinner", crew: false }],
        ["crew", { title: "Crew briefing", crew: true }],
      ]),
    });
    const bound = model.days[1]?.lanes[0]?.blocks.map((b) => b.boundTo);
    expect(bound).toEqual([
      { title: null, crew: true },
      { title: "Dinner", crew: false },
    ]);
  });

  test("puts the now marker on today's column in the event's time zone", () => {
    const model = scheduleModel(input(calendarOf(schedules), "2026-04-17T07:00:00.000Z"));
    expect(model.now).toEqual({ date: "2026-04-17", minute: 600 });
    expect(scheduleModel(input(calendarOf(schedules), "2026-05-01T07:00:00.000Z")).now).toBeNull();
  });
});

describe("scheduleAxis and clipCalendar", () => {
  const axisOf = (windows: ScheduleWindow[]) => scheduleAxis(calendarOf(windows).zones, DAYS, TZ);

  test("starts an hour before the first window after the empty night and ends at the last", () => {
    expect(axisOf(schedules)).toEqual({ startMinute: 480, endMinute: 1320 });
  });

  test("runs past midnight when the longest empty stretch is the small hours", () => {
    const windows = [...schedules, weekly("late", "main", 4, 22 * 60, 2 * 60, 1)];
    expect(axisOf(windows)).toEqual({ startMinute: 480, endMinute: 1560 });
  });

  test("counts the breaks as well as the windows", () => {
    const zone = calendarOf(schedules).zones[0] as ZoneCalendar;
    const late: CalendarBreak = {
      playlist_id: "partners",
      period_seconds: 3600,
      break_seconds: 45,
      spans: [{ starts_at: "2026-04-17T19:00:00.000Z", ends_at: "2026-04-17T19:30:00.000Z" }],
    };
    // 19:00Z is 22:00 in Helsinki: the axis ends at the hour after the break's 22:30.
    expect(scheduleAxis([{ ...zone, breaks: [late] }], DAYS, TZ)).toEqual({
      startMinute: 480,
      endMinute: 1380,
    });
  });

  test("keeps the whole day when nothing is scheduled, or nothing is empty for two hours", () => {
    expect(axisOf([])).toEqual(FULL_DAY);
    expect(axisOf([weekly("long", "main", FRI, 30, 23 * 60, 1)])).toEqual(FULL_DAY);
    expect(axisOf([weekly("all", "main", FRI, 0, 1440, 1)])).toEqual(FULL_DAY);
  });

  test("cuts the segments to the columns and keeps each run whole", () => {
    const calendar = calendarOf(schedules);
    const range = { starts_at: "2026-04-17T08:00:00.000Z", ends_at: "2026-04-17T12:00:00.000Z" };
    const clipped = clipCalendar(calendar, range);
    expect(clipped.from).toBe(range.starts_at);
    const zone = clipped.zones[0];
    expect(zone?.segments.map((s) => [s.starts_at, s.ends_at])).toEqual([
      ["2026-04-17T08:00:00.000Z", "2026-04-17T12:00:00.000Z"],
    ]);
    expect(zone?.windows.find((w) => w.schedule_id === "fri-main")?.runs).toEqual([
      { starts_at: "2026-04-17T06:00:00.000Z", ends_at: "2026-04-17T14:00:00.000Z" },
    ]);
    expect(zone?.windows.find((w) => w.schedule_id === "fri-ads")?.runs).toEqual([]);
  });
});

describe("zoneInsight", () => {
  const cal = calendarOf(schedules);
  const zone = () => cal.zones[0] as ZoneCalendar;
  const range = { starts_at: cal.from, ends_at: cal.to };

  test("reports what plays now and how many windows overlap", () => {
    const insight = zoneInsight(zone(), Date.parse("2026-04-17T07:30:00.000Z"), range);
    expect(insight.now).toEqual({
      winner: "fri-ads",
      overlapping: 2,
      until: "2026-04-17T08:00:00.000Z",
    });
  });

  test("finds the next change of winner, to the evening window", () => {
    const insight = zoneInsight(zone(), Date.parse("2026-04-17T12:00:00.000Z"), range);
    expect(insight.now?.winner).toBe("fri-main");
    expect(insight.next).toEqual({ at: "2026-04-17T14:00:00.000Z", winner: "fri-evening" });
  });

  test("lists each conflict once, with the rule the loser lost on, and the gaps", () => {
    const insight = zoneInsight(zone(), Date.parse("2026-04-17T00:00:00.000Z"), range);
    expect(insight.conflicts).toEqual([
      {
        starts_at: "2026-04-17T07:00:00.000Z",
        ends_at: "2026-04-17T08:00:00.000Z",
        winner: "fri-ads",
        loser: "fri-main",
        lost_on: "priority",
      },
    ]);
    expect(insight.gaps).toEqual([
      { starts_at: "2026-04-15T21:00:00.000Z", ends_at: "2026-04-17T06:00:00.000Z" },
      { starts_at: "2026-04-17T19:00:00.000Z", ends_at: "2026-04-18T21:00:00.000Z" },
    ]);
  });

  test("now is null, and next the first segment, before anything runs", () => {
    const insight = zoneInsight(zone(), Date.parse("2026-04-16T00:00:00.000Z"), range);
    expect(insight.now).toBeNull();
    expect(insight.next).toEqual({ at: "2026-04-17T06:00:00.000Z", winner: "fri-main" });
  });
});

describe("breakOverlaps", () => {
  const brk = (id: string, spans: [string, string][]): CalendarBreak => ({
    playlist_id: id,
    period_seconds: 3600,
    break_seconds: 45,
    spans: spans.map(([s, e]) => ({ starts_at: s, ends_at: e })),
  });

  test("names each pair whose daily windows share time, at their first shared span", () => {
    const overlaps = breakOverlaps([
      brk("partners", [["2026-04-17T09:00:00.000Z", "2026-04-17T19:00:00.000Z"]]),
      brk("sponsors", [["2026-04-17T18:00:00.000Z", "2026-04-17T21:00:00.000Z"]]),
      brk("night", [["2026-04-17T21:00:00.000Z", "2026-04-17T23:00:00.000Z"]]),
    ]);
    expect(overlaps).toEqual([
      {
        a: "partners",
        b: "sponsors",
        starts_at: "2026-04-17T18:00:00.000Z",
        ends_at: "2026-04-17T19:00:00.000Z",
      },
    ]);
  });

  test("none with one break playlist or none at all", () => {
    expect(breakOverlaps([])).toEqual([]);
    expect(
      breakOverlaps([brk("only", [["2026-04-17T09:00:00.000Z", "2026-04-17T19:00:00.000Z"]])]),
    ).toEqual([]);
  });
});
