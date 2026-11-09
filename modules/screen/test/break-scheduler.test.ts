// Ported from the legacy signage `advt-scheduler.test.ts` and `advt-window.test.ts` (the
// scheduler and daily-window halves): the storage they wrote is now the state the tick carries.
import { describe, expect, test } from "vitest";

import { isInBreakWindow, validateBreakWindow } from "../src/playback/breaks.js";
import { breakPlaylist, inputFor, ticker } from "./break-fixtures.js";

const MIN = 60_000;
// 2026-04-06, a Monday, in UTC.
const at = (hhmm: string) => Date.parse(`2026-04-06T${hhmm}:00Z`);

describe("the daily window", () => {
  const rules = (start: number | null, end: number | null) => ({
    windowStartMinute: start,
    windowEndMinute: end,
  });

  test("no bounds means always", () => {
    expect(isInBreakWindow(rules(null, null), at("03:00"), "UTC")).toBe(true);
  });

  test("start inclusive, end exclusive, minute resolution", () => {
    const day = rules(9 * 60, 17 * 60);
    expect(isInBreakWindow(day, at("08:59"), "UTC")).toBe(false);
    expect(isInBreakWindow(day, at("09:00"), "UTC")).toBe(true);
    expect(isInBreakWindow(day, at("16:59") + 59_000, "UTC")).toBe(true);
    expect(isInBreakWindow(day, at("17:00"), "UTC")).toBe(false);
  });

  test("wraps past midnight when the start is later than the end; 1440 is midnight", () => {
    const night = rules(22 * 60, 2 * 60);
    expect(isInBreakWindow(night, at("23:30"), "UTC")).toBe(true);
    expect(isInBreakWindow(night, at("01:59"), "UTC")).toBe(true);
    expect(isInBreakWindow(night, at("12:00"), "UTC")).toBe(false);
    expect(isInBreakWindow(rules(20 * 60, 1440), at("23:59"), "UTC")).toBe(true);
  });

  test("uses the event's time zone", () => {
    // 08:30 UTC is 11:30 in Helsinki (summer time).
    expect(isInBreakWindow(rules(11 * 60, 12 * 60), at("08:30"), "Europe/Helsinki")).toBe(true);
    expect(isInBreakWindow(rules(11 * 60, 12 * 60), at("08:30"), "UTC")).toBe(false);
  });

  test("validation: both or neither, in range, start and end differ", () => {
    expect(validateBreakWindow(null, null)).toEqual({ ok: true });
    expect(validateBreakWindow(540, 1440)).toEqual({ ok: true });
    for (const [start, end] of [
      [540, null],
      [null, 540],
      [540, 540],
      [1440, 60],
      [-1, 60],
      [60, 1441],
      [60.5, 120],
    ] as const) {
      expect(validateBreakWindow(start, end).ok).toBe(false);
    }
  });
});

