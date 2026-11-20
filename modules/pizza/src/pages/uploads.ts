/**
 * Forms with photos (a receipt, a menu's pages): multipart, read whole and handed on to the API as
 * its image body, so the API's own checks (type, 10 MB, location stripped) apply. The form's
 * fields become the request's body, so `viaApi` finds the form's idempotency key as for any form.
 */
import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import { MAX_PHOTO_BYTES } from "../photos.js";
import type { Photo } from "./kit.js";

/** A menu has a few pages; a receipt is one photo. */
const MAX_FILES = 6;

export function photoForms(scope: FastifyInstance): void {
  void scope.register(multipart, {
    limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_FILES, fields: 20, fieldSize: 4096 },
  });
}

/** The form's photos, its fields moved to `request.body`. */
export async function photosOf(request: FastifyRequest): Promise<Photo[]> {
  if (!request.isMultipart()) return [];
  const fields: Record<string, string> = {};
  const photos: Photo[] = [];
  for await (const part of request.parts()) {
    if (part.type === "file") {
      const bytes = await part.toBuffer();
      if (part.file.truncated)
        throw new KitError("A photo may be at most 10 MB.", { status: 413, code: "file_too_large" });
      if (bytes.length > 0) photos.push({ bytes, type: part.mimetype });
    } else if (typeof part.value === "string") fields[part.fieldname] = part.value;
  }
  request.body = fields;
  return photos;
}
