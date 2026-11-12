/**
 * What a revision generates from its CSS and templates at publish (contracts/theming.md, Advanced
 * mode and The parsed tree; plan D4): the compiled CSS as a served file and the parsed templates,
 * each package path rewritten to the served address of the file the revision holds at it.
 */
import type { SqlClient } from "@canccu/kit";
import type { Manifest } from "./checks.js";
import { isObject, list } from "./checks.js";
import { StyleError, compileCss } from "./css.js";
import { FILE_NAME } from "./files.js";
import type { FileStore } from "./files.js";
import { SERVED } from "./theme.js";
import { parseTemplate } from "./template.js";
import type { TemplateNode } from "./template.js";

/** ParsedTemplate of contracts/theming.openapi.yaml. */
export interface ParsedTemplate {
  name: string;
  widget: string;
  tree: TemplateNode[];
}

export interface CompiledStyle {
  /** The compiled CSS's served name, or null for a theme without CSS. */
  css: string | null;
  templates: ParsedTemplate[];
}

/**
 * Compiles the CSS and templates `manifest` names from the package files of `source` (`draft` or
 * `r:<n>`), in the caller's transaction. A file that fails its checks, or names one the package
 * does not hold, is a StyleError: publish answers it as `theme_invalid`.
 */
export async function compileStyle(
  c: SqlClient,
  files: FileStore,
  source: string,
  manifest: Manifest,
): Promise<CompiledStyle> {
  const held = await heldFiles(c, source);
  const css = await cssOf(held, files, manifest, SERVED);
  const templates = await templatesOf(held, files, manifest, SERVED);
  return {
    css: css === null ? null : await files.put(c, css, "css"),
    templates,
  };
}

/**
 * The templates `manifest` names, parsed from the package files of `source` with every image at
 * `prefix` + its file's name: the Studio's screen preview draws the draft's at `/theming/draft/`.
 * A StyleError as for compileStyle.
 */
export async function parsedTemplates(
  c: SqlClient,
  files: FileStore,
  source: string,
  manifest: Manifest,
  prefix: string,
): Promise<ParsedTemplate[]> {
  return templatesOf(await heldFiles(c, source), files, manifest, prefix);
}

async function templatesOf(
  held: Held,
  files: FileStore,
  manifest: Manifest,
  prefix: string,
): Promise<ParsedTemplate[]> {
  const templates: ParsedTemplate[] = [];
  for (const [name, spec] of Object.entries(
    isObject(manifest.templates) ? manifest.templates : {},
  )) {
    if (!isObject(spec) || typeof spec.file !== "string" || typeof spec.widget !== "string")
      continue;
    const parsed = parseTemplate(spec.file, await read(held, files, spec.file));
    if (!parsed.ok) throw new StyleError(parsed.problem);
    const served = (path: string): string | undefined => servedAt(held, path, prefix);
    templates.push({ name, widget: spec.widget, tree: servedTree(parsed.tree, served, spec.file) });
  }
  return templates;
}

/**
 * The CSS `manifest` lists, compiled from the package files of `source` with every `url()` at
 * `prefix` + its file's name, without storing it: publish stores it under SERVED; the Studio's
 * preview serves the draft's under `/theming/draft/`, and compares it with the current revision's
 * (plan issue-185 D10). Null for a theme without CSS; a StyleError as for compileStyle.
 */
export async function compiledCss(
  c: SqlClient,
  files: FileStore,
  source: string,
  manifest: Manifest,
  prefix: string,
): Promise<Buffer | null> {
  return cssOf(await heldFiles(c, source), files, manifest, prefix);
}

type Held = Map<string, string>;

async function heldFiles(c: SqlClient, source: string): Promise<Held> {
  const { rows } = await c.query(
    `SELECT path, file FROM theming_package_files WHERE owner = $1 AND file IS NOT NULL`,
    [source],
  );
  return new Map((rows as { path: string; file: string }[]).map((r) => [r.path, r.file]));
}

/** Only what the served paths answer: an image or a font, never a template's or licence's text. */
function servedAt(held: Held, path: string, prefix: string): string | undefined {
  const file = held.get(path);
  return file !== undefined && FILE_NAME.test(file) ? prefix + file : undefined;
}

async function read(held: Held, files: FileStore, path: string): Promise<Buffer> {
  const file = held.get(path);
  const bytes = file === undefined ? undefined : await files.read(file);
  if (bytes === undefined) {
    throw new StyleError({
      severity: "error",
      code: "file_missing",
      path,
      message: `theme.yaml names ${path}, which the package does not hold.`,
    });
  }
  return bytes;
}

async function cssOf(
  held: Held,
  files: FileStore,
  manifest: Manifest,
  prefix: string,
): Promise<Buffer | null> {
  const cssPaths = list(manifest.css).filter((p): p is string => typeof p === "string");
  if (cssPaths.length === 0) return null;
  const sources = [];
  for (const path of cssPaths) sources.push({ path, bytes: await read(held, files, path) });
  return Buffer.from(compileCss(sources, (path) => servedAt(held, path, prefix)));
}

/**
 * The tree as a revision serves it: each package image in `src` rewritten by `served` to its
 * served address (contracts/theming.md, The parsed tree), everything else as parsed.
 */
export function servedTree(
  tree: TemplateNode[],
  served: (path: string) => string | undefined,
  path = "templates/",
): TemplateNode[] {
  return tree.map((node): TemplateNode => {
    if ("section" in node) return { ...node, children: servedTree(node.children, served, path) };
    if (!("element" in node)) return node;
    const attrs = { ...node.attrs };
    const src = attrs.src?.[0];
    if (attrs.src?.length === 1 && src !== undefined && "text" in src) {
      const address = served(src.text);
      if (address === undefined) {
        throw new StyleError({
          severity: "error",
          code: "template_forbidden",
          path,
          message: `src names ${src.text}, which the package does not hold.`,
        });
      }
      attrs.src = [{ text: address }];
    }
    return node.children === undefined
      ? { element: node.element, attrs }
      : { element: node.element, attrs, children: servedTree(node.children, served, path) };
  });
}
