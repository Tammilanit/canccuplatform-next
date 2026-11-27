// @vitest-environment happy-dom
/**
 * What the hype moves on a screen (#787 D11, D13): the soft glow on a box that just changed, the
 * effects the hype lets through within the level, and the level that changes only at a turn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { motionStyleOf } from "@canccu/ui";
import { CHANGE_FADE_MS, CHANGE_HOLD_MS } from "../src/change-glow.js";
import { LevelGate } from "../src/level-gate.js";
import { MotionLayer, SPOTLIGHT_GAP_MS } from "../src/motion.js";
import type { Level } from "../src/motion.js";

const STYLE = motionStyleOf(undefined);
const T0 = Date.parse("2026-06-01T20:00:00Z");

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

describe("the change glow", () => {
  let layer: MotionLayer;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    layer = new MotionLayer(document.body);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const glow = (box: HTMLElement) =>
    box.classList.contains("canccu-changed")
      ? Number(box.style.getPropertyValue("--canccu-changed"))
      : 0;

  for (const level of ["none", "calm", "lively", "party"] as Level[]) {
    it(`holds on a changed box for the hold time and fades over 10 s, at ${level}`, () => {
      const { root, box } = stage("<b>12</b>");
      layer.apply(root, level, STYLE, T0);
      expect(glow(box)).toBe(0);
      box.innerHTML = "<b>13</b>";
      layer.apply(root, level, STYLE, T0 + 1000);
      expect(glow(box)).toBe(1);
      layer.apply(root, level, STYLE, T0 + 1000 + CHANGE_HOLD_MS);
      expect(glow(box)).toBe(1);
      layer.apply(root, level, STYLE, T0 + 1000 + CHANGE_HOLD_MS + CHANGE_FADE_MS / 2);
      expect(glow(box)).toBeCloseTo(0.5, 2);
      layer.apply(root, level, STYLE, T0 + 1000 + CHANGE_HOLD_MS + CHANGE_FADE_MS);
      expect(box.classList.contains("canccu-changed")).toBe(false);
    });
  }

  it("comes back after a redraw in place resets the box's classes", () => {
    const { root, box } = stage("<b>12</b>");
    layer.apply(root, "calm", STYLE, T0);
    box.innerHTML = "<b>13</b>";
    layer.apply(root, "calm", STYLE, T0 + 1000);
    box.className = "canccu-widget canccu-widget--stats canccu-is-active";
    layer.apply(root, "calm", STYLE, T0 + 2000);
    expect(box.classList.contains("canccu-changed")).toBe(true);
  });

  it("never glows on the first draw or on a clock", () => {
    const { root, box } = stage("<b>19:30</b>", "clock");
    layer.apply(root, "lively", STYLE, T0);
    box.innerHTML = "<b>19:31</b>";
    layer.apply(root, "lively", STYLE, T0 + 60_000);
    expect(box.classList.contains("canccu-changed")).toBe(false);
  });
});

describe("the effects the hype lets through", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The effect layers and moves a change plays on a box at party, with the hype's phase. */
  function played(phase: string | undefined): string[] {
    const layer = new MotionLayer(document.body);
    const { root, box } = stage("<b>12</b><i>Players</i>");
    layer.apply(root, "party", STYLE, T0, phase);
    box.innerHTML = "<b>13</b><i>Players</i>";
    layer.apply(root, "party", STYLE, T0 + SPOTLIGHT_GAP_MS, phase);
    const fx = [...box.querySelectorAll(".canccu-fx-layer")].map((e) => e.className);
    const moves = ["canccu-fx--pop", "canccu-fx--tilt"].filter((c) => box.classList.contains(c));
    const rolls = box.querySelectorAll("b.canccu-fx--roll").length;
    root.remove();
    return [...fx, ...moves, ...(rolls > 0 ? ["roll"] : [])];
  }

  it("rolls numbers when quiet, adds the sweep while building, and the pop while live", () => {
    expect(played("quiet")).toEqual(["roll"]);
    expect(played("after")).toEqual(["roll"]);
    expect(played("building")).toEqual(["canccu-fx-layer canccu-fx-layer--sweep", "roll"]);
    expect(played("live")).toEqual([
      "canccu-fx-layer canccu-fx-layer--sweep",
      "canccu-fx--pop",
      "roll",
    ]);
    // A server that sends no hype: the level alone decides, as before.
    expect(played(undefined)).toEqual(played("live"));
  });
});

describe("the level gate", () => {
  it("takes the first level at once", () => {
    expect(new LevelGate().level("party", "0", T0)).toBe("party");
  });

  it("holds a new level until the hero's next turn", () => {
    const gate = new LevelGate();
    gate.level("calm", "3", T0);
    expect(gate.level("lively", "3", T0 + 1000)).toBe("calm");
    expect(gate.level("lively", "3", T0 + 20_000)).toBe("calm");
    expect(gate.level("lively", "4", T0 + 45_000)).toBe("lively");
  });

  it("follows a level that moves back before the turn, and waits at most one turn's length", () => {
    const gate = new LevelGate();
    gate.level("calm", "3", T0);
    gate.level("lively", "3", T0 + 1000);
    expect(gate.level("calm", "3", T0 + 2000)).toBe("calm");
    gate.level("party", null, T0 + 3000);
    expect(gate.level("party", null, T0 + 3000 + 59_000)).toBe("calm");
    expect(gate.level("party", null, T0 + 3000 + 60_000)).toBe("party");
  });

  it("goes to none at once, and back from it at once", () => {
    const gate = new LevelGate();
    gate.level("party", "1", T0);
    expect(gate.level("none", "1", T0 + 1000)).toBe("none");
    expect(gate.level("lively", "1", T0 + 2000)).toBe("lively");
  });
});
