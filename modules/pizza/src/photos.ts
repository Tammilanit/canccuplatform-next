/**
 * Photos of receipts and menus (#644): read as a request body, checked by their content, and
 * re-encoded upright at most 1,600 px on the long edge, or 2,400 for a receipt more than twice as
 * tall as wide (#789 item 10, D8). Only re-encoding drops the metadata, a phone photo's location
 * among it, so every photo is re-encoded once, before it is kept or sent anywhere; what is kept is
 * what the reader is sent, and the upload's own bytes are never written.
 */
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import type { Metadata } from "sharp";
import { KitError } from "@canccu/kit";

export const PHOTO_TYPES: Record<string, { ext: string; format: "jpeg" | "png" | "webp" }> = {
  "image/jpeg": { ext: "jpg", format: "jpeg" },
  "image/png": { ext: "png", format: "png" },
  "image/webp": { ext: "webp", format: "webp" },
};
/** A phone's full-size photo fits; the phone's script shrinks it before it is sent anyway. */
export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
/** Enough to read a receipt's or a menu's print; the provider would shrink a larger one itself. */
export const LONG_EDGE = 1600;
/** A long receipt keeps more, so its lines are not shrunk past reading. */
export const TALL_EDGE = 2400;

/** The long edge a photo is kept at: more for one more than twice as tall as wide. */
export const edgeFor = (width: number, height: number): number =>
  height > 2 * width ? TALL_EDGE : LONG_EDGE;

export const tooLarge = () =>
  new KitError("A photo may be at most 30 MB. Take it again, or send a smaller one.", {
    status: 413,
    code: "file_too_large",
  });

/**
 * An image body as a Buffer. The kit answers Fastify's own 413 and 415 as `http_413`, so the
 * limit and the types are checked here, with the contract's codes.
 */
export function photoBodies(app: FastifyInstance): void {
  app.addContentTypeParser(/^image\//, (request, payload, done) => {
    const type = (request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (PHOTO_TYPES[type] === undefined) {
      payload.resume();
      done(
        new KitError("Send a JPEG, PNG or WebP photo.", {
          status: 415,
          code: "unsupported_media_type",
        }),
      );
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    payload.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_PHOTO_BYTES) {
        failed = true;
        done(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    payload.on("end", () => {
      if (!failed) done(null, Buffer.concat(chunks));
    });
    payload.on("error", (err) => {
      if (!failed) done(err);
    });
  });
}

/** The request's photo and its type, or 400 when there is none. */
export function photoOf(
  body: unknown,
  contentType: string | undefined,
): { photo: Buffer; type: string } {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!Buffer.isBuffer(body) || PHOTO_TYPES[type] === undefined) {
    throw new KitError("Send the photo as the body: JPEG, PNG or WebP.", {
      status: 415,
      code: "unsupported_media_type",
    });
  }
  if (body.length > MAX_PHOTO_BYTES) throw tooLarge();
  return { photo: body, type };
}

/**
 * The photo upright, without metadata, within `edgeFor`, as JPEG (also for a PNG, whose lossless
 * bytes a photo does not need) or WebP; 400 when it is not what it says.
 */
export async function cleanPhoto(
  input: Buffer,
  type: string,
): Promise<{ image: Buffer; type: string }> {
  const want = PHOTO_TYPES[type];
  const invalid = () =>
    new KitError("This photo could not be read. Take it again.", {
      status: 400,
      code: "image_invalid",
    });
  if (want === undefined) throw invalid();
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw invalid();
  }
  if (meta.format !== want.format) throw invalid();
  // EXIF orientations 5–8 turn the photo a quarter: its upright height is the stored width.
  const turned = (meta.orientation ?? 1) >= 5;
  const edge = turned ? edgeFor(meta.height, meta.width) : edgeFor(meta.width, meta.height);
  const pipeline = sharp(input, { limitInputPixels: false })
    .rotate()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true });
  if (want.format === "webp")
    return { image: await pipeline.webp({ quality: 85 }).toBuffer(), type: "image/webp" };
  return {
    image: await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer(),
    type: "image/jpeg",
  };
}

/** The provider's per-image limit is 5 MB of base64; this keeps the bytes under it with room. */
export const PROVIDER_MAX_BYTES = 3 * 1024 * 1024;

/**
 * What the reader is sent: the kept photo as it is (a JPEG or WebP from `cleanPhoto`); only a
 * photo still over the provider's limit, or a PNG kept before #789, is re-encoded as JPEG,
 * lowering the quality and then the size until it fits.
 */
export async function forProvider(
  clean: Buffer,
  type: string,
): Promise<{ image: Buffer; type: string }> {
  if (type !== "image/png" && clean.length <= PROVIDER_MAX_BYTES) return { image: clean, type };
  let edge = LONG_EDGE;
  for (;;) {
    for (const quality of [85, 70, 55, 40]) {
      const image = await sharp(clean)
        .flatten({ background: "#ffffff" })
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      if (image.length <= PROVIDER_MAX_BYTES || edge <= 600) return { image, type: "image/jpeg" };
    }
    edge = Math.round(edge * 0.7);
  }
}
