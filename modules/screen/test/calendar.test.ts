// The schedule calendar (`GET /api/screen/schedules/calendar`, contracts/screen.md, Schedule
// windows): runs, segments with their winner and the rule each loser lost on, and break spans,
// worked out with the scheduler the tick uses. The cases follow the legacy signage
// `week-calendar-model.test.ts` (merged hours, overlaps, three-way ordering, an empty day), moved
// from minutes of a week to real instants, plus bound windows and both daylight-saving switches.
import { describe, expect, test } from "vitest";

import type { BreakPlaylist } from "../src/playback/break-play.js";
import { zoneCalendar } from "../src/schedule/calendar.js";
import type { CalendarInput } from "../src/schedule/calendar.js";
import type { AgendaTimes, ScheduleWindow, WeeklyWindow } from "../src/schedule/winner.js";

const MON = 1;
const TUE = 2;

function weekly(
  id: string,
  startMinute: number,
  endMinute: number,
  priority: number,
  extra: Partial<WeeklyWindow> = {},
): WeeklyWindow {
  return {
    id,
    zoneKey: "main",
    playlistId: `pl_${id}`,
    priority,
    layoutId: null,
    days: [MON],
    startMinute,
    endMinute,
    agendaItemId: null,
    ...extra,
  };
}

function bound(id: string, agendaItemId: string, priority: number): ScheduleWindow {
  return {
    id,
    zoneKey: "main",
    playlistId: `pl_${id}`,
    priority,
    layoutId: null,
    agendaItemId,
  };
}

function item(id: string, startsAt: string, endsAt: string | null, cancelled = false): AgendaTimes {
  return {
    id,
    startsAt: new Date(startsAt),
    endsAt: endsAt === null ? null : new Date(endsAt),
    status: cancelled ? "cancelled" : "scheduled",
  };
}

function breakPlaylist(
  id: string,
  window: [number, number] | null,
  zones: string[] = [],
): BreakPlaylist {
  return {
    id,
    type: "break",
    name: id,
    priority: 0,
    slideshowImageSeconds: null,
    items: [],
    break: {
      zones,
      periodSeconds: 3600,
      breakSeconds: 45,
      windowStartMinute: window?.[0] ?? null,
      windowEndMinute: window?.[1] ?? null,
      playOnce: false,
      region: "playlist",
      mode: "timeline",
      slideshowDwellSeconds: null,
      shuffle: false,
    },
  };
}

function input(windows: ScheduleWindow[], extra: Partial<CalendarInput> = {}): CalendarInput {
  return {
    zoneKey: "main",
    windows,
    timeZone: "UTC",
    breakPlaylists: [],
    crewItems: new Set(),
    revealCrew: true,
    ...extra,
  };
}

// 2026-04-06 is a Monday.
const day = (d: number, hhmm: string) => `2026-04-0${d}T${hhmm}:00.000Z`;
const range = (fromIso: string, toIso: string) => [new Date(fromIso), new Date(toIso)] as const;

