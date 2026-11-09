import { describe, expect, test } from "vitest";

import { projectBreaks } from "../src/playback/break-projection.js";
import { NO_BREAKS, stepBreaks } from "../src/playback/breaks.js";
import { breakPlaylist, inputFor } from "./break-fixtures.js";

// 2026-04-06, a Monday, in UTC.
const at = (hhmmss: string) => new Date(`2026-04-06T${hhmmss}Z`);
const span = (from: string, to: string) => ({ startsAt: at(from), endsAt: at(to) });

describe("the breaks ahead", () => {
  test("follow the period from the stored due time, with the gap after each", () => {
    const input = inputFor([breakPlaylist("ads", { periodSeconds: 120, breakSeconds: 10 })]);
    const state = {
      ...NO_BREAKS,
      playlists: { ads: { dueAt: at("10:00:30").getTime(), bookmark: null, nextImageId: null } },
    };
    expect(projectBreaks(state, input, at("10:00:00"), at("10:05:00"))).toEqual([
      span("10:00:30", "10:00:40"),
      span("10:02:30", "10:02:40"),
      span("10:04:30", "10:04:40"),
    ]);
  });

  test("a chain is one run, and the gap holds the next break back", () => {
    const input = inputFor([
      breakPlaylist("a", { priority: 2, periodSeconds: 60, breakSeconds: 10 }),
      breakPlaylist("b", { priority: 1, periodSeconds: 60, breakSeconds: 10 }),
    ]);
    const due = at("10:00:00").getTime();
    const state = {
      ...NO_BREAKS,
      playlists: {
        a: { dueAt: due, bookmark: null, nextImageId: null },
        b: { dueAt: due, bookmark: null, nextImageId: null },
      },
    };
    // a and b chain to 10:00:20; a is due again at 10:01:00 but the 60 s gap holds it to 10:01:20.
    expect(projectBreaks(state, input, at("10:00:00"), at("10:01:30"))).toEqual([
      span("10:00:00", "10:00:20"),
      span("10:01:20", "10:01:40"),
    ]);
  });

  test("a break running now counts from its start; the stored state is left as it was", () => {
    const input = inputFor([breakPlaylist("ads", { breakSeconds: 30 })]);
    const start = at("10:00:00").getTime();
    const running = stepBreaks(
      { ...NO_BREAKS, playlists: { ads: { dueAt: start, bookmark: null, nextImageId: null } } },
      input,
      start,
    ).state;
    const copy = structuredClone(running);
    expect(projectBreaks(running, input, at("10:00:10"), at("10:01:00"))).toEqual([
      span("10:00:00", "10:00:30"),
    ]);
    expect(running).toEqual(copy);
  });

  test("a daily window opens on its minute", () => {
    const input = inputFor([
      breakPlaylist("ads", { windowStartMinute: 9 * 60, windowEndMinute: 17 * 60 }),
    ]);
    expect(projectBreaks(NO_BREAKS, input, at("08:58:30"), at("09:00:30"))).toEqual([
      span("09:00:00", "09:00:10"),
    ]);
  });
});
