// Daylight saving (E12 of the step 3 brief). Windows are wall-clock times in the event's time zone:
// a window keeps its local hours across a switch, a local time the spring switch skips never
// happens, and one the autumn switch repeats happens twice.
//   Europe/Berlin 2026: 29 March 01:00 UTC (02:00 → 03:00), 25 October 01:00 UTC (03:00 → 02:00).
//   America/New_York 2026: 8 March 07:00 UTC (02:00 → 03:00), 1 November 06:00 UTC (02:00 → 01:00).
import { describe, expect, test } from "vitest";

import { simulate } from "../src/schedule/simulate.js";
import { localClock } from "../src/schedule/window.js";
import type { ScheduleWindow } from "../src/schedule/winner.js";
import { resolveWinner, windowStartedAt } from "../src/schedule/winner.js";

const SAT = 6;
const SUN = 7;
const BERLIN = "Europe/Berlin";
const NEW_YORK = "America/New_York";

function weekly(days: number[], startMinute: number, endMinute: number, priority = 10) {
  const window: ScheduleWindow = {
    id: "w",
    zoneKey: "main",
    playlistId: "pl",
    priority,
    layoutId: null,
    days,
    startMinute,
    endMinute,
    agendaItemId: null,
  };
  return window;
}

const utc = (iso: string) => new Date(`${iso}Z`);
const active = (window: ScheduleWindow, timeZone: string, at: Date) =>
  resolveWinner({ windows: [window], timeZone }, at) !== null;

/** Every minute of [from, to) at which the window is active, as runs of [start, end). */
function activeRuns(window: ScheduleWindow, timeZone: string, from: Date, to: Date) {
  const runs: [string, string][] = [];
  let open: Date | null = null;
  for (let t = from.getTime(); t <= to.getTime(); t += 60_000) {
    const now = new Date(t);
    const on = t < to.getTime() && active(window, timeZone, now);
    if (on && open === null) open = now;
    if (!on && open !== null) {
      runs.push([open.toISOString(), now.toISOString()]);
      open = null;
    }
  }
  return runs;
}

describe("Europe/Berlin, spring forward", () => {
  test("the clock reads the summer offset after the switch", () => {
    expect(localClock(utc("2026-03-29T00:59:00"), BERLIN)).toMatchObject({
      minuteOfDay: 60 + 59,
      offsetMinutes: 60,
    });
    expect(localClock(utc("2026-03-29T01:00:00"), BERLIN)).toMatchObject({
      minuteOfDay: 3 * 60,
      offsetMinutes: 120,
    });
  });

  test("a window keeps its local hours, an hour earlier in UTC", () => {
    const window = weekly([SUN], 9 * 60, 10 * 60);
    expect(
      activeRuns(window, BERLIN, utc("2026-03-22T00:00:00"), utc("2026-03-23T00:00:00")),
    ).toEqual([["2026-03-22T08:00:00.000Z", "2026-03-22T09:00:00.000Z"]]);
    expect(
      activeRuns(window, BERLIN, utc("2026-03-29T00:00:00"), utc("2026-03-30T00:00:00")),
    ).toEqual([["2026-03-29T07:00:00.000Z", "2026-03-29T08:00:00.000Z"]]);
  });

  test("a window inside the skipped hour never runs that day", () => {
    const window = weekly([SUN], 2 * 60, 2 * 60 + 30);
    expect(
      activeRuns(window, BERLIN, utc("2026-03-28T22:00:00"), utc("2026-03-29T22:00:00")),
    ).toEqual([]);
  });

  test("a window across the skipped hour is one real hour shorter", () => {
    const window = weekly([SUN], 60 + 30, 3 * 60 + 30);
    expect(
      activeRuns(window, BERLIN, utc("2026-03-28T22:00:00"), utc("2026-03-29T22:00:00")),
    ).toEqual([["2026-03-29T00:30:00.000Z", "2026-03-29T01:30:00.000Z"]]);
    const result = simulate(
      { zoneKey: "main", zoneLayoutId: "pulse", timeZone: BERLIN, windows: [window] },
      utc("2026-03-29T00:30:00"),
    );
    expect(result.next_change_at).toBe("2026-03-29T01:30:00.000Z");
  });

  test("a window's start is the real instant it began, across the switch", () => {
    const window = weekly([SUN], 0, 12 * 60);
    const input = { windows: [window], timeZone: BERLIN };
    // 09:00 UTC is 11:00 CEST: eleven wall-clock hours since midnight, but only ten real ones.
    expect(windowStartedAt(window, utc("2026-03-29T09:00:00"), input)).toEqual(
      utc("2026-03-28T23:00:00"),
    );
  });

  test("the later-start rule compares real instants across the switch", () => {
    const morning = { ...weekly([SUN], 0, 12 * 60), id: "morning" };
    const talk: ScheduleWindow = {
      id: "talk",
      zoneKey: "main",
      playlistId: "pl-talk",
      priority: 10,
      layoutId: null,
      agendaItemId: "talk",
    };
    const agendaItems = new Map([
      [
        "talk",
        {
          id: "talk",
          startsAt: utc("2026-03-28T22:30:00"),
          endsAt: utc("2026-03-29T12:00:00"),
          status: "scheduled" as const,
        },
      ],
    ]);
    // The talk began at 22:30 UTC, the morning window at 23:00 UTC (local midnight): the morning
    // window began later. Counting wall-clock minutes back from 11:00 CEST would put it at 22:00.
    const winner = resolveWinner(
      { windows: [talk, morning], timeZone: BERLIN, agendaItems },
      utc("2026-03-29T09:00:00"),
    );
    expect(winner?.id).toBe("morning");
  });
});

