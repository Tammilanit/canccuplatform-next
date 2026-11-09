import { describe, expect, test } from "vitest";

import { NEXT_CHANGE_HORIZON_MS, simulate } from "../src/schedule/simulate.js";
import type { AgendaTimes, ScheduleWindow } from "../src/schedule/winner.js";

const MON = 1;

function weekly(id: string, startMinute: number, endMinute: number, priority: number) {
  const window: ScheduleWindow = {
    id,
    zoneKey: "main",
    playlistId: `pl-${id}`,
    priority,
    layoutId: null,
    days: [MON],
    startMinute,
    endMinute,
    agendaItemId: null,
  };
  return window;
}

// 2026-04-06 is a Monday.
const at = (iso: string) => new Date(`2026-04-06T${iso}Z`);
const base = { zoneKey: "main", zoneLayoutId: "pulse", timeZone: "UTC" };

describe("simulate", () => {
  test("names the winning window, its playlist and the zone's layout", () => {
    const windows = [weekly("day", 9 * 60, 17 * 60, 10), weekly("ads", 10 * 60, 11 * 60, 50)];
    expect(simulate({ ...base, windows }, at("10:15:00"))).toEqual({
      at: "2026-04-06T10:15:00.000Z",
      zone_key: "main",
      schedule_id: "ads",
      playlist_id: "pl-ads",
      layout_id: "pulse",
      in_break: false,
      next_change_at: "2026-04-06T11:00:00.000Z",
    });
  });

  test("a window's layout replaces the zone's for its time", () => {
    const windows = [{ ...weekly("day", 9 * 60, 17 * 60, 10), layoutId: "stage" }];
    expect(simulate({ ...base, windows }, at("10:00:00")).layout_id).toBe("stage");
    expect(simulate({ ...base, windows }, at("18:00:00")).layout_id).toBe("pulse");
  });

  test("ignores other zones' windows", () => {
    const windows = [{ ...weekly("hall", 9 * 60, 17 * 60, 10), zoneKey: "hall" }];
    const result = simulate({ ...base, windows }, at("10:00:00"));
    expect(result).toMatchObject({ schedule_id: null, playlist_id: null });
  });

  test("with no window, the next change is the next window's start", () => {
    const windows = [weekly("day", 9 * 60, 17 * 60, 10)];
    expect(simulate({ ...base, windows }, at("08:20:30"))).toMatchObject({
      schedule_id: null,
      playlist_id: null,
      next_change_at: "2026-04-06T09:00:00.000Z",
    });
  });

  test("the next change of an agenda-bound window is its item's exact end", () => {
    const talk: AgendaTimes = {
      id: "talk",
      startsAt: at("12:00:00"),
      endsAt: at("12:59:30"),
      status: "scheduled",
    };
    const windows: ScheduleWindow[] = [
      weekly("day", 9 * 60, 17 * 60, 10),
      {
        id: "w",
        zoneKey: "main",
        playlistId: "pl-w",
        priority: 20,
        layoutId: null,
        agendaItemId: "talk",
      },
    ];
    const agendaItems = new Map([["talk", talk]]);
    expect(simulate({ ...base, windows, agendaItems }, at("11:00:00")).next_change_at).toBe(
      "2026-04-06T12:00:00.000Z",
    );
    expect(simulate({ ...base, windows, agendaItems }, at("12:10:00")).next_change_at).toBe(
      "2026-04-06T12:59:30.000Z",
    );
  });

  test("next_change_at is null when nothing changes within the horizon", () => {
    const always: ScheduleWindow = { ...weekly("always", 0, 1440, 1), days: [1, 2, 3, 4, 5, 6, 7] };
    expect(simulate({ ...base, windows: [always] }, at("10:00:00")).next_change_at).toBeNull();
    expect(simulate({ ...base, windows: [] }, at("10:00:00")).next_change_at).toBeNull();
  });

  test("looks a day ahead, as far as the screens prefetch", () => {
    expect(NEXT_CHANGE_HORIZON_MS).toBe(24 * 60 * 60 * 1000);
    const tuesday = { ...weekly("tue", 9 * 60, 10 * 60, 1), days: [2] };
    expect(simulate({ ...base, windows: [tuesday] }, at("09:00:00")).next_change_at).toBe(
      "2026-04-07T09:00:00.000Z",
    );
    expect(simulate({ ...base, windows: [tuesday] }, at("08:59:59")).next_change_at).toBeNull();
  });

  test("in_break comes from the injected break check", () => {
    const inBreak = (when: Date) => when.getTime() === at("10:00:00").getTime();
    expect(simulate({ ...base, windows: [], inBreak }, at("10:00:00")).in_break).toBe(true);
    expect(simulate({ ...base, windows: [], inBreak }, at("10:00:01")).in_break).toBe(false);
  });
});
