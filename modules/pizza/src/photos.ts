/**
 * Photos of receipts and menus (#644): read as a request body, checked by their content, and
 * re-encoded upright at most 2,576 px on the long edge (the plan, The optional AI reader). Only
 * re-encoding drops the metadata, a phone photo's location among it, so every photo is re-encoded
 * before it is kept or sent anywhere.
 */
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { KitError } from "@canccu/kit";

export const PHOTO_TYPES: Record<string, { ext: string; format: "jpeg" | "png" | "webp" }> = {
  "image/jpeg": { ext: "jpg", format: "jpeg" },
  "image/png": { ext: "png", format: "png" },
  "image/webp": { ext: "webp", format: "webp" },
};
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** The plan's limit: the provider shrinks larger images anyway, and pays for none of the rest. */
export const LONG_EDGE = 2576;

const tooLarge = () =>
  new KitError("A photo may be at most 10 MB.", { status: 413, code: "file_too_large" });

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

/** The photo upright, without metadata, at most LONG_EDGE; 400 when it is not what it says. */
export async function cleanPhoto(input: Buffer, type: string): Promise<Buffer> {
  const want = PHOTO_TYPES[type];
  const invalid = () =>
    new KitError("This photo could not be read. Take it again.", {
      status: 400,
      code: "image_invalid",
    });
  if (want === undefined) throw invalid();
  let format: string | undefined;
  try {
    format = (await sharp(input).metadata()).format;
  } catch {
    throw invalid();
  }
  if (format !== want.format) throw invalid();
  const pipeline = sharp(input)
    .rotate()
    .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true });
  if (want.format === "jpeg") return pipeline.jpeg({ quality: 85 }).toBuffer();
  if (want.format === "png") return pipeline.png().toBuffer();
  return pipeline.webp({ quality: 85 }).toBuffer();
}
