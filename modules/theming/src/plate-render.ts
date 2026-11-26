/**
 * The logo drawn on its plate for the images publish makes (plan issue-784 D4): the Discord PNG
 * and the hub's icons show the same plate the pages draw with the plate's custom properties, its
 * padding a share of the logo's drawn height and its corners the theme's radius.
 */
import sharp from "sharp";
import { render } from "./raster.js";
import type { RasterKind } from "./raster.js";

export interface Plating {
  /** `#rrggbb`: the plate is opaque. */
  color: string;
  shape: "rounded" | "circle";
  /** The padding as a share of the logo's drawn height. */
  padding: number;
  /** The corner radius as a share of the logo's drawn height (rounded only). */
  radius: number;
}

/** The header logo's height (ui.css, 1.75rem): the theme's radius is drawn against it. */
const HEADER_LOGO_PX = 28;
const REM_PX = 16;

/** The `radius` token as a share of the logo's height, as the header draws it. */
export function radiusShare(radius: string | undefined): number {
  const m = /^([0-9.]+)(px|rem|em)?$/.exec(radius ?? "");
  if (m === null) return 0;
  const px = Number(m[1]) * (m[2] === "px" || m[2] === undefined ? 1 : REM_PX);
  return px / HEADER_LOGO_PX;
}

const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/** The logo's height for each unit of its width, from a 512 px drawing. */
async function aspectOf(bytes: Buffer, ext: RasterKind | "svg"): Promise<number> {
  const { width, height } = await sharp(await render(bytes, ext, { width: 512 })).metadata();
  return height / width;
}

/** The logo width that fits with its padding in a `w` × `h` box, or in a circle `w` across. */
function logoWidth(a: number, p: Plating, w: number, h: number): number {
  const across = 1 + 2 * p.padding * a;
  const down = a * (1 + 2 * p.padding);
  return p.shape === "circle" ? w / Math.hypot(across, down) : Math.min(w / across, h / down);
}

interface Box {
  width: number;
  height: number;
}

/** The plate of `plate` size in the middle of `canvas`, the logo `lw` wide in its middle. */
async function compose(
  bytes: Buffer,
  ext: RasterKind | "svg",
  p: Plating,
  lw: number,
  canvas: Box,
  plate: Box,
  background?: string,
): Promise<Buffer> {
  const logo = await render(bytes, ext, { width: Math.max(1, Math.round(lw)) });
  const { width: w, height: h } = await sharp(logo).metadata();
  const [x, y] = [(canvas.width - plate.width) / 2, (canvas.height - plate.height) / 2];
  const shape =
    p.shape === "circle"
      ? `<circle cx="${canvas.width / 2}" cy="${canvas.height / 2}" r="${Math.min(plate.width, plate.height) / 2}"/>`
      : `<rect x="${x}" y="${y}" width="${plate.width}" height="${plate.height}" rx="${Math.min(p.radius * h, plate.width / 2, plate.height / 2)}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><g fill="${p.color}">${shape}</g></svg>`;
  return sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: background ?? CLEAR,
    },
  })
    .composite([
      { input: Buffer.from(svg), left: 0, top: 0 },
      {
        input: logo,
        left: Math.round((canvas.width - w) / 2),
        top: Math.round((canvas.height - h) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * The logo PNG on its plate, `width` wide like the plain one: a rounded plate as tall as the logo
 * and its padding, a circle as tall as it is wide.
 */
export async function platedLogo(
  bytes: Buffer,
  ext: RasterKind | "svg",
  p: Plating,
  width: number,
): Promise<Buffer> {
  const a = await aspectOf(bytes, ext);
  if (p.shape === "circle") {
    const box = { width, height: width };
    return compose(bytes, ext, p, logoWidth(a, p, width, width), box, box);
  }
  const lw = Math.round(width / (1 + 2 * p.padding * a));
  // As compose draws it: the height of the logo drawn `lw` wide, and its padding on both sides.
  const lh = Math.round(lw * a);
  const box = { width, height: lh + 2 * Math.round(p.padding * lh) };
  return compose(bytes, ext, p, lw, box, box);
}

/** A `size` px square icon with the plate, `side` px across, in its middle, on `background` or clear. */
export async function platedIcon(
  bytes: Buffer,
  ext: RasterKind | "svg",
  p: Plating,
  fit: { size: number; side: number; background?: string },
): Promise<Buffer> {
  const a = await aspectOf(bytes, ext);
  const plate = { width: fit.side, height: fit.side };
  return compose(
    bytes,
    ext,
    p,
    logoWidth(a, p, fit.side, fit.side),
    { width: fit.size, height: fit.size },
    plate,
    fit.background,
  );
}
