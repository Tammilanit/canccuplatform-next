/**
 * Images as the screens get them (contracts/screen.md, Content and scheduling): EXIF orientation
 * baked into the pixels, at most 2560×1440, metadata dropped. Ported from the legacy
 * `image-resize.ts` and `image-orientation.ts`, which kept an upright, small image's bytes as they
 * were; here every image is re-encoded, since only that drops its metadata (a phone photo's
 * location among it). The legacy scaled to *cover* the frame, which left a portrait photo at
 * 2560×3840; the contract says at most 2560×1440, so it fits inside.
 */
import sharp from "sharp";
import { invalidRequest } from "../http.js";

export const MAX_IMAGE_WIDTH = 2560;
export const MAX_IMAGE_HEIGHT = 1440;
const QUALITY = 85;

/** Upright dimensions that fit the frame, or null when the image already does (never enlarged). */
export function fitSize(width: number, height: number): { width: number; height: number } | null {
  const scale = Math.min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height);
  if (scale >= 1) return null;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The bytes to store, in the input's format. 400 when sharp cannot read the image. */
export async function normalizeImage(input: Buffer | string): Promise<Buffer> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { animated: true }).metadata();
  } catch {
    throw invalidRequest("This image could not be read. Save it again as PNG or JPEG.");
  }
  const animated = (meta.pages ?? 1) > 1;
  const width = meta.width;
  const height = animated ? meta.pageHeight : meta.height;
  if (!width || !height) throw invalidRequest("This image has no size. Save it again.");
  // Orientations 5 to 8 turn the image a quarter, so its upright size swaps.
  const turned = (meta.orientation ?? 1) >= 5;
  const target = turned ? fitSize(height, width) : fitSize(width, height);

  // sharp cannot turn the frames of an animation, and writes no metadata unless told to.
  let pipeline = sharp(input, { animated });
  if (!animated) pipeline = pipeline.rotate();
  if (target) pipeline = pipeline.resize(target.width, target.height, { fit: "fill" });
  switch (meta.format) {
    case "jpeg":
      pipeline = pipeline.jpeg({ quality: QUALITY, chromaSubsampling: "4:4:4" });
      break;
    case "png":
      pipeline = pipeline.png();
      break;
    case "webp":
      pipeline = pipeline.webp({ quality: QUALITY });
      break;
    case "gif":
      pipeline = pipeline.gif();
      break;
    default:
      throw invalidRequest("Use a PNG, JPEG, GIF or WebP image.");
  }
  try {
    return await pipeline.toBuffer();
  } catch {
    throw invalidRequest("This image could not be read. Save it again as PNG or JPEG.");
  }
}
