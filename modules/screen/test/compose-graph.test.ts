import { describe, expect, it } from "vitest";
import { graphOf, scaleOf } from "../src/compose/graph.js";

// The bar graphs' value scale and hour labels (#523, #527; contracts/screen.md, Widgets).
describe("a graph's value scale", () => {
  it("steps by a round number, from the top down to 0, with two or three lines over the base", () => {
    expect(scaleOf(231)).toEqual([300, 200, 100, 0]);
    expect(scaleOf(110)).toEqual([150, 100, 50, 0]);
    expect(scaleOf(61)).toEqual([75, 50, 25, 0]);
    expect(scaleOf(7)).toEqual([10, 5, 0]);
    expect(scaleOf(200)).toEqual([200, 100, 0]);
  });

  it("steps by 1, 2, 2.5 or 5 of every decade, so the highest bar fills two thirds or more", () => {
    expect(scaleOf(700)).toEqual([750, 500, 250, 0]);
    expect(scaleOf(601)).toEqual([750, 500, 250, 0]);
    expect(scaleOf(6100)).toEqual([7500, 5000, 2500, 0]);
    expect(scaleOf(70_000)).toEqual([75_000, 50_000, 25_000, 0]);
    for (const highest of [4, 13, 61, 140, 333, 601, 749, 1001, 4999, 24_000, 60_100]) {
      const top = scaleOf(highest)[0] as number;
      expect(highest / top, `a peak of ${highest} under a top of ${top}`).toBeGreaterThanOrEqual(
        2 / 3,
      );
    }
  });

  it("keeps whole numbers and two lines for a handful of people or none", () => {
    expect(scaleOf(3)).toEqual([3, 2, 1, 0]);
    expect(scaleOf(1)).toEqual([2, 1, 0]);
    expect(scaleOf(0)).toEqual([2, 1, 0]);
  });
});

/** A Dashboard box (4 of 12 columns) and the Pulse hero (8 of 12), in units of a 16:9 screen. */
const BOX_UNITS = (4 / 12) * (1600 / 9);
const HERO_UNITS = (8 / 12) * (1600 / 9);

const day = (from: number, values: number[]) =>
  values.map((value, i) => ({
    time_text: `${String((from + i) % 24).padStart(2, "0")}:00`,
    value,
  }));

describe("a graph's bars and hours", () => {
  const hours = [
    { time_text: "17:00", value: 40 },
    { time_text: "18:00", value: 231 },
    { time_text: "19:00", value: 150 },
    { time_text: "21:00", value: 0 },
  ];

  it("scales each bar against the scale's top, not the highest hour", () => {
    const graph = graphOf(hours, BOX_UNITS);
    expect(graph.scale).toEqual([{ value: 300 }, { value: 200 }, { value: 100 }, { value: 0 }]);
    expect(graph.points.map((p) => p.level)).toEqual([1, 8, 5, 0]);
  });

  it("labels the hours on its step, and only those", () => {
    expect(graphOf(hours, BOX_UNITS).points.map((p) => p.tick_text)).toEqual([
      undefined,
      "18:00",
      undefined,
      undefined,
    ]);
    expect(graphOf(hours, HERO_UNITS).points.map((p) => p.tick_text)).toEqual([
      undefined,
      "18:00",
      undefined,
      "21:00",
    ]);
    // An absent label, never an undefined one: the fingerprint and the player read the same JSON.
    expect("tick_text" in (graphOf(hours, BOX_UNITS).points[0] ?? {})).toBe(false);
  });

  it("has no scale and no bars without an hour of counts: no data is not zero", () => {
    expect(graphOf([], HERO_UNITS)).toEqual({ scale: [], points: [] });
    // Hours that counted nobody are data: the base scale over empty bars.
    expect(graphOf(day(19, [0, 0, 0]), HERO_UNITS).scale).toEqual([
      { value: 2 },
      { value: 1 },
      { value: 0 },
    ]);
  });

  it("names the newest hour when none of its step falls among a few hours", () => {
    expect(graphOf(day(19, [5, 9, 7]), BOX_UNITS).points.map((p) => p.tick_text)).toEqual([
      undefined,
      undefined,
      "21:00",
    ]);
    expect(graphOf(day(19, [5, 9, 7, 4, 2]), BOX_UNITS).points.map((p) => p.tick_text)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      "23:00",
    ]);
  });

  it("names fewer hours the narrower its box, so the labels never meet", () => {
    const named = (units: number) =>
      graphOf(day(0, Array<number>(24).fill(10)), units).points.flatMap((p) => p.tick_text ?? []);
    expect(named(HERO_UNITS)).toEqual(["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]); // prettier-ignore
    expect(named(BOX_UNITS)).toEqual(["00:00", "06:00", "12:00", "18:00"]);
    // The Portrait hero, a whole 9:16 screen wide, names every third hour as the Pulse hero does.
    expect(named(100)).toHaveLength(8);
    // A box of 2 of 12 columns.
    expect(named((2 / 12) * (1600 / 9))).toEqual(["00:00", "12:00"]);
  });
});
