// @vitest-environment happy-dom
import type { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { crowded, drawnWhole } from "./stack/dashboard.mjs";

const at = (left: number, right: number, top = 0, bottom = 100) => ({ left, right, top, bottom });

describe("crowded", () => {
  it("passes statistics on one line with a real gap between them", () => {
    expect(crowded([[at(0, 150), at(180, 300), at(330, 420)]], 11)).toEqual([]);
  });

  it("names a number that runs into the next one, as in equal columns", () => {
    expect(crowded([[at(0, 184), at(187, 350), at(380, 500)]], 11)).toEqual([
      "box 1, items 1 and 2: 3 px apart",
    ]);
  });

  it("names labels drawn over the next numbers, box by box", () => {
    const strip = [at(0, 295), at(190, 420), at(379, 568)];
    expect(crowded([strip, [at(0, 100)], strip], 11)).toEqual([
      "box 1, items 1 and 2: -105 px apart",
      "box 1, items 2 and 3: -41 px apart",
      "box 3, items 1 and 2: -105 px apart",
      "box 3, items 2 and 3: -41 px apart",
    ]);
  });

  it("lets a statistic wrapped to a line of its own sit under another", () => {
    expect(crowded([[at(0, 300), at(320, 500), at(0, 120, 110, 210)]], 11)).toEqual([]);
  });
});

const doc = (globalThis as unknown as Window).document;

/** A layout's regions as the player draws them; `rail` and `hero` hold the given widget classes. */
const drawn = (rail: string[], hero: string[] = [""]) => {
  const box = (role: string, widgets: string[]) =>
    `<div class="canccu-region canccu-region--${role}">${widgets.map((c) => `<div class="canccu-widget ${c}"><p>x</p></div>`).join("")}</div>`;
  doc.body.innerHTML = `<div class="canccu-layout">${box("hero", hero)}${box("rail", rail)}</div>`;
  return doc;
}; // prettier-ignore

/**
 * Stubs what happy-dom does not run: an element's animations, each with its iterations, all in
 * `playState`. `inside` ones run in its descendants, so only `getAnimations({ subtree: true })`
 * sees them.
 */
const animating = (sel: string, iterations: number[], inside = false, playState = "running") => {
  const el = doc.querySelector(sel) as unknown as { getAnimations: unknown };
  const list = iterations.map((n) => ({
    playState,
    effect: { getTiming: () => ({ iterations: n }) },
  }));
  el.getAnimations = (o?: { subtree?: boolean }) => (inside && o?.subtree !== true ? [] : list);
};

describe("drawnWhole", () => {
  it("passes a frame without regions", () => {
    doc.body.innerHTML = `<div class="canccu-frame canccu-frame--unassigned"></div>`;
    expect(drawnWhole(doc)).toBe(true);
  });

  it("passes a rail and a hero showing one widget each, with no fade running", () => {
    expect(drawnWhole(drawn(["canccu-is-active"]))).toBe(true);
  });

  it("waits while any region is mid-crossfade, not only the rail (#535)", () => {
    expect(drawnWhole(drawn([""], ["canccu-slot--out", "canccu-slot--in"]))).toBe(false);
    expect(drawnWhole(drawn(["canccu-slot--in"]))).toBe(false);
  });

  it("waits while the rail draws two widgets", () => {
    expect(drawnWhole(drawn(["", ""]))).toBe(false);
  });

  it("waits while anything inside the rail's widget animates, a motion-layer flap too", () => {
    drawn(["canccu-is-active"]);
    animating(".canccu-region--rail .canccu-widget", [1], true);
    expect(drawnWhole(doc)).toBe(false);
  });

  it("passes endless animations, a ticker's crawl or a spotlight's glow, which never end", () => {
    drawn(["canccu-is-active"]);
    animating(".canccu-region--rail .canccu-widget", [Infinity]);
    expect(drawnWhole(doc)).toBe(true);
  });

  it("passes a finished animation that holds its last frame, as a theme's `both` fill does", () => {
    drawn(["canccu-is-active"]);
    animating(".canccu-region--rail .canccu-widget", [1], true, "finished");
    expect(drawnWhole(doc)).toBe(true);
  });
});