describe("which break starts", () => {
  test("a break first seen is due one period later", () => {
    const t = ticker(inputFor([breakPlaylist("solo", { periodSeconds: 100 })]));
    expect(t.tick(0)).toBeNull();
    expect(t.dueOf("solo")).toBe(100_000);
    expect(t.tick(99_999)).toBeNull();
    expect(t.tick(100_000)?.playlistId).toBe("solo");
  });

  test("orders due breaks by priority, highest first", () => {
    const t = ticker(
      inputFor([
        breakPlaylist("low", { priority: 1 }),
        breakPlaylist("high", { priority: 9 }),
        breakPlaylist("mid", { priority: 5 }),
      ]),
    );
    t.setDue("low", 1000);
    t.setDue("high", 5000);
    t.setDue("mid", 2000);
    expect(t.tick(10_000)?.playlistId).toBe("high");
  });

  test("breaks priority ties by the earlier due time, then the name, then the id", () => {
    const byDue = ticker(inputFor([breakPlaylist("x", {}), breakPlaylist("y", {})]));
    byDue.setDue("x", 3000);
    byDue.setDue("y", 1000);
    expect(byDue.tick(10_000)?.playlistId).toBe("y");

    const named = [breakPlaylist("p1", { name: "Zeta" }), breakPlaylist("p2", { name: "Alpha" })];
    const byName = ticker(inputFor(named));
    byName.setDue("p1", 1000);
    byName.setDue("p2", 1000);
    expect(byName.tick(10_000)?.playlistId).toBe("p2");

    const same = [breakPlaylist("b-id", { name: "Same" }), breakPlaylist("a-id", { name: "Same" })];
    const byId = ticker(inputFor(same));
    byId.setDue("b-id", 1000);
    byId.setDue("a-id", 1000);
    expect(byId.tick(10_000)?.playlistId).toBe("a-id");
  });

  test("only the breaks that interrupt this zone", () => {
    const t = ticker(
      inputFor([
        breakPlaylist("lobby", { zones: ["lobby"], priority: 9 }),
        breakPlaylist("here", { zones: ["main", "lobby"] }),
      ]),
    );
    t.setDue("lobby", 0);
    t.setDue("here", 0);
    expect(t.tick(1000)?.playlistId).toBe("here");
    expect(t.state.playlists.lobby).toBeUndefined();
  });

  test("says the region it interrupts and when it ends", () => {
    const t = ticker(inputFor([breakPlaylist("full", { region: "full", breakSeconds: 30 })]));
    t.setDue("full", 0);
    expect(t.tick(5000)).toMatchObject({
      playlistId: "full",
      region: "full",
      startedAt: 5000,
      endsAt: 35_000,
    });
  });

  test("a break with nothing playable never starts; its due time moves a period on", () => {
    const empty = breakPlaylist("empty", { priority: 9 }, []);
    const t = ticker(inputFor([empty, breakPlaylist("ok", {})]));
    t.setDue("empty", 0);
    t.setDue("ok", 0);
    expect(t.tick(1000)?.playlistId).toBe("ok");
    expect(t.dueOf("empty")).toBe(101_000);
  });
});

describe("priority chaining and the gap", () => {
  const pair = () =>
    ticker(inputFor([breakPlaylist("first", { priority: 5 }), breakPlaylist("second", {})]));

  test("chains the next due break in the same tick and keeps waiting due times", () => {
    const t = pair();
    t.setDue("first", 4000);
    t.setDue("second", 2000);
    expect(t.tick(10_000)?.playlistId).toBe("first");
    expect(t.dueOf("second")).toBe(2000);
    // The first break (10 s) ends: the second starts in the same tick, nothing between.
    const chained = t.tick(20_000);
    expect(chained).toMatchObject({ playlistId: "second", startedAt: 20_000 });
    expect(chained?.frame).not.toBeNull();
    expect(t.tick(30_000)).toBeNull();
    expect(t.state.active).toBeNull();
    expect(t.state.chainEndedAt).toBe(30_000);
  });

  test("the next due is the break's start plus its period; ending it does not move it", () => {
    const t = ticker(inputFor([breakPlaylist("solo", { periodSeconds: 100 })]));
    t.setDue("solo", 0);
    t.tick(10_000);
    expect(t.dueOf("solo")).toBe(110_000);
    t.tick(25_000);
    expect(t.dueOf("solo")).toBe(110_000);
  });

  test("the gap holds new breaks back until it passes, then they start", () => {
    const t = ticker(inputFor([breakPlaylist("solo", { periodSeconds: 30 })]));
    t.setDue("solo", 0);
    t.tick(10_000); // starts; next due 40 s
    t.tick(20_000); // ends; the gap of 60 s runs to 80 s
    expect(t.tick(50_000)).toBeNull();
    expect(t.tick(79_999)).toBeNull();
    expect(t.dueOf("solo")).toBe(40_000);
    expect(t.tick(80_000)?.playlistId).toBe("solo");
    expect(t.dueOf("solo")).toBe(110_000);
  });

  test("a gap of 0 turns it off", () => {
    const t = ticker(
      inputFor([breakPlaylist("solo", { periodSeconds: 30 })], { minGapSeconds: 0 }),
    );
    t.setDue("solo", 0);
    t.tick(10_000);
    t.tick(20_000);
    expect(t.tick(40_000)?.playlistId).toBe("solo");
  });

  test("a break whose playlist is gone or no longer interrupts the zone ends at once", () => {
    const solo = breakPlaylist("solo", {});
    const input = inputFor([solo]);
    const t = ticker(input);
    t.setDue("solo", 0);
    expect(t.tick(1000)?.playlistId).toBe("solo");
    input.playlists = [{ ...solo, break: { ...solo.break, zones: ["lobby"] } }];
    expect(t.tick(2000)).toBeNull();
    expect(t.state).toMatchObject({ active: null, chainEndedAt: 2000 });
  });
});

