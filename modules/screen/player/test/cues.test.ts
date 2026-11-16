// @vitest-environment happy-dom
/**
 * A cue's picture on a claimed box (contracts/screen.md, Cue effects; L7, L8): the effect's move,
 * then a frame and glow that hold and fade, timed from the claim's start, so every screen of a zone
 * and a reloaded one show the same moment of it.
 */
import { describe, expect, it } from "vitest";
import { applyCue } from "../src/cues.js";

const START = Date.parse("2026-01-01T20:00:00Z");
const claim = (effect: unknown) => ({ starts_at: new Date(START).toISOString(), effect });
const RIPPLE = { name: "ripple", hold_seconds: 90, fade_seconds: 10 };

describe("a cue on a claimed box", () => {
  it("names the effect and how far into it the box is", () => {
    const el = document.createElement("div");
    applyCue(el, claim(RIPPLE), START + 30_000);
    expect([...el.classList]).toEqual(["canccu-cue", "canccu-cue--ripple"]);
    expect(el.style.getPropertyValue("--canccu-cue-delay")).toBe("-30s");
    expect(el.style.getPropertyValue("--canccu-cue-hold")).toBe("90s");
    expect(el.style.getPropertyValue("--canccu-cue-fade")).toBe("10s");
  });

  it("leaves the box once the hold and the fade are over", () => {
    const el = document.createElement("div");
    applyCue(el, claim(RIPPLE), START + 30_000);
    applyCue(el, claim(RIPPLE), START + 100_000);
    expect(el.classList.length).toBe(0);
    expect(el.style.getPropertyValue("--canccu-cue-delay")).toBe("");
  });

  it("draws nothing for a claim without an effect, or an effect this player does not know", () => {
    const el = document.createElement("div");
    applyCue(el, claim(undefined), START);
    applyCue(el, claim({ name: "spin", hold_seconds: 60, fade_seconds: 10 }), START);
    expect(el.classList.length).toBe(0);
  });

  it("a new claim's effect replaces the last one's", () => {
    const el = document.createElement("div");
    applyCue(el, claim(RIPPLE), START);
    applyCue(el, claim({ name: "pop", hold_seconds: 60, fade_seconds: 10 }), START + 1000);
    expect([...el.classList]).toEqual(["canccu-cue", "canccu-cue--pop"]);
  });

  it("leaves a running cue alone on every redraw, so its animation never jumps", () => {
    const el = document.createElement("div");
    applyCue(el, claim(RIPPLE), START + 30_000);
    applyCue(el, claim(RIPPLE), START + 31_000);
    expect(el.style.getPropertyValue("--canccu-cue-delay")).toBe("-30s");
  });

  it("keeps the box's own classes", () => {
    const el = document.createElement("div");
    el.className = "canccu-region canccu-region--rail";
    applyCue(el, claim(RIPPLE), START);
    applyCue(el, null, START);
    expect(el.className).toBe("canccu-region canccu-region--rail");
  });
});
