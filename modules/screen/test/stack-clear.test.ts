import { describe, expect, it } from "vitest";
import { overlapping } from "./stack/clear.mjs";

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
