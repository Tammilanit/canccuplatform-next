import { describe, expect, it } from "vitest";
import {
  SCRIM_FROM,
  VEIL_FROM,
  contrast,
  leastOpacity,
  parseHex,
  scrimOf,
  themeColors,
  veilOf,
} from "../src/stage/scrim.js";
import type { Rgb } from "../src/stage/scrim.js";

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const MID: Rgb = [128, 128, 128];

describe("the scrim and the veil", () => {
  it("reads the theme's hex colours, and falls back to the platform's", () => {
    expect(parseHex("#0f172a")).toEqual([15, 23, 42, 1]);
    expect(parseHex("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseHex("#ffffff80")).toEqual([255, 255, 255, 128 / 255]);
    expect(parseHex("rgb(1,2,3)")).toBeNull();
    expect(themeColors(undefined)).toEqual({
      background: [15, 23, 42, 1],
      surface: [30, 41, 59, 1],
      text: [248, 250, 252, 1],
    });
    expect(themeColors({ colors: { background: "#ffffff", text: "#111" } }).background).toEqual([
      ...WHITE,
      1,
    ]);
  });

  it("measures contrast as WCAG does", () => {
    expect(contrast(WHITE, BLACK)).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it("keeps the lower bound for art the text already reads on", () => {
    // Dark art under light text: the scrim's least step holds.
    expect(leastOpacity(BLACK, WHITE, { light: [40, 40, 40], dark: BLACK }, SCRIM_FROM)).toBe(0.55);
    expect(leastOpacity(BLACK, WHITE, { light: [40, 40, 40], dark: BLACK }, VEIL_FROM)).toBe(0.5);
  });

  it("raises the opacity in steps of 0.05 until the theme's text reads over light art", () => {
    const { background, text } = themeColors(undefined);
    const art = { light: WHITE, dark: BLACK };
    const a = leastOpacity(background, text, art, SCRIM_FROM);
    expect(a).toBeGreaterThan(0.55);
    expect(a).toBeLessThan(1);
    expect(Math.round(a * 100) % 5).toBe(0);
    // One step less does not read over the art's lightest colour.
    const under = background.map((c) => c * (a - 0.05) + 255 * (1.05 - a)) as unknown as Rgb;
    expect(contrast(text, under)).toBeLessThan(4.5);
  });

  it("gives 1 when no step of a ground reads, which covers the art whole", () => {
    // A mid-grey ground under white text never reaches 4.5:1, whatever its opacity.
    expect(leastOpacity(MID, WHITE, { light: WHITE, dark: BLACK }, SCRIM_FROM)).toBe(1);
  });

  it("works for a light theme too: dark text over dark art", () => {
    const light = themeColors({
      colors: { background: "#ffffff", surface: "#f1f5f9", text: "#0f172a" },
    });
    const art = { light: WHITE, dark: BLACK };
    const scrim = scrimOf(light, art);
    const veil = veilOf(light, art);
    expect(scrim).toBeGreaterThanOrEqual(0.55);
    expect(scrim).toBeLessThanOrEqual(1);
    expect(veil).toBeGreaterThanOrEqual(0.5);
    expect(veil).toBeLessThanOrEqual(1);
    expect(scrimOf(light, { light: WHITE, dark: [230, 230, 230] })).toBe(0.55);
  });

  it("reads a theme's #rrggbbaa colours with their alpha, not as the platform's", () => {
    // A light theme written with 8-digit tokens: its own colours, not the dark defaults.
    const light = themeColors({
      colors: { background: "#ffffffff", surface: "#f1f5f9ff", text: "#0f172aff" },
    });
    expect(light.background).toEqual([...WHITE, 1]);
    expect(light.text).toEqual([15, 23, 42, 1]);
    const art = { light: WHITE, dark: BLACK };
    expect(scrimOf(light, art)).toBe(
      scrimOf(themeColors({ colors: { background: "#ffffff", text: "#0f172a" } }), art),
    );
    // Light art under dark text needs no more than the least step; the dark defaults would.
    expect(scrimOf(light, { light: WHITE, dark: [230, 230, 230] })).toBe(0.55);
    expect(
      scrimOf(themeColors(undefined), { light: WHITE, dark: [230, 230, 230] }),
    ).toBeGreaterThan(0.55);
  });

  it("covers more with a translucent ground, and holds for translucent text", () => {
    const art = { light: WHITE, dark: BLACK };
    const opaque = leastOpacity([0, 0, 0, 1], [255, 255, 255, 1], art, SCRIM_FROM);
    const half = leastOpacity([0, 0, 0, 0.8], [255, 255, 255, 1], art, SCRIM_FROM);
    expect(half).toBeGreaterThan(opaque);
    // The step found keeps 4.5:1 for the text as drawn: its alpha over the composited ground.
    const text = [255, 255, 255, 0.9] as const;
    const a = leastOpacity([0, 0, 0, 1], text, art, SCRIM_FROM);
    const under = WHITE.map((c) => c * (1 - a)) as unknown as Rgb;
    const drawn = under.map((c) => 255 * 0.9 + c * 0.1) as unknown as Rgb;
    expect(contrast(drawn, under)).toBeGreaterThanOrEqual(4.5);
    expect(a).toBeGreaterThan(opaque);
  });
});
