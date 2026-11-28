import { describe, expect, it, vi } from "vitest";
import { outsideBlock, timelineFits, touchingNext } from "./stack/timeline-fit.mjs";

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

describe("the coming hours' check on a page", () => {
  it("fails when the line never shows, as a check that looked at nothing", async () => {
    const page = {
      evaluate: vi.fn(),
      waitForSelector: vi.fn(() => Promise.reject(new Error("timeout"))),
    };
    await expect(timelineFits(page)).rejects.toThrow("never showed");
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  // A tick is 0 px wide, so a wait for a visible one never ends (#785).
  it("waits for the ticks to be there, not to be visible", async () => {
    const page = {
      evaluate: vi.fn(() => Promise.resolve(null)),
      waitForSelector: vi.fn(() => Promise.resolve()),
    };
    await expect(timelineFits(page)).rejects.toThrow("left the page");
    expect(page.waitForSelector).toHaveBeenCalledWith(expect.any(String), { state: "attached" });
  });
});
