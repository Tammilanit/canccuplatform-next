/**
 * theme.yaml, read as untrusted YAML, and the checks of how a manifest fits its package's files
 * (contracts/theming.md, The theme package): what the schema cannot see, as scripts/check-theme-refs
 * checks the demo themes. The layout checks stay in checks.ts; these need the package's paths.
 */
import { parseDocument } from "yaml";
import type { Manifest, Problem } from "./checks.js";
import { isObject, list } from "./checks.js";

const MAX_MANIFEST = 64 * 1024;
/** The families a font token may name without a package font (theme.schema.json, `family`). */
const GENERIC_FAMILIES = new Set(["system-ui", "ui-monospace", "sans-serif", "serif", "monospace"]);
/** What only the advanced mode makes (Advanced mode): its manifest parts and their folders. */
const ADVANCED_PARTS = ["css", "fonts", "templates", "embeds"] as const;

export type Parsed = { ok: true; manifest: Manifest } | { ok: false; why: string };

const utf8 = new TextDecoder("utf-8", { fatal: true });

export function parseManifest(bytes: Buffer): Parsed {
  if (bytes.length > MAX_MANIFEST) return { ok: false, why: "theme.yaml is over 64 KB." };
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return { ok: false, why: "theme.yaml is not UTF-8." };
  }
  try {
    const doc = parseDocument(text, { uniqueKeys: true, prettyErrors: false });
    const first = doc.errors[0];
    if (first !== undefined)
      return { ok: false, why: `theme.yaml is no valid YAML: ${first.message}` };
    // No aliases at all (plan D2): an alias bomb is refused before anything expands.
    const value: unknown = doc.toJS({ maxAliasCount: 0 });
    if (!isObject(value)) return { ok: false, why: "theme.yaml must be a YAML mapping." };
    // Through JSON, as it is stored: only what jsonb keeps, nothing YAML-specific left.
    return { ok: true, manifest: JSON.parse(JSON.stringify(value)) as Manifest };
  } catch (err) {
    return {
      ok: false,
      why: `theme.yaml is refused: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * The package's paths: every path it holds, and those whose upload failed its checks with an
 * error. A warning (an undeclared embed folder's file) never hides a declared file's absence.
 */
export interface PackagePaths {
  present: Set<string>;
  failed: Set<string>;
}

const strings = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === "string");
const record = (v: unknown): Record<string, unknown> => (isObject(v) ? v : {});

function embedFiles(embed: unknown): string[] {
  const e = record(embed);
  return [...strings([e.entry]), ...strings(e.files)];
}

/** Every file the manifest names, in the manifest's order. */
function namedFiles(m: Manifest): string[] {
  const out = [...strings(Object.values(record(m.images))), ...strings(m.css)];
  for (const font of list(m.fonts))
    out.push(...strings([record(font).file, record(font).licence_file]));
  for (const t of Object.values(record(m.templates))) out.push(...strings([record(t).file]));
  for (const e of Object.values(record(m.embeds))) out.push(...embedFiles(e));
  return [...new Set(out)];
}

const problem = (
  code: string,
  path: string,
  message: string,
  severity: Problem["severity"] = "error",
): Problem => ({
  severity,
  code,
  path,
  message,
});

function missing(m: Manifest, p: PackagePaths): Problem[] {
  // An embed with a failed file is stored without any of its files: its failures say why.
  const failedFolders = [...p.failed]
    .filter((f) => f.startsWith("embeds/"))
    .map((f) => f.split("/").slice(0, 2).join("/") + "/");
  return namedFiles(m)
    .filter((f) => !p.present.has(f) && !failedFolders.some((folder) => f.startsWith(folder)))
    .map((f) =>
      problem("file_missing", f, `theme.yaml names ${f}, which the package does not hold.`),
    );
}

function unknownNames(m: Manifest): Problem[] {
  const out: Problem[] = [];
  const families = new Set([...GENERIC_FAMILIES, ...list(m.fonts).map((f) => record(f).family)]);
  for (const [token, family] of Object.entries(record(record(m.tokens).fonts))) {
    if (typeof family === "string" && !families.has(family)) {
      out.push(
        problem(
          "reference_unknown",
          `theme.yaml#/tokens/fonts/${token}`,
          `No package font is ${family}.`,
        ),
      );
    }
  }
  for (const [name, embed] of Object.entries(record(m.embeds))) {
    const outside = embedFiles(embed).find((f) => !f.startsWith(`embeds/${name}/`));
    if (outside !== undefined) {
      out.push(
        problem(
          "reference_unknown",
          `theme.yaml#/embeds/${name}`,
          `${outside} is outside embeds/${name}/.`,
        ),
      );
    }
  }
  return out;
}

function modeMismatch(m: Manifest, p: PackagePaths): Problem[] {
  if (m.mode !== "simple") return [];
  const out: Problem[] = [];
  const has = (v: unknown): boolean =>
    Array.isArray(v) ? v.length > 0 : Object.keys(record(v)).length > 0;
  for (const part of ADVANCED_PARTS) {
    const file = [...p.present].sort().find((f) => f.startsWith(`${part}/`));
    const at = has(m[part]) ? `theme.yaml#/${part}` : file;
    if (at !== undefined) {
      out.push(
        problem("mode_mismatch", at, `A simple-mode theme has no ${part}; declare mode: advanced.`),
      );
    }
  }
  for (const group of ["fonts", "sizes"]) {
    if (has(record(m.tokens)[group])) {
      out.push(
        problem(
          "mode_mismatch",
          `theme.yaml#/tokens/${group}`,
          `A simple-mode theme sets no ${group} tokens; declare mode: advanced.`,
        ),
      );
    }
  }
  return out;
}

export function referenceProblems(m: Manifest, p: PackagePaths): Problem[] {
  return [...missing(m, p), ...unknownNames(m), ...modeMismatch(m, p)];
}
