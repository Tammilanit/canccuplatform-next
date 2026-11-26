/** The plate check (plan issue-784 D5): whether a logo shows on the theme's grounds, and which plate helps. */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { logoAdvice, plateAdvice, rasterLogo } from "../src/logo-plate.js";
import type { Rgba } from "../src/logo-plate.js";

const DARK = { background: "#0b0d1a", surface: "#161a2e" };
const LIGHT = { background: "#f8fafc", surface: "#ffffff" };

/** A `size` px square, transparent, with `paint(x, y)` giving each pixel's RGBA or nothing. */
function image(size: number, paint: (x: number, y: number) => number[] | undefined): Rgba {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = paint(x, y);
      if (px !== undefined) data.set(px, (y * size + x) * 4);
    }
  }
  return { data, width: size, height: size };
}

const BLACK = [0, 0, 0, 255];
/** A black square glyph in the middle of a transparent box, as a dark logo with no ground. */
const blackGlyph = image(128, (x, y) =>
  x >= 32 && x < 96 && y >= 32 && y < 96 ? BLACK : undefined,
);

describe("plateAdvice", () => {
  it("finds a black logo lost on a dark ground and suggests the light plate", () => {
    expect(plateAdvice(blackGlyph, DARK)).toEqual({
      shows: { background: false, surface: false },
      suggest: "light",
    });
  });

  it("lets the same logo show on a light scheme with no plate", () => {
    expect(plateAdvice(blackGlyph, LIGHT)).toEqual({
      shows: { background: true, surface: true },
      suggest: null,
    });
  });

  it("counts a logo that is at least 98 % opaque as bringing its own ground", () => {
    // Black on black would vanish, but a 98 % opaque box draws its own ground around the mark.
    const boxed = image(100, (x, y) => (y === 0 && x < 2 ? undefined : BLACK));
    expect(plateAdvice(boxed, DARK)).toEqual({
      shows: { background: true, surface: true },
      suggest: null,
    });
  });

  it("does not count a 1-px ring, nearly all transparent, as showing on a dark ground", () => {
    const ring = image(128, (x, y) =>
      x === 0 || y === 0 || x === 127 || y === 127 ? BLACK : undefined,
    );
    expect(plateAdvice(ring, DARK).shows).toEqual({ background: false, surface: false });
    // Fewer opaque pixels than the check needs: no ground counts as showing it, nor as a match.
    const empty = image(128, () => undefined);
    expect(plateAdvice(empty, LIGHT)).toEqual({
      shows: { background: false, surface: false },
      suggest: "light",
    });
  });

  it("suggests the dark plate for a light logo on a light scheme", () => {
    const white = image(128, (x, y) =>
      x >= 32 && x < 96 && y >= 32 && y < 96 ? [255, 255, 255, 255] : undefined,
    );
    expect(plateAdvice(white, LIGHT)).toEqual({
      shows: { background: false, surface: false },
      suggest: "dark",
    });
  });

  it("tells the grounds apart, and suggests the first plate most of the logo reads on", () => {
    const grey = image(128, (x, y) =>
      x >= 32 && x < 96 && y >= 32 && y < 96 ? [90, 90, 90, 255] : undefined,
    );
    // Grey fails on a near-black background and reads on a pale surface; light comes first.
    const advice = plateAdvice(grey, { background: "#101010", surface: "#f0f0f0" });
    expect(advice.shows).toEqual({ background: false, surface: true });
    expect(advice.suggest).toBe("light");
    // 40 % white and 60 % black, 97 % of the box opaque: neither light nor dark reaches 80 %, a
    // mid-grey surface does.
    const split = image(100, (x, y) => (y < 3 ? undefined : x < 40 ? [255, 255, 255, 255] : BLACK));
    expect(plateAdvice(split, { background: "#101010", surface: "#777777" })).toEqual({
      shows: { background: false, surface: true },
      suggest: "surface",
    });
  });
});

describe("rasterLogo and logoAdvice", () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect x="100" y="50" width="200" height="100" fill="#000"/></svg>',
  );

  it("draws a logo at most 128 px wide with its alpha", async () => {
    const rgba = await rasterLogo(svg, "svg");
    expect(rgba.width).toBe(128);
    expect(rgba.height).toBe(64);
    expect(rgba.data.length).toBe(128 * 64 * 4);
  });

  it("answers from its cache without reading the file again", async () => {
    let reads = 0;
    const read = (): Promise<Buffer> => {
      reads += 1;
      return Promise.resolve(svg);
    };
    const name = `${"c".repeat(64)}.svg`;
    const first = await logoAdvice(read, name, DARK);
    const second = await logoAdvice(read, name, DARK);
    expect(first).toEqual({ shows: { background: false, surface: false }, suggest: "light" });
    expect(second).toEqual(first);
    expect(reads).toBe(1);
    // Other grounds are another question.
    await logoAdvice(read, name, LIGHT);
    expect(reads).toBe(2);
  });

  it("gives no advice for a file that is gone or cannot be drawn", async () => {
    const gone = await logoAdvice(() => Promise.resolve(undefined), `${"d".repeat(64)}.png`, DARK);
    expect(gone).toBeUndefined();
    const broken = await logoAdvice(
      () => Promise.resolve(Buffer.from("not an image")),
      `${"e".repeat(64)}.png`,
      DARK,
    );
    expect(broken).toBeUndefined();
  });

  it("reads a raster logo's real pixels", async () => {
    const big = image(256, (x, y) =>
      x >= 64 && x < 192 && y >= 64 && y < 192 ? BLACK : undefined,
    );
    const png = await sharp(Buffer.from(big.data), {
      raw: { width: 256, height: 256, channels: 4 },
    })
      .png()
      .toBuffer();
    const rgba = await rasterLogo(png, "png");
    expect(rgba.width).toBe(128);
    expect(plateAdvice(rgba, DARK).suggest).toBe("light");
  });
});
