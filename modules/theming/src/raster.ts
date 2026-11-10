/**
 * PNG, JPEG and WebP (contracts/theming.md, Raster images and fonts): decoded and stored
 * re-encoded, so nothing of the upload but its pixels reaches the volume: metadata such as camera
 * and GPS data, and whatever a polyglot hides around or inside the image, are dropped.
 */
import sharp from "sharp";
import type { Sharp } from "sharp";

export type RasterKind = "png" | "jpeg" | "webp";

/** Decoded size, every frame of an animation counted: a decoder allocates them all. */
export const MAX_PIXELS = 40_000_000;
const QUALITY = 90;

export type RasterVerdict =
  { ok: true; bytes: Buffer } | { ok: false; code: "file_type" | "file_too_large"; why: string };

/**
 * Decodes at once: each may hold up to 40 megapixels (about 160 MB), and a few such files are
 * small on the wire, so a burst of uploads waits its turn instead of exhausting the memory.
 */
const MAX_DECODES = 2;
let decoding = 0;
const waiting: (() => void)[] = [];

async function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  // A finished decode hands its turn to the next waiter directly, so no newcomer slips in between.
  if (decoding >= MAX_DECODES) await new Promise<void>((resolve) => waiting.push(resolve));
  else decoding += 1;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next === undefined) decoding -= 1;
    else next();
  }
}

export function reencode(input: Buffer, kind: RasterKind): Promise<RasterVerdict> {
  return inTurn(() => decode(input, kind));
}

/** How `render` sizes its output. */
export type Fit =
  /** `width` px wide, the height kept in proportion (at most four times the width). */
  | { width: number }
  /** A `size` px square, the image centred inside `inner` px, on `background` or transparent. */
  | { size: number; inner: number; background?: string };

const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/** librsvg draws no SVG wider or taller than this. */
const SVG_MAX_SIDE = 32_767;

/**
 * The density (72 is the SVG's own size) that draws an SVG of `w` × `h` at the size `fit` needs.
 * A side drawn under half a pixel makes librsvg refuse the image, so the shorter side gets at least
 * one; the longer side and the pixel count stay within what librsvg and `MAX_PIXELS` allow.
 */
function svgDensity(w: number, h: number, fit: Fit): number {
  const wanted =
    "width" in fit ? Math.min(fit.width / w, (4 * fit.width) / h) : fit.inner / Math.max(w, h);
  const most = Math.min(SVG_MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
  const scale = Math.min(most, Math.max(wanted, 1 / Math.min(w, h)));
  // sharp's own bounds for density.
  return Math.min(100_000, Math.max(1, 72 * scale));
}

/**
 * A PNG of a stored image, which passed its checks at upload: PNG, JPEG, WebP (the first frame)
 * or SVG. An SVG is drawn at the density its target needs rather than scaled up from its own size,
 * so it stays sharp. Rejects an image that cannot be drawn, such as an SVG too thin for any
 * density to give both sides a pixel within librsvg's limit.
 */
export function render(input: Buffer, ext: RasterKind | "svg", fit: Fit): Promise<Buffer> {
  return inTurn(async () => {
    let density: number | undefined;
    if (ext === "svg") {
      const { width, height } = await sharp(input).metadata();
      if (width > 0 && height > 0) density = svgDensity(width, height, fit);
    }
    const source = (): Sharp =>
      sharp(input, { limitInputPixels: MAX_PIXELS, ...(density ? { density } : {}) }).rotate();
    if ("width" in fit) {
      // The cap keeps a sliver of a logo from becoming a huge image.
      return source()
        .resize({ width: fit.width, height: fit.width * 4, fit: "inside" })
        .png({ compressionLevel: 9 })
        .toBuffer();
    }
    const pad = Math.floor((fit.size - fit.inner) / 2);
    const square = await source()
      .resize(fit.inner, fit.inner, { fit: "contain", background: CLEAR })
      .extend({
        top: pad,
        left: pad,
        bottom: fit.size - fit.inner - pad,
        right: fit.size - fit.inner - pad,
        background: CLEAR,
      })
      .png()
      .toBuffer();
    // flatten runs before resize within one pipeline, so the padding is filled in a second one.
    const out =
      fit.background === undefined
        ? sharp(square)
        : sharp(square).flatten({ background: fit.background });
    return out.png({ compressionLevel: 9 }).toBuffer();
  });
}

async function decode(input: Buffer, kind: RasterKind): Promise<RasterVerdict> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    // The header only, so no pixel limit yet: a huge size is refused below as too large, with
    // the reason, rather than as unreadable.
    meta = await sharp(input, { animated: true, limitInputPixels: false }).metadata();
  } catch {
    return { ok: false, code: "file_type", why: "it could not be read as an image" };
  }
  // Sniffing and the decoder must agree, or the two disagree about what the file is.
  if (meta.format !== kind) {
    return { ok: false, code: "file_type", why: `it decodes as ${meta.format}, not ${kind}` };
  }
  const width = meta.width;
  const height = (meta.pageHeight ?? meta.height) * (meta.pages ?? 1);
  if (!(width > 0 && height > 0)) return { ok: false, code: "file_type", why: "it has no size" };
  if (width * height > MAX_PIXELS) {
    return { ok: false, code: "file_too_large", why: "it decodes larger than 40 megapixels" };
  }
  const animated = (meta.pages ?? 1) > 1;
  // `limitInputPixels` holds even if the header lied; `failOn` refuses a truncated or broken image.
  let image = sharp(input, { animated, limitInputPixels: MAX_PIXELS, failOn: "warning" });
  // Orientation lives in the metadata about to be dropped, so it goes into the pixels. sharp
  // cannot turn an animation's frames, and only WebP of the three animates.
  if (!animated) image = image.rotate();
  switch (kind) {
    case "png":
      image = image.png({ compressionLevel: 9, palette: meta.isPalette });
      break;
    case "jpeg":
      image = image.jpeg({ quality: QUALITY, mozjpeg: true });
      break;
    case "webp":
      image = image.webp({ quality: QUALITY, alphaQuality: 100 });
      break;
  }
  try {
    return { ok: true, bytes: await image.toBuffer() };
  } catch {
    return { ok: false, code: "file_type", why: "it could not be decoded" };
  }
}
