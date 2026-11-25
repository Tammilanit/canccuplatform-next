/**
 * Forms with photos (a receipt, a menu's pages): multipart, read whole and handed on to the API as
 * its image body, so the API's own checks (type, 30 MB, location stripped) apply. The form's
 * fields become the request's body, so `viaApi` finds the form's idempotency key as for any form.
 */
import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import { MAX_PHOTO_BYTES, tooLarge } from "../photos.js";
import { MAX_PAGES } from "../reader.js";
import type { Photo } from "./kit.js";

/** A menu has a few pages; a receipt is one photo. */
const MAX_FILES = MAX_PAGES;
/** A menu read's table travels in its form: up to 300 rows of 11 fields, and its notes (D10). */
const MAX_FIELDS = 3500;

export function photoForms(scope: FastifyInstance): void {
  void scope.register(multipart, {
    limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_FILES, fields: MAX_FIELDS, fieldSize: 4096 },
  });
}

const tooManyPages = () =>
  new KitError(`A menu read takes at most ${MAX_PAGES} pages.`, {
    status: 400,
    code: "too_many_pages",
  });

/** The form's photos, its fields moved to `request.body`. */
export async function photosOf(request: FastifyRequest): Promise<Photo[]> {
  if (!request.isMultipart()) return [];
  const fields: Record<string, string> = {};
  const photos: Photo[] = [];
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        // Over the limit is refused as it arrives: with the contract's code, not Fastify's own.
        const bytes = await part.toBuffer().catch((err: unknown) => {
          throw (err as { code?: unknown }).code === "FST_REQ_FILE_TOO_LARGE" ? tooLarge() : err;
        });
        if (part.file.truncated) throw tooLarge();
        if (bytes.length > 0) photos.push({ bytes, type: part.mimetype });
      } else if (typeof part.value === "string") fields[part.fieldname] = part.value;
    }
  } catch (err) {
    if ((err as { code?: unknown }).code === "FST_FILES_LIMIT") throw tooManyPages();
    throw err;
  }
  request.body = fields;
  return photos;
}
