import { describe, expect, it } from "vitest";
import { outsideBlock, touchingNext } from "./stack/timeline-fit.mjs";

const box = (left: number, right: number, top = 0, bottom = 10) => ({ left, right, top, bottom });

describe("the coming hours' fit check", () => {
  it("finds times that touch, and lets apart ones be", () => {
    expect(touchingNext([box(0, 50), box(60, 110)])).toEqual([]);
    expect(touchingNext([box(60, 130), box(0, 61)])).toEqual([1]);
  });

  it("finds a label that leaves its block on any side, and keeps one inside", () => {
    const block = box(100, 300, 0, 100);
    const pairs = [
      { name: "inside", block, text: box(110, 290, 5, 90) },
      { name: "past the right edge", block, text: box(110, 340, 5, 90) },
      { name: "past the left edge", block, text: box(60, 200, 5, 90) },
      { name: "below", block, text: box(110, 200, 5, 140) },
    ];
    expect(outsideBlock(pairs)).toEqual(["past the right edge", "past the left edge", "below"]);
  });
});
