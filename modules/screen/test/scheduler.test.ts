// The winner choice: ported from the legacy signage scheduler.test.ts (resolveActiveSchedule) and
// extended to the contract's windows (ISO `days`, agenda-bound windows). Its playback-frame half
// is slice C's.
import { describe, expect, test } from "vitest";

import type { AgendaTimes, ScheduleWindow, WeeklyWindow } from "../src/schedule/winner.js";
import { resolveWinner, windowStartedAt } from "../src/schedule/winner.js";

const MON = 1;

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
    playlistId: id,
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
  return { id, zoneKey: "main", playlistId: id, priority, layoutId: null, agendaItemId };
}

function item(id: string, startsAt: string, endsAt: string | null, cancelled = false) {
  const times: AgendaTimes = {
    id,
    startsAt: new Date(startsAt),
    endsAt: endsAt === null ? null : new Date(endsAt),
    status: cancelled ? "cancelled" : "scheduled",
  };
  return times;
}

// 2026-04-06 is a Monday.
const at = (iso: string) => new Date(`2026-04-06T${iso}Z`);

describe("resolveWinner", () => {
  test("prefers the highest priority active window", () => {
    const windows = [weekly("default", 9 * 60, 17 * 60, 10), weekly("ads", 10 * 60, 11 * 60, 50)];
    expect(resolveWinner({ windows, timeZone: "UTC" }, at("10:15:00"))?.id).toBe("ads");
  });

  test("breaks equal-priority overlaps by the later start", () => {
    const windows = [weekly("base", 8 * 60, 12 * 60, 30), weekly("late", 10 * 60, 12 * 60, 30)];
    expect(resolveWinner({ windows, timeZone: "UTC" }, at("10:30:00"))?.id).toBe("late");
  });

  test("then by the playlist's priority", () => {
    const windows = [weekly("a", 9 * 60, 12 * 60, 30), weekly("b", 9 * 60, 12 * 60, 30)];
    const playlistPriorities = new Map([["b", 5]]);
    expect(
      resolveWinner({ windows, timeZone: "UTC", playlistPriorities }, at("10:00:00"))?.id,
    ).toBe("b");
  });

  test("then by the id, so every container picks the same window", () => {
    const windows = [weekly("b", 9 * 60, 12 * 60, 30), weekly("a", 9 * 60, 12 * 60, 30)];
    expect(resolveWinner({ windows, timeZone: "UTC" }, at("10:00:00"))?.id).toBe("a");
  });

  test("returns null when no window is active", () => {
    const windows = [weekly("day", 9 * 60, 17 * 60, 10)];
    expect(resolveWinner({ windows, timeZone: "UTC" }, at("18:00:00"))).toBeNull();
  });

  test("can resolve windows in an explicit event time zone", () => {
    const windows = [weekly("helsinki", 10 * 60, 11 * 60, 20)];
    expect(resolveWinner({ windows, timeZone: "Europe/Helsinki" }, at("07:15:00"))?.id).toBe(
      "helsinki",
    );
    expect(resolveWinner({ windows, timeZone: "UTC" }, at("07:15:00"))).toBeNull();
  });

  test("resolves on Tuesday morning for a Monday-started overnight window", () => {
    const windows = [weekly("night", 4 * 60, 3 * 60 + 59, 10)];
    const tuesday2am = new Date("2026-04-13T23:00:00Z");
    expect(resolveWinner({ windows, timeZone: "Europe/Helsinki" }, tuesday2am)?.id).toBe("night");
  });

  test("a window that began last night ranks below one that began this morning", () => {
    // Legacy compared the start minute alone, so 22:00 outranked 01:00 although it began earlier.
    const windows = [
      weekly("night", 22 * 60, 6 * 60, 30, { days: [7] }),
      weekly("early", 60, 5 * 60, 30),
    ];
    expect(resolveWinner({ windows, timeZone: "UTC" }, at("02:00:00"))?.id).toBe("early");
  });
});

describe("agenda-bound windows", () => {
  const agendaItems = new Map([
    ["talk", item("talk", "2026-04-06T12:00:00Z", "2026-04-06T13:00:00Z")],
    ["doors", item("doors", "2026-04-06T10:00:00Z", null)],
    ["gone", item("gone", "2026-04-06T12:00:00Z", "2026-04-06T13:00:00Z", true)],
  ]);

  test("is active while its item runs, end exclusive", () => {
    const input = { windows: [bound("w", "talk", 10)], timeZone: "UTC", agendaItems };
    expect(resolveWinner(input, at("11:59:59"))).toBeNull();
    expect(resolveWinner(input, at("12:00:00"))?.id).toBe("w");
    expect(resolveWinner(input, at("12:59:59"))?.id).toBe("w");
    expect(resolveWinner(input, at("13:00:00"))).toBeNull();
  });

  test("follows a delay, since it reads the item's current times", () => {
    const delayed = new Map([
      ["talk", item("talk", "2026-04-06T12:15:00Z", "2026-04-06T13:15:00Z")],
    ]);
    const input = { windows: [bound("w", "talk", 10)], timeZone: "UTC", agendaItems: delayed };
    expect(resolveWinner(input, at("12:05:00"))).toBeNull();
    expect(resolveWinner(input, at("13:05:00"))?.id).toBe("w");
  });

  test("is never active for a cancelled, removed or endless item", () => {
    for (const id of ["gone", "missing", "doors"]) {
      const input = { windows: [bound("w", id, 10)], timeZone: "UTC", agendaItems };
      expect(resolveWinner(input, at("12:30:00"))).toBeNull();
    }
  });

  test("competes with weekly windows by the same rules", () => {
    const windows = [weekly("day", 9 * 60, 17 * 60, 10), bound("talk", "talk", 10)];
    const input = { windows, timeZone: "UTC", agendaItems };
    // Same priority: the talk began later, so it wins while it runs.
    expect(resolveWinner(input, at("12:30:00"))?.id).toBe("talk");
    expect(resolveWinner(input, at("13:30:00"))?.id).toBe("day");
    const higher = {
      ...input,
      windows: [weekly("day", 9 * 60, 17 * 60, 50), bound("talk", "talk", 10)],
    };
    expect(resolveWinner(higher, at("12:30:00"))?.id).toBe("day");
  });
});

describe("windowStartedAt", () => {
  test("is the instant the current occurrence began", () => {
    const input = { windows: [], timeZone: "Europe/Helsinki" };
    // 10:00 in Helsinki (UTC+3) is 07:00 UTC.
    expect(windowStartedAt(weekly("w", 10 * 60, 11 * 60, 1), at("07:15:30"), input)).toEqual(
      at("07:00:00"),
    );
  });

  test("is null when the window is not active", () => {
    const input = { windows: [], timeZone: "UTC" };
    expect(windowStartedAt(weekly("w", 10 * 60, 11 * 60, 1), at("12:00:00"), input)).toBeNull();
  });
});
