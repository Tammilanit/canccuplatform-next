// @vitest-environment happy-dom
/** The motion vocabulary on the screen (contracts/theming.md, Motion vocabulary). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionLayer, SPOTLIGHT_GAP_MS, spotlightParts, styleOf } from "../src/motion.js";
import type { Level } from "../src/motion.js";

const STYLE = styleOf(undefined);
const T0 = Date.parse("2026-06-01T20:00:00Z");

/** One region holding one shown box with the given inner HTML. */
function stage(inner: string, type = "stats"): { root: HTMLElement; box: HTMLElement } {
  const root = document.createElement("main");
  const region = document.createElement("div");
  region.className = "canccu-region";
  const box = document.createElement("div");
  box.className = `canccu-widget canccu-widget--${type} canccu-is-active`;
  box.innerHTML = inner;
  region.append(box);
  root.append(region);
  document.body.append(root);
  return { root, box };
}

describe("the motion layer", () => {
  let layer: MotionLayer;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.className = "canccu-surface--screen";
    document.body.replaceChildren();
    layer = new MotionLayer(document.body);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the level and the pack on <body>, one of each", () => {
    const { root } = stage("");
    layer.apply(root, "party", { ...STYLE, pack: "arcade" }, T0);
    expect([...document.body.classList]).toEqual([
      "canccu-surface--screen",
      "canccu-motion--party",
      "canccu-motion-pack--arcade",
    ]);
    layer.apply(root, "calm", STYLE, T0);
    expect([...document.body.classList].sort()).toEqual([
      "canccu-motion--calm",
      "canccu-motion-pack--standard",
      "canccu-surface--screen",
    ]);
  });

  it("rolls a changed number and flaps a changed time, never on the first draw", () => {
    const { root, box } = stage("<b>12</b><span>19:30</span><i>Players</i>");
    layer.apply(root, "calm", STYLE, T0);
    expect(box.querySelector(".canccu-fx")).toBeNull();
    box.innerHTML = "<b>13</b><span>19:45</span><i>Players</i>";
    layer.apply(root, "calm", STYLE, T0 + 1000);
    expect(box.querySelector("b")?.className).toBe("canccu-fx canccu-fx--roll");
    expect(box.querySelector("span")?.className).toBe("canccu-fx canccu-fx--flap");
    expect(box.querySelector("i")?.className).toBe("");
    vi.advanceTimersByTime(700);
    expect(box.querySelector("b")?.className).toBe("");
  });

  it("plays nothing at none, nor on a clock, nor on a running countdown", () => {
    const { root, box } = stage("<b>12</b>");
    layer.apply(root, "none", STYLE, T0);
    box.innerHTML = "<b>13</b>";
    layer.apply(root, "none", STYLE, T0 + 1000);
    expect(box.querySelector(".canccu-fx")).toBeNull();
    const clock = stage("<b>20:00</b>", "clock");
    layer.apply(clock.root, "party", STYLE, T0);
    clock.box.innerHTML = "<b>20:01</b>";
    layer.apply(clock.root, "party", STYLE, T0 + 60_000);
    expect(clock.box.querySelector(".canccu-fx")).toBeNull();
  });

  it("sweeps a changed box at lively, one spotlight every 10 seconds, the next waiting its turn", () => {
    const a = stage("<b>1</b>");
    const b = stage("<b>1</b>");
    const root = document.body;
    layer.apply(root, "lively", STYLE, T0);
    a.box.innerHTML = "<b>2</b>";
    layer.apply(root, "lively", STYLE, T0 + 1000);
    expect(a.box.querySelector(".canccu-fx-layer--sweep")).not.toBeNull();
    b.box.innerHTML = "<b>2</b>";
    layer.apply(root, "lively", STYLE, T0 + 2000);
    expect(b.box.querySelector(".canccu-fx-layer--sweep")).toBeNull();
    layer.apply(root, "lively", STYLE, T0 + 1000 + SPOTLIGHT_GAP_MS);
    expect(b.box.querySelector(".canccu-fx-layer--sweep")).not.toBeNull();
    // No sweep at calm: only the values change.
    const c = stage("<b>1</b>");
    layer.apply(root, "calm", STYLE, T0 + 60_000);
    c.box.innerHTML = "<b>5</b>";
    layer.apply(root, "calm", STYLE, T0 + 80_000);
    expect(c.box.querySelector(".canccu-fx-layer--sweep")).toBeNull();
  });

  it("adds a pop or a tilt after the sweep at party", () => {
    const { root, box } = stage("<b>1</b>");
    layer.apply(root, "party", STYLE, T0);
    box.innerHTML = "<b>2</b>";
    layer.apply(root, "party", STYLE, T0 + 1000);
    expect(box.classList.contains("canccu-fx--pop")).toBe(true);
  });

  const countdown = (startsIn: number) =>
    `<p>Final</p><time datetime="${new Date(T0 + startsIn).toISOString()}" data-canccu-countdown>00:04:00</time>`;

  it("spotlights the countdown in its last five minutes, as the level draws it", () => {
    const level = (l: Level, startsIn: number) => {
      document.body.replaceChildren();
      layer = new MotionLayer(document.body);
      const { root, box } = stage(countdown(startsIn), "countdown");
      layer.apply(root, l, STYLE, T0);
      return [...box.classList].filter((c) => c.startsWith("canccu-spotlight")).sort();
    };
    expect(level("lively", 6 * 60_000)).toEqual([]);
    expect(level("none", 4 * 60_000)).toEqual(["canccu-spotlight", "canccu-spotlight--outline"]);
    expect(level("calm", 4 * 60_000)).toEqual(["canccu-spotlight", "canccu-spotlight--outline"]);
    expect(level("lively", 4 * 60_000)).toEqual([
      "canccu-spotlight",
      "canccu-spotlight--glow",
      "canccu-spotlight--trace",
    ]);
    expect(level("party", 4 * 60_000)).toContain("canccu-spotlight--burst");
    expect(document.querySelector(".canccu-fx-layer--burst")).not.toBeNull();
  });

  it("ends the spotlight at the start, and holds sweeps back while it lasts", () => {
    const cd = stage(countdown(4 * 60_000), "countdown");
    const other = stage("<b>1</b>");
    layer.apply(document.body, "lively", STYLE, T0);
    other.box.innerHTML = "<b>2</b>";
    layer.apply(document.body, "lively", STYLE, T0 + 20_000);
    expect(other.box.querySelector(".canccu-fx-layer--sweep")).toBeNull();
    layer.apply(document.body, "lively", STYLE, T0 + 4 * 60_000);
    expect(cd.box.classList.contains("canccu-spotlight")).toBe(false);
    expect(other.box.querySelector(".canccu-fx-layer--sweep")).not.toBeNull();
  });

  it("picks the lively spotlight from the theme", () => {
    expect(spotlightParts("lively", { ...STYLE, spotlight: "glow" })).toEqual(["glow"]);
    expect(spotlightParts("party", { ...STYLE, spotlight: "trace" })).toEqual([
      "trace",
      "pop",
      "burst",
    ]);
    expect(styleOf({ speed: "faster", pack: "wild" })).toEqual({ ...STYLE, speed: "faster" });
  });
});
