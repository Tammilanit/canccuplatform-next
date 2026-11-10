/**
 * PNG, JPEG and WebP (contracts/theming.md, Raster images and fonts): decoded and stored
 * re-encoded, so nothing of the upload but its pixels reaches the volume: metadata such as camera
 * and GPS data, and whatever a polyglot hides around or inside the image, are dropped.
 */
import sharp from "sharp";

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
