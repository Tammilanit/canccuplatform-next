import { describe, expect, it } from "vitest";
import { cutText, drawnParts, emptiestBand, opaqueShare, overlapping } from "./stack/clear.mjs";

const at = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe("overlapping", () => {
  it("names what a mark covers, as the corner mark covered the header's logo", () => {
    const mark = at(16, 16, 197, 88);
    expect(overlapping(mark, [at(48, 59, 184, 104), at(201, 60, 429, 103)])).toEqual([0]);
  });

  it("passes a band that only touches its neighbour, or sits in the margin above it", () => {
    expect(
      overlapping(at(903, 0, 1017, 34), [at(48, 59, 184, 104), at(1017, 0, 1100, 34)]),
    ).toEqual([]);
    expect(overlapping(at(0, 807, 1210, 879), [at(91, 879, 1210, 891)])).toEqual([]);
  });

  it("names a credit the rotation marks run through", () => {
    expect(overlapping(at(91, 913, 1210, 925), [at(49, 132, 1258, 948)])).toEqual([0]);
  });
});

// v8 rule 5 (#520): no empty band taller than a quarter of the large panel.
describe("emptiestBand", () => {
  const panel = at(49, 132, 1258, 948);
  const row = (top: number, bottom: number) => at(91, top, 600, bottom);

  it("measures the highlight without art: empty from its time down to the count", () => {
    const parts = [row(172, 210), row(230, 320), row(340, 400), row(800, 870), row(898, 906)];
    expect(emptiestBand(panel, parts)).toBeCloseTo(400 / 816, 3);
  });

  it("counts overlapping parts once and the panel's edges as empty", () => {
    expect(emptiestBand(panel, [row(132, 500), row(300, 700), row(690, 900)])).toBeCloseTo(
      48 / 816,
      3,
    );
    expect(emptiestBand(panel, [])).toBe(1);
  });

  it("clips parts to the panel, and passes a panel its band fills", () => {
    expect(emptiestBand(panel, [row(0, 560), row(560, 2000)])).toBe(0);
  });

  it("refuses a panel with no height, which would pass as no share at all (#528)", () => {
    expect(() => emptiestBand(at(49, 132, 1258, 132), [])).toThrow(/no height/);
    expect(() => emptiestBand(at(49, Number.NaN, 1258, 948), [])).toThrow(/no height/);
  });
});

// What panelFilled counts as drawn in the hero's box (#528).
describe("drawnParts", () => {
  const part = (classes: string[], over: Record<string, unknown> = {}) => ({
    extent: at(0, 100, 500, 300),
    classes,
    inArt: false,
    inFx: false,
    hidden: false,
    leaf: true,
    text: false,
    mask: "none",
    ...over,
  });

  it("counts text, leaves and the art bands, not a box that only holds others", () => {
    const parts = drawnParts([
      part(["canccu-widget__title"], { leaf: false, text: true }),
      part(["canccu-widget__band"], { leaf: false }),
      part(["canccu-widget__when"], { leaf: false }),
    ]);
    expect(parts).toHaveLength(2);
  });

  it("skips the motion layers over the box, the card's art and what is hidden", () => {
    expect(drawnParts([part(["canccu-fx-layer", "canccu-fx-layer--sweep"], { inFx: true })])).toEqual([]); // prettier-ignore
    expect(drawnParts([part(["canccu-widget__art"], { inArt: true })])).toEqual([]);
    expect(drawnParts([part(["canccu-widget__title"], { hidden: true })])).toEqual([]);
  });

  it("counts only the theme band's opaque part, above where its mask fades out", () => {
    const band = ["canccu-widget__band", "canccu-widget__band--theme"];
    const mask = "linear-gradient(rgb(0, 0, 0) 45%, rgba(0, 0, 0, 0))";
    expect(drawnParts([part(band, { leaf: false, mask })])).toEqual([at(0, 100, 500, 190)]);
    // A band with a class that only starts like it is not the art band.
    expect(drawnParts([part(["canccu-widget__band-name"], { leaf: false })])).toEqual([]);
  });
});

describe("opaqueShare", () => {
  it("reads how far down a top-to-bottom mask stays opaque", () => {
    expect(opaqueShare("none")).toBe(1);
    expect(opaqueShare("linear-gradient(rgb(0, 0, 0) 45%, rgba(0, 0, 0, 0))")).toBeCloseTo(0.45);
    expect(opaqueShare("linear-gradient(180deg, rgb(0, 0, 0) 60%, transparent)")).toBeCloseTo(0.6);
  });

  it("counts none of a band whose mask it cannot read, so a fade never passes as filled", () => {
    expect(opaqueShare("radial-gradient(rgb(0, 0, 0), transparent)")).toBe(0);
  });
});

// A showcase in a hero that does not grow shows its title and body whole (#528).
describe("cutText", () => {
  const box = at(49, 132, 680, 560);
  const text = (name: string, top: number, bottom: number, clipped = false) => ({
    name,
    extent: at(91, top, 640, bottom),
    scrollHeight: bottom - top + (clipped ? 40 : 8),
    clientHeight: bottom - top,
    fontSize: 40,
  });

  it("names a text that runs out of its box or is clamped short", () => {
    expect(cutText(box, [text("title", 200, 420), text("body", 430, 600)])).toEqual(["body"]);
    expect(cutText(box, [text("title", 200, 420, true), text("body", 430, 500)])).toEqual([
      "title",
    ]);
  });

  // Each text above overhangs its line box by 8 px, as a title at line height 1.05 does.
  it("passes texts drawn whole inside the box", () => {
    expect(cutText(box, [text("title", 200, 420), text("body", 430, 520)])).toEqual([]);
  });
});