describe("zoneCalendar", () => {
  test("a lone window has one run and one segment with no losers", () => {
    const [from, to] = range(day(6, "00:00"), day(8, "00:00"));
    const cal = zoneCalendar(input([weekly("a", 540, 1020, 10)]), from, to);
    expect(cal.windows).toEqual([
      {
        schedule_id: "a",
        playlist_id: "pl_a",
        priority: 10,
        layout_id: null,
        agenda_item_id: null,
        agenda_item_crew: false,
        runs: [{ starts_at: day(6, "09:00"), ends_at: day(6, "17:00") }],
      },
    ]);
    expect(cal.segments).toEqual([
      { starts_at: day(6, "09:00"), ends_at: day(6, "17:00"), winner: "a", losers: [] },
    ]);
  });

  test("an overlap is its own segment, with the loser and the rule it lost on", () => {
    const [from, to] = range(day(6, "00:00"), day(7, "00:00"));
    const cal = zoneCalendar(
      input([weekly("a", 540, 1020, 10), weekly("b", 720, 840, 50)]),
      from,
      to,
    );
    expect(cal.segments).toEqual([
      { starts_at: day(6, "09:00"), ends_at: day(6, "12:00"), winner: "a", losers: [] },
      {
        starts_at: day(6, "12:00"),
        ends_at: day(6, "14:00"),
        winner: "b",
        losers: [{ schedule_id: "a", lost_on: "priority" }],
      },
      { starts_at: day(6, "14:00"), ends_at: day(6, "17:00"), winner: "a", losers: [] },
    ]);
  });

  test("names each tie-break: the later start, the playlist's priority, then the id", () => {
    const [from, to] = range(day(6, "00:00"), day(7, "00:00"));
    const windows = [
      weekly("early", 540, 1020, 10),
      weekly("late", 600, 1020, 10),
      weekly("same", 600, 1020, 10, { playlistId: "pl_low" }),
      weekly("zz", 600, 1020, 10, { playlistId: "pl_late" }),
    ];
    const cal = zoneCalendar(
      input(windows, { playlistPriorities: new Map([["pl_late", 5]]) }),
      from,
      to,
    );
    const overlap = cal.segments.find((s) => s.starts_at === day(6, "10:00"));
    expect(overlap?.winner).toBe("late");
    expect(overlap?.losers).toEqual(
      expect.arrayContaining([
        { schedule_id: "early", lost_on: "start" },
        { schedule_id: "same", lost_on: "playlist_priority" },
        { schedule_id: "zz", lost_on: "id" },
      ]),
    );
    expect(overlap?.losers).toHaveLength(3);
  });

  test("a window that runs every day starts a new run at midnight, so the segments cut there", () => {
    const [from, to] = range(day(6, "00:00"), day(8, "00:00"));
    const cal = zoneCalendar(input([weekly("all", 0, 1440, 1, { days: [MON, TUE] })]), from, to);
    expect(cal.windows[0]?.runs).toEqual([
      { starts_at: day(6, "00:00"), ends_at: day(7, "00:00") },
      { starts_at: day(7, "00:00"), ends_at: day(8, "00:00") },
    ]);
    expect(cal.segments.map((s) => s.starts_at)).toEqual([day(6, "00:00"), day(7, "00:00")]);
  });

  test("clips runs to the range: an overnight window from the night before starts at `from`", () => {
    const [from, to] = range(day(7, "00:00"), day(8, "00:00"));
    const cal = zoneCalendar(input([weekly("night", 1320, 360, 1)]), from, to);
    expect(cal.windows[0]?.runs).toEqual([
      { starts_at: day(7, "00:00"), ends_at: day(7, "06:00") },
    ]);
  });

  test("a bound window runs at its item's current times; cancelled and endless items run never", () => {
    const [from, to] = range(day(6, "00:00"), day(7, "00:00"));
    const agendaItems = new Map([
      ["dinner", item("dinner", day(6, "18:15"), day(6, "19:15"))],
      ["off", item("off", day(6, "10:00"), day(6, "11:00"), true)],
      ["doors", item("doors", day(6, "08:00"), null)],
    ]);
    const cal = zoneCalendar(
      input(
        [
          weekly("loop", 1020, 1320, 10),
          bound("menu", "dinner", 50),
          bound("x", "off", 90),
          bound("y", "doors", 90),
        ],
        { agendaItems },
      ),
      from,
      to,
    );
    expect(cal.windows.map((w) => w.schedule_id)).toEqual(["loop", "menu"]);
    const menu = cal.windows.find((w) => w.schedule_id === "menu");
    expect(menu?.agenda_item_id).toBe("dinner");
    expect(menu?.runs).toEqual([{ starts_at: day(6, "18:15"), ends_at: day(6, "19:15") }]);
    const over = cal.segments.find((s) => s.starts_at === day(6, "18:15"));
    expect(over).toEqual({
      starts_at: day(6, "18:15"),
      ends_at: day(6, "19:15"),
      winner: "menu",
      losers: [{ schedule_id: "loop", lost_on: "priority" }],
    });
  });

  test("hides a crew-only item's id unless the caller may read crew items", () => {
    const [from, to] = range(day(6, "00:00"), day(7, "00:00"));
    const agendaItems = new Map([["brief", item("brief", day(6, "08:00"), day(6, "09:00"))]]);
    const base = { agendaItems, crewItems: new Set(["brief"]) };
    const hidden = zoneCalendar(
      input([bound("b", "brief", 5)], { ...base, revealCrew: false }),
      from,
      to,
    );
    expect(hidden.windows[0]).toMatchObject({ agenda_item_id: null, agenda_item_crew: true });
    expect(hidden.windows[0]?.runs).toHaveLength(1);
    const shown = zoneCalendar(input([bound("b", "brief", 5)], base), from, to);
    expect(shown.windows[0]).toMatchObject({ agenda_item_id: "brief", agenda_item_crew: true });
  });

  test("leaves out other zones' windows and an empty range gives nothing", () => {
    const [from, to] = range(day(7, "00:00"), day(8, "00:00"));
    const cal = zoneCalendar(
      input([
        weekly("a", 540, 1020, 10),
        weekly("cafe", 0, 1440, 1, { zoneKey: "cafe", days: [TUE] }),
      ]),
      from,
      to,
    );
    expect(cal).toEqual({ zone_key: "main", windows: [], segments: [], breaks: [] });
  });

  test("spring forward: a run through the skipped hour lasts two real hours", () => {
    // Europe/Berlin skips 02:00–03:00 on Sunday 2026-03-29; 01:00 local is 00:00Z, 04:00 is 02:00Z.
    const [from, to] = range("2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z");
    const cal = zoneCalendar(
      input([weekly("w", 60, 240, 1, { days: [7] })], { timeZone: "Europe/Berlin" }),
      from,
      to,
    );
    expect(cal.windows[0]?.runs).toEqual([
      { starts_at: "2026-03-29T00:00:00.000Z", ends_at: "2026-03-29T02:00:00.000Z" },
    ]);
  });

  test("fall back: the repeated hour stays in one run of four real hours", () => {
    // Europe/Berlin repeats 02:00–03:00 on Sunday 2026-10-25; 01:00 CEST is 23:00Z the day before.
    const [from, to] = range("2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z");
    const cal = zoneCalendar(
      input([weekly("w", 60, 240, 1, { days: [7] })], { timeZone: "Europe/Berlin" }),
      from,
      to,
    );
    expect(cal.windows[0]?.runs).toEqual([
      { starts_at: "2026-10-24T23:00:00.000Z", ends_at: "2026-10-25T03:00:00.000Z" },
    ]);
    expect(cal.segments).toHaveLength(1);
  });

  test("break playlists of the zone, with the spans their daily window allows", () => {
    const [from, to] = range(day(6, "00:00"), day(8, "00:00"));
    const cal = zoneCalendar(
      input([], {
        breakPlaylists: [
          breakPlaylist("partners", [720, 1320]),
          breakPlaylist("always", null, ["main"]),
          breakPlaylist("cafe_only", null, ["cafe"]),
        ],
      }),
      from,
      to,
    );
    expect(cal.breaks).toEqual([
      {
        playlist_id: "partners",
        period_seconds: 3600,
        break_seconds: 45,
        spans: [
          { starts_at: day(6, "12:00"), ends_at: day(6, "22:00") },
          { starts_at: day(7, "12:00"), ends_at: day(7, "22:00") },
        ],
      },
      {
        playlist_id: "always",
        period_seconds: 3600,
        break_seconds: 45,
        spans: [{ starts_at: day(6, "00:00"), ends_at: day(8, "00:00") }],
      },
    ]);
  });
});
