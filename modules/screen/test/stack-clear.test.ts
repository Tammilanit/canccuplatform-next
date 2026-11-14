import { describe, expect, it } from "vitest";
import { emptiestBand, overlapping } from "./stack/clear.mjs";

const at = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe("overlapping", () => {
  it("names what a mark covers, as the corner mark covered the header's logo", () => {
    const mark = at(16, 16, 197, 88);
    expect(overlapping(mark, [at(48, 59, 184, 104), at(201, 60, 429, 103)])).toEqual([0]);
  });

  it("passes a band that only touches its neighbour, or sits in the margin above it", () => {
    expect(
      overlapping(at(903, 0, 1017, 34), [at(48, 59, 184, 104), at(1017, 0, 1100, 34)]),
    ).toEqual([]);
    expect(overlapping(at(0, 807, 1210, 879), [at(91, 879, 1210, 891)])).toEqual([]);
  });

  it("names a credit the rotation marks run through", () => {
    expect(overlapping(at(91, 913, 1210, 925), [at(49, 132, 1258, 948)])).toEqual([0]);
  });
});

// v8 rule 5 (#520): no empty band taller than a quarter of the large panel.
describe("emptiestBand", () => {
  const panel = at(49, 132, 1258, 948);
  const row = (top: number, bottom: number) => at(91, top, 600, bottom);

  it("measures the highlight without art: empty from its time down to the count", () => {
    const parts = [row(172, 210), row(230, 320), row(340, 400), row(800, 870), row(898, 906)];
    expect(emptiestBand(panel, parts)).toBeCloseTo(400 / 816, 3);
  });

  it("counts overlapping parts once and the panel's edges as empty", () => {
    expect(emptiestBand(panel, [row(132, 500), row(300, 700), row(690, 900)])).toBeCloseTo(
      48 / 816,
      3,
    );
    expect(emptiestBand(panel, [])).toBe(1);
  });

  it("clips parts to the panel, and passes a panel its band fills", () => {
    expect(emptiestBand(panel, [row(0, 560), row(560, 2000)])).toBe(0);
  });
});
