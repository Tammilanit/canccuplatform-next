// The readability check of the CI screenshots (#191, L7): its rules on samples the browser
// collects, held here without a stack or a browser.
import { describe, expect, it } from "vitest";
import { contrast, grounds, judge, parseColors } from "./stack/readability.mjs";
import type { Sample } from "./stack/readability.mjs";

const WHITE = [255, 255, 255, 1];
const BLACK = [0, 0, 0, 1];
const tokens = { primary: [59, 130, 246, 1], accent: [245, 158, 11, 1] };
const viewport = { width: 1920, height: 1080 };

function sample(over: Partial<Sample> = {}): Sample {
  return {
    text: "Dinner",
    where: "main > p",
    fontPx: 40,
    color: [248, 250, 252, 1],
    layers: [{ color: [15, 23, 42, 1], stops: [] }],
    ...over,
  };
}

describe("the readability check", () => {
  it("reads the colours a browser computes, in rgb() and color(srgb)", () => {
    expect(parseColors("rgb(15, 23, 42)")).toEqual([[15, 23, 42, 1]]);
    expect(parseColors("linear-gradient(rgba(0, 0, 0, 0.5), color(srgb 1 0.5 0 / 0.25))")).toEqual([
      [0, 0, 0, 0.5],
      [255, 127.5, 0, 0.25],
    ]);
    expect(parseColors("none")).toEqual([]);
  });

  it("measures contrast as WCAG does", () => {
    expect(contrast(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrast([118, 118, 118, 1], WHITE)).toBeCloseTo(4.54, 2);
  });

  it("lays a see-through ground over the one below it, and takes every stop of a gradient", () => {
    const layers = [
      { color: [0, 0, 0, 1], stops: [] },
      { color: [255, 255, 255, 0.5], stops: [[255, 0, 0, 1], [0, 0, 0, 0]] },
    ]; // prettier-ignore
    expect(grounds(layers)).toEqual([
      [127.5, 127.5, 127.5, 1],
      [255, 0, 0, 1],
    ]);
  });

  it("passes large, clear text", () => {
    expect(judge([sample()], viewport, tokens)).toEqual([]);
  });

  it("fails text under 2.5 % of the screen's short side", () => {
    const small = judge([sample({ fontPx: 26 })], viewport, tokens);
    expect(small).toHaveLength(1);
    expect(small[0]).toContain("26 px, under 27 px");
    // A portrait screen is the same panel turned: the same letters read alike.
    expect(judge([sample({ fontPx: 28 })], { width: 1080, height: 1920 }, tokens)).toEqual([]);
    expect(judge([sample({ fontPx: 50 })], { width: 3840, height: 2160 }, tokens)).toHaveLength(1);
  });

  it("holds text to 4.5:1 on its every ground, and the theme's accent colours to 3:1", () => {
    const muted = sample({ color: [100, 100, 100, 1] });
    expect(judge([muted], viewport, tokens)[0]).toMatch(/contrast 3\.\d+:1, under 4\.5:1/);
    const kicker = sample({ color: tokens.primary });
    expect(judge([kicker], viewport, tokens)).toEqual([]);
    const onGradient = sample({
      layers: [{ color: [15, 23, 42, 1], stops: [[15, 23, 42, 1], [200, 200, 200, 1]] }],
    }); // prettier-ignore
    expect(judge([onGradient], viewport, tokens)[0]).toContain("contrast");
  });

  it("fails text the box around it cuts off", () => {
    const [problem] = judge([sample({ text: "Demo Game Cup, semis", clipped: true })], viewport, tokens); // prettier-ignore
    expect(problem).toContain('"Demo Game Cup, semis"');
    expect(problem).toContain("cut off");
    expect(judge([sample({ clipped: false })], viewport, tokens)).toEqual([]);
  });

  it("names the text and where it is", () => {
    const [problem] = judge([sample({ text: "Wi-Fi", where: "section.canccu-region--venue_rail > p", fontPx: 12 })], viewport, tokens); // prettier-ignore
    expect(problem).toContain('"Wi-Fi"');
    expect(problem).toContain("section.canccu-region--venue_rail > p");
  });
});
