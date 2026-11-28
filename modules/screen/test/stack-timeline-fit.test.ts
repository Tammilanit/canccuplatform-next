import { describe, expect, it, vi } from "vitest";
import {
  outsideBlock,
  timelineComposed,
  timelineFits,
  touchingNext,
} from "./stack/timeline-fit.mjs";

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

const line = (empty = false) => ({ widget: "agenda_timeline", view: { empty } });
const hero = (widgets: object[], order: number[]) => ({ role: "hero", widgets, order });
const stats = { widget: "stats", view: { empty: false } };

/** A page that answers the state fetch with `state`; its wait for the turn fails, as an unseen box does. */
function pageWith(state: unknown) {
  return {
    evaluate: vi.fn(() => Promise.resolve(state)),
    waitForSelector: vi.fn(() => Promise.reject(new Error("timeout"))),
  };
}

describe("whether compose gave the coming hours a turn", () => {
  it("finds the coming hours in a hero's order", () => {
    expect(timelineComposed({ regions: [hero([stats, line()], [0, 1])] })).toBe(true);
  });

  it("finds none in an empty window, out of the order, or outside a hero", () => {
    expect(timelineComposed({ regions: [hero([stats, line(true)], [0, 1])] })).toBe(false);
    expect(timelineComposed({ regions: [hero([stats, line()], [0])] })).toBe(false);
    expect(timelineComposed({ regions: [{ ...hero([line()], [0]), role: "rail" }] })).toBe(false);
    expect(timelineComposed({ regions: [] })).toBe(false);
  });
});

describe("the coming hours' check on a page", () => {
  it("skips at once, without waiting, when compose sent no timeline", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const page = pageWith({ regions: [hero([stats, line(true)], [0])] });
    await expect(timelineFits(page)).resolves.toBeUndefined();
    expect(page.waitForSelector).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("no timeline composed");
    log.mockRestore();
  });

  it("waits for a composed timeline's turn and fails when it never shows", async () => {
    const page = pageWith({ regions: [hero([stats, line()], [0, 1])] });
    await expect(timelineFits(page)).rejects.toThrow("never showed");
    expect(page.waitForSelector).toHaveBeenCalledOnce();
  });

  it("fails when the state cannot be read", async () => {
    await expect(timelineFits(pageWith(null))).rejects.toThrow("could not be read");
  });
});
