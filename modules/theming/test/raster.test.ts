/** `render`: an SVG drawn at the density its target needs, whatever its proportions. */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { render } from "../src/raster.js";

const svg = (w: number, h: number, body = `<rect width="${w}" height="${h}" fill="#f00"/>`) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  );

const LOGO = { width: 512 };
const ICON = { size: 192, inner: 192 };
const MASKABLE = { size: 512, inner: 288, background: "#000000" };

async function size(png: Buffer): Promise<[number, number]> {
  const meta = await sharp(png).metadata();
  return [meta.width, meta.height];
}

describe("render", () => {
  it("draws a tall SVG logo at its target width rather than scaling it up", async () => {
    // An edge off the pixel grid: drawn at 512 px wide one column is partly covered; drawn at
    // 128 px and scaled up four times the edge blurs across several.
    const tall = svg(100, 400, '<rect width="50.5" height="400" fill="#000"/>');
    const png = await render(tall, "svg", LOGO);
    expect(await size(png)).toEqual([512, 2048]);
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const row = Array.from({ length: info.width }, (_, x) => data[(1000 * info.width + x) * 4 + 3]);
    expect(row.filter((a) => a !== 0 && a !== 255)).toHaveLength(1);
  });

  it.each([
    ["a wide sliver", 5000, 1],
    ["a tall sliver", 1, 5000],
  ])("renders %s of an SVG for the logo and every icon", async (_, w, h) => {
    const input = svg(w, h);
    const logo = await size(await render(input, "svg", LOGO));
    expect(logo[0]).toBeLessThanOrEqual(512);
    expect(logo[1]).toBeLessThanOrEqual(2048);
    expect(await size(await render(input, "svg", ICON))).toEqual([192, 192]);
    expect(await size(await render(input, "svg", MASKABLE))).toEqual([512, 512]);
  });

  it("rejects an SVG too thin to draw at all, for the caller to treat as no image", async () => {
    await expect(render(svg(100_000, 1), "svg", LOGO)).rejects.toThrow();
  });
});
