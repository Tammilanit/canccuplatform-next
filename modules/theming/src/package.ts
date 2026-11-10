/**
 * The checks of a whole package (contracts/theming.md, The theme package), run on the zip's files
 * before any lock is taken: the manifest, then every file as one upload of its folder. A path that
 * breaks the package's layout refuses the whole zip; a file that fails its checks is a problem at
 * its path, as for one upload (uploads.ts).
 */
import type { Manifest, Problem } from "./checks.js";
import { isObject } from "./checks.js";
import { EMBED_EXTS } from "./embeds.js";
import type { EmbedExt, StoredExt } from "./files.js";
import { parseManifest } from "./manifest.js";
import { readText } from "./text.js";
import { checkFile, checkUpload } from "./uploads.js";

/** PackagePath of contracts/theming.openapi.yaml; the zip reader has refused `.` and `..` parts. */
export const PACKAGE_PATH = /^(css|fonts|images|templates|embeds)\/[A-Za-z0-9._/-]{1,129}$/;
/** theming_package_files_path_check (migrations/006): `templates/` plus 129 would pass the pattern. */
export const MAX_PATH = 136;
/** An embed's name as theming_embed_files keeps it (migrations/002). */
const EMBED_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const EMBED_LIMIT = 5 * 1024 * 1024;

export type CheckedPath =
  { bytes: Buffer; ext: StoredExt; refs?: string[]; warnings?: Problem[] } | { problem: Problem };

export interface CheckedEmbed {
  entry: string;
  files: Map<string, { bytes: Buffer; ext: EmbedExt }>;
}

export interface CheckedPackage {
  manifest: Manifest;
  /** Every path but an embed's stored file: a checked file, or the problem of one that failed. */
  paths: Map<string, CheckedPath>;
  /** The embeds whose every file passed, by name. */
  embeds: Map<string, CheckedEmbed>;
}

export type PackageResult = { ok: true; pkg: CheckedPackage } | { ok: false; why: string };

const fail = (
  code: string,
  path: string,
  message: string,
  warning = false,
): { problem: Problem } => ({
  problem: { severity: warning ? "warning" : "error", code, path, message },
});

const isText = (bytes: Buffer): boolean => readText(bytes) !== undefined;

/** A font's licence: stored for the package and its export, never served. */
function checkLicence(path: string, bytes: Buffer): CheckedPath {
  if (!isText(bytes)) return fail("file_type", path, "A licence file is UTF-8 text.");
  return { bytes, ext: path.toLowerCase().endsWith(".md") ? "md" : "txt" };
}

async function checkPath(path: string, bytes: Buffer): Promise<CheckedPath> {
  if (/^fonts\/.*\.(txt|md)$/i.test(path)) return checkLicence(path, bytes);
  const checked = await checkUpload(path, bytes);
  if (!checked.ok) return { problem: checked.problem };
  const { bytes: stored, ext, refs, warnings } = checked;
  return { bytes: stored, ext, refs, warnings };
}

/** One file of an embed, by its extension; images and fonts through the checks of their folders. */
async function checkEmbedFile(
  path: string,
  bytes: Buffer,
  entry: string,
): Promise<{ bytes: Buffer; ext: EmbedExt } | { problem: Problem }> {
  const ext = EMBED_EXTS[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
  if (ext === undefined)
    return fail("file_type", path, "An embed takes HTML, JS, CSS, JSON, images and WOFF2 fonts.");
  // The sandbox serves HTML only as the entry (embeds.ts, putEmbed).
  if ((path === entry) !== (ext === "html")) {
    return fail("file_type", path, "An embed's one HTML file is its entry.");
  }
  if (ext === "html" || ext === "js" || ext === "css" || ext === "json") {
    if (!isText(bytes)) return fail("file_type", path, "This is no UTF-8 text file.");
    if (ext === "json") {
      try {
        JSON.parse(bytes.toString("utf8"));
      } catch {
        return fail("file_type", path, "This is no JSON file.");
      }
    }
    return { bytes, ext };
  }
  const checked = await checkFile(path, bytes, ext === "woff2" ? "fonts" : "images");
  return checked.ok ? { bytes: checked.bytes, ext: checked.ext } : { problem: checked.problem };
}

/** The files of each embed folder: stored whole when every one passes, else not at all. */
async function checkEmbeds(
  manifest: Manifest,
  files: Map<string, Buffer>,
  paths: Map<string, CheckedPath>,
): Promise<Map<string, CheckedEmbed>> {
  const declared = isObject(manifest.embeds) ? manifest.embeds : {};
  const folders = new Map<string, string[]>();
  for (const path of files.keys()) {
    if (!path.startsWith("embeds/")) continue;
    const name = path.split("/")[1] ?? "";
    folders.set(name, [...(folders.get(name) ?? []), path]);
  }
  const embeds = new Map<string, CheckedEmbed>();
  for (const [name, inFolder] of folders) {
    const spec = declared[name];
    const entry = isObject(spec) ? spec.entry : undefined;
    if (!EMBED_NAME.test(name) || typeof entry !== "string" || !inFolder.includes(entry)) {
      // No embed of theme.yaml takes these files (a missing entry is file_missing there).
      for (const path of inFolder) {
        paths.set(
          path,
          fail(
            "reference_unknown",
            path,
            `No embed of theme.yaml has its entry in embeds/${name}/; this file is left out.`,
            true,
          ),
        );
      }
      continue;
    }
    const checked = new Map<string, { bytes: Buffer; ext: EmbedExt }>();
    let total = 0;
    for (const path of inFolder) {
      const result = await checkEmbedFile(path, files.get(path) ?? Buffer.alloc(0), entry);
      if ("problem" in result) paths.set(path, result);
      else {
        checked.set(path, result);
        total += result.bytes.length;
      }
    }
    if (total > EMBED_LIMIT) {
      paths.set(entry, fail("file_too_large", entry, `The embed ${name} is over 5 MB.`));
    }
    if (inFolder.every((p) => checked.has(p)) && total <= EMBED_LIMIT) {
      embeds.set(name, { entry, files: checked });
    }
  }
  return embeds;
}

export async function checkPackage(files: Map<string, Buffer>): Promise<PackageResult> {
  const yaml = files.get("theme.yaml");
  if (yaml === undefined) return { ok: false, why: "The zip has no theme.yaml at its root." };
  for (const path of files.keys()) {
    if (path !== "theme.yaml" && (!PACKAGE_PATH.test(path) || path.length > MAX_PATH)) {
      return {
        ok: false,
        why: `${path} is outside the package's folders (css, fonts, images, templates, embeds) or too long.`,
      };
    }
  }
  const parsed = parseManifest(yaml);
  if (!parsed.ok) return parsed;
  const paths = new Map<string, CheckedPath>();
  for (const [path, bytes] of files) {
    if (path !== "theme.yaml" && !path.startsWith("embeds/")) {
      paths.set(path, await checkPath(path, bytes));
    }
  }
  const embeds = await checkEmbeds(parsed.manifest, files, paths);
  return { ok: true, pkg: { manifest: parsed.manifest, paths, embeds } };
}
