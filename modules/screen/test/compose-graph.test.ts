import { describe, expect, it } from "vitest";
import { graphOf, scaleOf } from "../src/compose/graph.js";

// The bar graphs' value scale and hour labels (#523; contracts/screen.md, Widgets).
describe("a graph's value scale", () => {
  it("steps by a round number, from the top down to 0, with two or three lines over the base", () => {
    expect(scaleOf(231)).toEqual([300, 200, 100, 0]);
    expect(scaleOf(110)).toEqual([150, 100, 50, 0]);
    expect(scaleOf(61)).toEqual([75, 50, 25, 0]);
    expect(scaleOf(7)).toEqual([10, 5, 0]);
    expect(scaleOf(200)).toEqual([200, 100, 0]);
  });

  it("keeps whole numbers and two lines for a handful of people or none", () => {
    expect(scaleOf(3)).toEqual([3, 2, 1, 0]);
    expect(scaleOf(1)).toEqual([2, 1, 0]);
    expect(scaleOf(0)).toEqual([2, 1, 0]);
  });
});

describe("a graph's bars and hours", () => {
  const hours = [
    { time_text: "17:00", value: 40 },
    { time_text: "18:00", value: 231 },
    { time_text: "19:00", value: 150 },
    { time_text: "21:00", value: 0 },
  ];

  it("scales each bar against the scale's top, not the highest hour", () => {
    const graph = graphOf(hours, 6);
    expect(graph.scale).toEqual([{ value: 300 }, { value: 200 }, { value: 100 }, { value: 0 }]);
    expect(graph.points.map((p) => p.level)).toEqual([1, 8, 5, 0]);
  });

  it("labels the hours on its step, and only those", () => {
    expect(graphOf(hours, 6).points.map((p) => p.tick_text)).toEqual([
      undefined,
      "18:00",
      undefined,
      undefined,
    ]);
    expect(graphOf(hours, 3).points.map((p) => p.tick_text)).toEqual([
      undefined,
      "18:00",
      undefined,
      "21:00",
    ]);
    // An absent label, never an undefined one: the fingerprint and the player read the same JSON.
    expect("tick_text" in (graphOf(hours, 6).points[0] ?? {})).toBe(false);
  });
});