describe("a start inside the skipped hour", () => {
  // A window whose local start never happens begins when the clock jumps past it.
  const a = { ...weekly([SUN], 2 * 60 + 30, 4 * 60, 1), id: "a" };
  const b = { ...weekly([SUN], 60 + 45, 5 * 60, 1), id: "b" };

  test("Europe/Berlin: the window begins at the switch and so began later", () => {
    const input = { windows: [a, b], timeZone: BERLIN };
    const at = utc("2026-03-29T01:10:00");
    expect(windowStartedAt(a, at, input)).toEqual(utc("2026-03-29T01:00:00"));
    expect(windowStartedAt(b, at, input)).toEqual(utc("2026-03-29T00:45:00"));
    expect(resolveWinner(input, at)?.id).toBe("a");
  });

  test("America/New_York: the same at its own switch", () => {
    const input = { windows: [a, b], timeZone: NEW_YORK };
    const at = utc("2026-03-08T07:10:00");
    expect(windowStartedAt(a, at, input)).toEqual(utc("2026-03-08T07:00:00"));
    expect(windowStartedAt(b, at, input)).toEqual(utc("2026-03-08T06:45:00"));
    expect(resolveWinner(input, at)?.id).toBe("a");
  });
});

describe("Europe/Berlin, fall back", () => {
  test("a window that runs through the repeated hour began at its first start", () => {
    const window = weekly([SUN], 2 * 60, 4 * 60);
    const input = { windows: [window], timeZone: BERLIN };
    // 02:10 UTC is 03:10 CET; 02:00 local happened at 00:00 and again at 01:00 UTC, and the
    // window has run without a break since the first.
    expect(windowStartedAt(window, utc("2026-10-25T02:10:00"), input)).toEqual(
      utc("2026-10-25T00:00:00"),
    );
  });

  test("a window's second run in the repeated hour began at the second start", () => {
    const window = weekly([SUN], 2 * 60, 2 * 60 + 30);
    const input = { windows: [window], timeZone: BERLIN };
    expect(windowStartedAt(window, utc("2026-10-25T01:10:00"), input)).toEqual(
      utc("2026-10-25T01:00:00"),
    );
  });

  test("a window inside the repeated hour runs twice", () => {
    const window = weekly([SUN], 2 * 60, 2 * 60 + 30);
    expect(
      activeRuns(window, BERLIN, utc("2026-10-24T22:00:00"), utc("2026-10-25T23:00:00")),
    ).toEqual([
      ["2026-10-25T00:00:00.000Z", "2026-10-25T00:30:00.000Z"],
      ["2026-10-25T01:00:00.000Z", "2026-10-25T01:30:00.000Z"],
    ]);
  });

  test("a window across the repeated hour is one real hour longer", () => {
    const window = weekly([SUN], 60 + 30, 3 * 60 + 30);
    expect(
      activeRuns(window, BERLIN, utc("2026-10-24T22:00:00"), utc("2026-10-25T23:00:00")),
    ).toEqual([["2026-10-24T23:30:00.000Z", "2026-10-25T02:30:00.000Z"]]);
  });
});

describe("America/New_York", () => {
  test("an overnight window across spring forward lasts seven real hours", () => {
    const window = weekly([SAT], 22 * 60, 6 * 60);
    expect(
      activeRuns(window, NEW_YORK, utc("2026-03-07T12:00:00"), utc("2026-03-08T18:00:00")),
    ).toEqual([["2026-03-08T03:00:00.000Z", "2026-03-08T10:00:00.000Z"]]);
    const result = simulate(
      { zoneKey: "main", zoneLayoutId: "pulse", timeZone: NEW_YORK, windows: [window] },
      utc("2026-03-08T03:00:00"),
    );
    expect(result.next_change_at).toBe("2026-03-08T10:00:00.000Z");
  });

  test("an overnight window across fall back lasts nine real hours", () => {
    const window = weekly([SAT], 22 * 60, 6 * 60);
    expect(
      activeRuns(window, NEW_YORK, utc("2026-10-31T12:00:00"), utc("2026-11-01T18:00:00")),
    ).toEqual([["2026-11-01T02:00:00.000Z", "2026-11-01T11:00:00.000Z"]]);
  });

  test("the overnight window's start stays the Saturday evening after the switch", () => {
    const window = weekly([SAT], 22 * 60, 6 * 60);
    const input = { windows: [window], timeZone: NEW_YORK };
    expect(windowStartedAt(window, utc("2026-11-01T10:00:00"), input)).toEqual(
      utc("2026-11-01T02:00:00"),
    );
  });
});
