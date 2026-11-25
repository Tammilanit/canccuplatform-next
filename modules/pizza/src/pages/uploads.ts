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

/**
 * A menu has a few pages; a receipt is one photo. A form without a script sends its unused file
 * inputs as empty parts, which count as files for the limit: room for them, then only the
 * non-empty photos are counted against MAX_PAGES.
 */
const MAX_FILES = MAX_PAGES + 4;
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

/**
 * The form's photos, its fields moved to `request.body`. The body is set even when a photo is
 * refused: the menu read's table lives only in the form, and the page needs it to draw it again.
 */
export async function photosOf(request: FastifyRequest): Promise<Photo[]> {
  if (!request.isMultipart()) return [];
  const fields: Record<string, string> = {};
  const photos: Photo[] = [];
  let refused: unknown;
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        // Over the limit is refused as it arrives: with the contract's code, not Fastify's own.
        // The rest of the form is still read, so the fields after the photo survive.
        try {
          const bytes = await part.toBuffer();
          if (part.file.truncated) refused ??= tooLarge();
          else if (bytes.length > 0) photos.push({ bytes, type: part.mimetype });
        } catch (err) {
          refused ??=
            (err as { code?: unknown }).code === "FST_REQ_FILE_TOO_LARGE" ? tooLarge() : err;
        }
      } else if (typeof part.value === "string") fields[part.fieldname] = part.value;
    }
  } catch (err) {
    refused ??= (err as { code?: unknown }).code === "FST_FILES_LIMIT" ? tooManyPages() : err;
  }
  request.body = fields;
  if (refused === undefined && photos.length > MAX_PAGES) refused = tooManyPages();
  if (refused !== undefined) throw refused;
  return photos;
}
