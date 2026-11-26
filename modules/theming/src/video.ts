/**
 * Video backgrounds (contracts/theming.md, The theme package; plan issue-784 D19): MP4 and WebM,
 * recognised by their content and never transcoded, at most 20 MB each and one a theme. The
 * browser's media decoder reads the rest, as its font sanitiser does for WOFF2: a video is only
 * ever played muted in a `<video>`, never opened as a page (routes.ts serves it `nosniff`).
 */
import type { Problem } from "./checks.js";

const MB = 1024 * 1024;
export const VIDEO_LIMIT = { bytes: 20 * MB, label: "20 MB" };

/** The `ftyp` brands of the MP4s browsers play: ISO base media, MP4 version 2 and H.264. */
const MP4_BRANDS = new Set(["isom", "mp42", "avc1"]);

/** An MP4 whose first box is `ftyp` naming one of MP4_BRANDS as its major or a compatible brand. */
function isMp4(b: Buffer): boolean {
  if (b.length < 16 || b.toString("latin1", 4, 8) !== "ftyp") return false;
  const size = b.readUInt32BE(0);
  if (size < 16 || size > b.length || size % 4 !== 0) return false;
  for (let at = 8; at < size; at += 4) {
    // Bytes 12–16 are the minor version, not a brand.
    if (at !== 12 && MP4_BRANDS.has(b.toString("latin1", at, at + 4))) return true;
  }
  return false;
}

/** An EBML variable-length size at `at`: its length in bytes and its value, or undefined. */
function vint(b: Buffer, at: number): { length: number; value: number } | undefined {
  const first = b[at];
  if (first === undefined || first === 0) return undefined;
  const length = Math.clz32(first) - 23;
  if (length > 8 || at + length > b.length) return undefined;
  let value = first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + (b[at + i] ?? 0);
  return { length, value };
}

const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const DOC_TYPE = Buffer.from([0x42, 0x82]);

/** A WebM: the EBML header first, whose DocType element says `webm`. */
function isWebm(b: Buffer): boolean {
  if (!b.subarray(0, 4).equals(EBML)) return false;
  const size = vint(b, 4);
  if (size === undefined) return false;
  const start = 4 + size.length;
  const header = b.subarray(start, Math.min(b.length, start + size.value));
  const at = header.indexOf(DOC_TYPE);
  if (at < 0) return false;
  const len = vint(header, at + 2);
  if (len === undefined) return false;
  const from = at + 2 + len.length;
  return header.toString("latin1", from, from + len.value) === "webm";
}

export function sniffVideo(bytes: Buffer): "mp4" | "webm" | undefined {
  if (isMp4(bytes)) return "mp4";
  if (isWebm(bytes)) return "webm";
  return undefined;
}

/**
 * One video a theme: with more, each the backdrop does not play is an error on its path (with
 * none named, all but the first by path), so publish refuses until the extra one goes.
 */
export function extraVideos(named: string | undefined, present: Iterable<string>): Problem[] {
  const videos = [...present].filter((p) => p.startsWith("videos/")).sort();
  if (videos.length <= 1) return [];
  const kept = named !== undefined && videos.includes(named) ? named : videos[0];
  return videos
    .filter((v) => v !== kept)
    .map((path) => ({
      severity: "error",
      code: "file_too_large",
      path,
      message: "A theme holds one video. Remove this one or the other.",
    }));
}