describe("breaks and their daily window", () => {
  const windowed = (extra = {}) =>
    breakPlaylist("a", {
      periodSeconds: 600,
      breakSeconds: 30,
      windowStartMinute: 9 * 60,
      windowEndMinute: 17 * 60,
      ...extra,
    });

  test("a closed break never starts, even when overdue", () => {
    const t = ticker(inputFor([windowed()]));
    t.tick(at("03:00"));
    expect(t.dueOf("a")).toBe(at("03:00"));
    expect(t.tick(at("03:05"))).toBeNull();
    // Already overdue: it stays; only a due time in the future is pulled back to now.
    expect(t.dueOf("a")).toBe(at("03:00"));
  });

  test("the first break is due at once when the window opens", () => {
    const t = ticker(inputFor([windowed()]));
    t.tick(at("08:00"));
    expect(t.tick(at("08:59"))).toBeNull();
    expect(t.tick(at("09:00"))?.playlistId).toBe("a");
  });

  test("due at once on opening, even after a break just before the close the day before", () => {
    const t = ticker(inputFor([windowed()]));
    t.tick(at("16:00"));
    expect(t.dueOf("a")).toBe(at("16:00") + 10 * MIN);
    t.setDue("a", at("16:59"));
    expect(t.tick(at("16:59"))?.playlistId).toBe("a");
    expect(t.tick(at("16:59") + 31_000)).toBeNull();
    const next = at("16:59") + 10 * MIN;
    expect(t.dueOf("a")).toBe(next);
    // Closed with the due time passed: it stays; one in the future is pulled back to now.
    t.tick(at("17:30"));
    expect(t.dueOf("a")).toBe(next);
    t.setDue("a", at("20:00"));
    t.tick(at("17:31"));
    expect(t.dueOf("a")).toBe(at("17:31"));
    const open = at("09:00") + 24 * 60 * MIN;
    t.tick(open - MIN);
    expect(t.tick(open)?.playlistId).toBe("a");
  });

  test("a running break finishes after the window closes", () => {
    const t = ticker(inputFor([windowed({ breakSeconds: 120 })]));
    t.tick(at("16:00"));
    t.setDue("a", at("16:59"));
    expect(t.tick(at("16:59"))?.playlistId).toBe("a");
    expect(t.tick(at("17:00") + 5_000)?.playlistId).toBe("a");
    expect(t.tick(at("16:59") + 121_000)).toBeNull();
    // Ended while closed: start + period, pulled back to now by the same tick.
    expect(t.dueOf("a")).toBe(at("16:59") + 121_000);
  });

  test("a closed break does not take part in the order, the chain or the gap", () => {
    const t = ticker(
      inputFor(
        [
          windowed({ priority: 9 }),
          breakPlaylist("b", { priority: 2, periodSeconds: 600, breakSeconds: 30 }),
          breakPlaylist("c", { priority: 1, periodSeconds: 600, breakSeconds: 30 }),
        ],
        { minGapSeconds: 0 },
      ),
    );
    const t0 = at("03:00");
    t.tick(t0);
    t.setDue("b", t0);
    t.setDue("c", t0);
    expect(t.tick(t0)?.playlistId).toBe("b");
    expect(t.tick(t0 + 31_000)?.playlistId).toBe("c");
    expect(t.tick(t0 + 62_000)).toBeNull();
    expect(t.state.chainEndedAt).toBe(t0 + 62_000);
  });
});
