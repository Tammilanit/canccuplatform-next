/** Colour suggestions (plan issue-784 D13): the logo's own colours and the matches of a colour. */
import { describe, expect, it } from "vitest";
import { logoPalette, matchesFor } from "../src/colour-match.js";
import { contrastRatio } from "../src/contrast.js";
import { oklch } from "../src/brand.js";

/** A 40 × 10 box: `stripes` side by side, each 10 px wide; `undefined` stays transparent. */
function stripes(colours: (number[] | undefined)[]): {
  data: Uint8Array;
  width: number;
  height: number;
} {
  const width = colours.length * 10;
  const data = new Uint8Array(width * 10 * 4);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < width; x++) {
      const c = colours[Math.floor(x / 10)];
      if (c !== undefined) data.set([...c, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height: 10 };
}

const HEX = /^#[0-9a-f]{6}$/;

describe("logoPalette", () => {
  it("gives the logo's colours, most used first, and ignores its transparent pixels", () => {
    const palette = logoPalette(
      stripes([[255, 0, 0], [255, 0, 0], [0, 0, 255], undefined, undefined, undefined]),
    );
    expect(palette).toEqual(["#ff0000", "#0000ff"]);
  });

  it("gives at most five colours, and none for a logo with no opaque pixel", () => {
    const many = stripes([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [0, 255, 255],
      [255, 0, 255],
      [0, 0, 0],
    ]);
    const palette = logoPalette(many);
    expect(palette.length).toBe(5);
    for (const c of palette) expect(c).toMatch(HEX);
    expect(logoPalette(stripes([undefined, undefined]))).toEqual([]);
  });
});

describe("matchesFor", () => {
  const hue = (hex: string): number => oklch(hex)[2];
  const turn = (a: number, b: number): number => ((((b - a) % 360) + 540) % 360) - 180;

  it("gives the analogous, complementary and split matches, each readable on the background", () => {
    const background = "#0b0d1a";
    const matches = matchesFor("#3b82f6", background);
    expect(matches).toHaveLength(5);
    const base = hue("#3b82f6");
    const turns = matches.map((m) => Math.round(turn(base, hue(m)) / 10) * 10);
    // Analogous -30 and +30, complementary 180, split 150 and -150; the shading keeps the hue
    // within a few degrees, which the rounding to tens absorbs.
    expect(turns.map((t) => Math.abs(t))).toEqual([30, 30, 180, 150, 150]);
    for (const m of matches) {
      expect(m).toMatch(HEX);
      expect(contrastRatio(m, background)).toBeGreaterThanOrEqual(3);
    }
  });

  it("shades the matches darker on a light background", () => {
    for (const m of matchesFor("#fde047", "#f8fafc")) {
      expect(contrastRatio(m, "#f8fafc")).toBeGreaterThanOrEqual(3);
    }
  });

  it("is deterministic", () => {
    expect(matchesFor("#f59e0b", "#0b0d1a")).toEqual(matchesFor("#f59e0b", "#0b0d1a"));
  });
});
