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
import { dayStartMs, eventDays, pageOfDays, scheduleModel } from "../src/studio/schedule-model.js";
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

function nextDay(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function input(calendar: Calendar, nowIso = "2026-04-17T07:00:00.000Z"): ScheduleModelInput {
  return {
    calendar,
    days: DAYS,
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

  test("renders an overlap as one block with the scheduler's winner first and the loser greyed", () => {
    const friday = scheduleModel(input(calendarOf(schedules))).days[1];
    const blocks = friday?.lanes[0]?.blocks ?? [];
    expect(blocks.map((b) => [b.startMinute, b.endMinute, b.rows.length])).toEqual([
      [540, 600, 1],
      [600, 660, 2],
      [660, 1020, 1],
      [1020, 1320, 1],
    ]);
    expect(blocks[1]?.rows).toEqual([
      expect.objectContaining({ scheduleId: "fri-ads", winner: true, lostOn: null }),
      expect.objectContaining({
        scheduleId: "fri-main",
        playlistName: "Main rotation",
        winner: false,
        lostOn: "priority",
      }),
    ]);
  });

  test("orders a three-way overlap: winner first, then the losers by priority", () => {
    const triple = [
      weekly("wed-low", "ads", 4, 12 * 60, 14 * 60, 5),
      weekly("wed-mid", "main", 4, 12 * 60, 14 * 60, 10),
      weekly("wed-high", "evening", 4, 12 * 60, 14 * 60, 20),
    ];
    const thursday = scheduleModel(input(calendarOf(triple))).days[0];
    expect(thursday?.lanes[0]?.blocks[0]?.rows.map((r) => r.scheduleId)).toEqual([
      "wed-high",
      "wed-mid",
      "wed-low",
    ]);
  });

  test("merges adjacent pieces with the same winner and the same windows", () => {
    // Two runs of one window that meet at midnight, drawn in two columns, never merge across days;
    // within a day, a window that every day starts a new run stays one block per day.
    const allDay = [{ ...weekly("all", "main", 4, 0, 1440, 1), days: [4, 5] }];
    const model = scheduleModel(input(calendarOf(allDay)));
    expect(model.days[0]?.lanes[0]?.blocks).toHaveLength(1);
    expect(model.days[1]?.lanes[0]?.blocks).toEqual([
      expect.objectContaining({ startMinute: 0, endMinute: 1440 }),
    ]);
  });

  test("marks a block that goes on past midnight", () => {
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
          [
            "dinner",
            {
              id: "dinner",
              startsAt: new Date("2026-04-17T15:00:00Z"),
              endsAt: new Date("2026-04-17T16:00:00Z"),
              status: "scheduled" as const,
            },
          ],
          [
            "crew",
            {
              id: "crew",
              startsAt: new Date("2026-04-17T05:00:00Z"),
              endsAt: new Date("2026-04-17T06:00:00Z"),
              status: "scheduled" as const,
            },
          ],
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
    const rows = model.days[1]?.lanes[0]?.blocks.map((b) => b.rows[0]?.boundTo);
    expect(rows).toEqual([
      { title: null, crew: true },
      { title: "Dinner", crew: false },
    ]);
  });

  test("puts the now marker on today's column in the event's time zone, and a legend", () => {
    const model = scheduleModel(input(calendarOf(schedules), "2026-04-17T07:00:00.000Z"));
    expect(model.now).toEqual({ date: "2026-04-17", minute: 600 });
    expect(model.legend).toEqual([
      { playlistId: "evening", playlistName: "Evening sponsors" },
      { playlistId: "main", playlistName: "Main rotation" },
    ]);
    expect(scheduleModel(input(calendarOf(schedules), "2026-05-01T07:00:00.000Z")).now).toBeNull();
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
