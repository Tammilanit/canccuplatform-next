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
import type { FileKind, Sniffed } from "./sniff.js";

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

/** The title rule of uploads, links and renames. */
export function assetTitle(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > TITLE_MAX) {
    throw invalidRequest("`title` must be 1 to 200 characters.");
  }
  return value.trim();
}

/** The request's file in a temporary file of the event; the caller removes it when done. */
export async function readUpload(request: FastifyRequest, root: string): Promise<Upload> {
  let title: string | null = null;
  const file = await readMultipart(request, root, (name, value) => {
    if (name === "title") title = assetTitle(value);
  });
  return { ...file, title };
}

/**
 * One file, in the field `file`, written to a temporary file of the event; every other field
 * goes to `onField`, which throws to refuse it. `limits` widens the app's for a form with more
 * fields.
 */
export async function readMultipart(
  request: FastifyRequest,
  root: string,
  onField: (name: string, value: unknown) => void,
  limits?: { fields: number; parts: number },
): Promise<{ temp: Received; filename: string }> {
  if (!request.isMultipart()) throw invalidRequest("Send the file as multipart/form-data.");
  let file: { temp: Received; filename: string } | undefined;
  try {
    for await (const part of request.parts(limits ? { limits } : undefined)) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || file) {
          throw invalidRequest("Send one file, in the field `file`.");
        }
        file = { temp: await receive(root, part.file), filename: part.filename };
        if (part.file.truncated) throw tooLarge();
      } else {
        onField(part.fieldname, part.value);
      }
    }
  } catch (err) {
    if (file) await rm(file.temp.path, { force: true });
    if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") throw tooLarge();
    throw err;
  }
  if (!file) throw invalidRequest("Send one file, in the field `file`.");
  return file;
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
  if (sniffed.kind === "unplayable-image") {
    throw invalidRequest(`This image is ${sniffed.container}. Save it as JPEG or PNG.`);
  }
  if (sniffed.kind === "image") return normalized(root, temp, sniffed);
  if (sniffed.kind === "pptx" || sniffed.kind === "pdf") {
    return { temp, ...sniffed, duration_seconds: null };
  }
  let probed;
  try {
    // Every video and sound sniff names its demuxer; mp4's is the fallback that cannot happen.
    probed = await probe(temp.path, sniffed.demuxer ?? "mov");
  } catch {
    throw invalidRequest(`This ${sniffed.container} file could not be read. Export it again.`);
  }
  const judged = judgeMedia(sniffed, probed, temp.bytes);
  // judgeMedia refuses every unplayable container; this narrows the type.
  if (sniffed.kind === "unplayable") throw invalidRequest("The screens cannot play this file.");
  return { temp, ...sniffed, ...judged };
}

/**
 * A photo for the carousel: images only, normalised as an image asset is. The temporary file is
 * removed on refusal, as `prepare` does.
 */
export async function preparePhoto(root: string, temp: Received): Promise<Prepared> {
  try {
    const sniffed = temp.bytes === 0 ? null : sniff(temp.head, temp.tail);
    if (sniffed?.kind !== "image") throw invalidRequest("A photo must be a JPEG or PNG image.");
    return await normalized(root, temp, sniffed);
  } catch (err) {
    await rm(temp.path, { force: true });
    throw err;
  }
}

/** The image upright, within 2560×1440 and without metadata, in a new temporary file. */
async function normalized(root: string, temp: Received, sniffed: Sniffed): Promise<Prepared> {
  let image: Received;
  try {
    image = await receive(root, await normalizeImage(temp.path));
  } catch (err) {
    // A KitError is ours (a refused header, the volume); anything else is sharp failing to encode.
    if (err instanceof KitError) throw err;
    throw invalidRequest("This image could not be read. Save it again as PNG or JPEG.");
  }
  await rm(temp.path, { force: true });
  return { temp: image, ...sniffed, duration_seconds: null };
}

/** The title an upload gets: the one sent, else the file name, so name-check finds it again. */
export function uploadTitle(upload: Upload): string {
  if (upload.title !== null) return upload.title;
  const name = upload.filename.trim().slice(0, TITLE_MAX);
  return name.length > 0 ? name : "Untitled";
}
