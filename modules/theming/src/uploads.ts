/**
 * The checks of one uploaded file (contracts/theming.md, The theme package and Upload safety):
 * its content decides its type, never its name or the `Content-Type` sent, and the name must then
 * agree. A file that passes is what gets stored; one that fails is a problem on its path.
 */
import type { Problem } from "./checks.js";
import type { Ext } from "./files.js";
import { reencode } from "./raster.js";
import type { RasterKind } from "./raster.js";
import { checkSvg } from "./svg.js";

const KB = 1024;
const MB = 1024 * KB;
/** The largest file this path takes: no request body is read past it. */
export const BODY_LIMIT = 5 * MB;

type Kind = RasterKind | "svg" | "woff2";

/** Per-kind limits of contracts/theming.md, The theme package. */
const LIMITS: Record<Kind, { bytes: number; label: string }> = {
  png: { bytes: 5 * MB, label: "5 MB" },
  jpeg: { bytes: 5 * MB, label: "5 MB" },
  webp: { bytes: 5 * MB, label: "5 MB" },
  svg: { bytes: 512 * KB, label: "512 KB" },
  woff2: { bytes: 1 * MB, label: "1 MB" },
};

const NAMES: Record<Kind, string> = {
  png: "PNG",
  jpeg: "JPEG",
  webp: "WebP",
  svg: "SVG",
  woff2: "WOFF2",
};

const STORED_AS: Record<Kind, Ext> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  svg: "svg",
  woff2: "woff2",
};

/** What each folder takes, by the extension its paths may carry. */
const FOLDERS: Record<string, Record<string, Kind>> = {
  images: { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp", svg: "svg" },
  fonts: { woff2: "woff2" },
};

/** The folders this path takes files for. */
export const UPLOAD_FOLDERS = Object.keys(FOLDERS);

export type Checked = { ok: true; bytes: Buffer; ext: Ext } | { ok: false; problem: Problem };

const refuse = (code: string, path: string, message: string): Checked => ({
  ok: false,
  problem: { severity: "error", code, path, message },
});

const utf8 = new TextDecoder("utf-8", { fatal: true });

function decodeUtf8(bytes: Buffer): string | undefined {
  try {
    return utf8.decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * An XML document whose first element is `svg`, after a declaration, comments and a DOCTYPE (the
 * decoder has dropped a byte order mark).
 */
function looksLikeSvg(text: string): boolean {
  const prolog =
    /^\s*(?:<\?xml[^>]*\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>)\s*)*/i;
  const rest = text.replace(prolog, "");
  return /^<svg[\s/>]/.test(rest);
}

function sniff(bytes: Buffer): { kind: Kind; text?: string } | undefined {
  const head = (n: number): string => bytes.subarray(0, n).toString("latin1");
  if (head(8) === "\x89PNG\r\n\x1a\n") return { kind: "png" };
  if (head(3) === "\xff\xd8\xff") return { kind: "jpeg" };
  if (head(4) === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return { kind: "webp" };
  }
  if (head(4) === "wOF2") return { kind: "woff2" };
  const text = decodeUtf8(bytes);
  if (text !== undefined && looksLikeSvg(text)) return { kind: "svg", text };
  return undefined;
}

/** WOFF2's flavours: TrueType, CFF, Apple TrueType and collections (the WOFF2 spec, 4). */
const FLAVORS = new Set([0x00010000, 0x4f54544f, 0x74727565, 0x74746366]);
const WOFF2_HEADER = 48;

/**
 * Only the header (contracts/theming.md: "the browser's font sanitiser does the rest"): it must
 * describe this file, so a header in front of something else is refused.
 */
function woff2Reason(b: Buffer): string | undefined {
  if (b.length < WOFF2_HEADER) return "it is shorter than a WOFF2 header";
  if (!FLAVORS.has(b.readUInt32BE(4))) return "its WOFF2 header names no font flavour";
  if (b.readUInt32BE(8) !== b.length) return "its WOFF2 header gives another length";
  if (b.readUInt16BE(12) === 0) return "its WOFF2 header lists no tables";
  if (b.readUInt16BE(14) !== 0) return "its WOFF2 header is malformed";
  if (b.readUInt32BE(20) > b.length - WOFF2_HEADER) return "its WOFF2 header overstates its data";
  return undefined;
}

/**
 * The checks of `bytes` uploaded as `path` (validated by the caller), as a file of `folder`
 * (`images` or `fonts`): its own folder, or the kind an embed's file takes by its extension.
 */
export async function checkFile(
  path: string,
  bytes: Buffer,
  folderName = path.slice(0, path.indexOf("/")),
): Promise<Checked> {
  const folder = FOLDERS[folderName] ?? {};
  const named = folder[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
  const accepted = [...new Set(Object.values(folder).map((k) => NAMES[k]))].join(", ");
  if (named === undefined) {
    return refuse("file_type", path, `This folder takes ${accepted} files, named so.`);
  }
  const found = sniff(bytes);
  if (found === undefined) {
    return refuse("file_type", path, `This is no ${accepted} file.`);
  }
  if (found.kind !== named) {
    return refuse(
      "file_type",
      path,
      `This is a ${NAMES[found.kind]} file, named as ${NAMES[named]}.`,
    );
  }
  const limit = LIMITS[found.kind];
  if (bytes.length > limit.bytes) {
    return refuse("file_too_large", path, `${NAMES[found.kind]} files are at most ${limit.label}.`);
  }
  const ext = STORED_AS[found.kind];
  if (found.kind === "woff2") {
    const why = woff2Reason(bytes);
    return why === undefined
      ? { ok: true, bytes, ext }
      : refuse("file_type", path, `Refused: ${why}.`);
  }
  if (found.kind === "svg") {
    const verdict = checkSvg(found.text ?? "");
    return verdict.ok
      ? { ok: true, bytes, ext }
      : refuse(verdict.code, path, `Refused: ${verdict.why}.`);
  }
  const raster = await reencode(bytes, found.kind);
  if (!raster.ok) return refuse(raster.code, path, `Refused: ${raster.why}.`);
  // Re-encoding may grow a file (a palette or a better compressor upstream); the limit holds for what is stored.
  if (raster.bytes.length > limit.bytes) {
    return refuse("file_too_large", path, `Re-encoded, this image passes ${limit.label}.`);
  }
  return { ok: true, bytes: raster.bytes, ext };
}
