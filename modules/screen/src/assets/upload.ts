/**
 * A multipart upload, from the request to a checked temporary file ready to place: one file of at
 * most 100 MiB and an optional `title` (contracts/screen.openapi.yaml, AssetUpload). Ported from
 * the legacy `asset-upload.ts`, which guessed the kind from the file name and blocked a list of
 * extensions; here the kind comes from the content alone, and only what the screens show passes.
 */
import { rm } from "node:fs/promises";
import type { FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import { invalidRequest } from "../http.js";
import { receive } from "./files.js";
import type { Received } from "./files.js";
import { normalizeImage } from "./image.js";
import { judgeMedia } from "./probe.js";
import type { Ffprobe } from "./probe.js";
import { sniff } from "./sniff.js";
import type { FileKind } from "./sniff.js";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const TITLE_MAX = 200;

export interface Upload {
  temp: Received;
  /** The file name the browser sent, kept for messages only; never part of a path. */
  filename: string;
  title: string | null;
}

export interface Prepared {
  temp: Received;
  kind: FileKind;
  ext: string;
  mime: string;
  duration_seconds: number | null;
}

const tooLarge = (): KitError =>
  new KitError("A file may be at most 100 MiB.", { status: 413, code: "file_too_large" });

function title(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > TITLE_MAX) {
    throw invalidRequest("`title` must be 1 to 200 characters.");
  }
  return value.trim();
}

/** The request's file in a temporary file of the event; the caller removes it when done. */
export async function readUpload(request: FastifyRequest, root: string): Promise<Upload> {
  if (!request.isMultipart()) throw invalidRequest("Send the file as multipart/form-data.");
  let upload: Partial<Upload> = {};
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || upload.temp) {
          throw invalidRequest("Send one file, in the field `file`.");
        }
        upload.temp = await receive(root, part.file);
        upload.filename = part.filename;
        if (part.file.truncated) throw tooLarge();
      } else if (part.fieldname === "title") {
        upload.title = title(part.value);
      }
    }
  } catch (err) {
    if (upload.temp) await rm(upload.temp.path, { force: true });
    if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw tooLarge();
    throw err;
  }
  if (!upload.temp) throw invalidRequest("Send one file, in the field `file`.");
  upload = { title: null, ...upload };
  return upload as Upload;
}

/** The upload checked by content: images normalised, video and sound probed. */
export async function prepare(root: string, temp: Received, probe: Ffprobe): Promise<Prepared> {
  try {
    return await check(root, temp, probe);
  } catch (err) {
    await rm(temp.path, { force: true });
    throw err;
  }
}

async function check(root: string, temp: Received, probe: Ffprobe): Promise<Prepared> {
  if (temp.bytes === 0) throw invalidRequest("The file is empty.");
  const sniffed = sniff(temp.head, temp.tail);
  if (sniffed === null) {
    throw invalidRequest(
      "This file is not an image, video, sound, PowerPoint deck or PDF the screens can show.",
    );
  }
  if (sniffed.kind === "image") {
    const image = await receive(root, await normalizeImage(temp.path));
    await rm(temp.path, { force: true });
    return { temp: image, ...sniffed, duration_seconds: null };
  }
  if (sniffed.kind === "pptx" || sniffed.kind === "pdf") {
    return { temp, ...sniffed, duration_seconds: null };
  }
  let probed;
  try {
    probed = await probe(temp.path);
  } catch {
    throw invalidRequest(`This ${sniffed.container} file could not be read. Export it again.`);
  }
  const judged = judgeMedia(sniffed, probed, temp.bytes);
  // judgeMedia refuses every unplayable container; this narrows the type.
  if (sniffed.kind === "unplayable") throw invalidRequest("The screens cannot play this file.");
  return { temp, ...sniffed, ...judged };
}

/** The title an upload gets: the one sent, else the file name, so name-check finds it again. */
export function uploadTitle(upload: Upload): string {
  if (upload.title !== null) return upload.title;
  const name = upload.filename.trim().slice(0, TITLE_MAX);
  return name.length > 0 ? name : "Untitled";
}
