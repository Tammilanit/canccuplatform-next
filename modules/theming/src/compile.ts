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
  const { rows } = await c.query(
    `SELECT path, file FROM theming_package_files WHERE owner = $1 AND file IS NOT NULL`,
    [source],
  );
  const held = new Map((rows as { path: string; file: string }[]).map((r) => [r.path, r.file]));
  // Only what the served paths answer: an image or a font, never a template's or licence's text.
  const served = (path: string): string | undefined => {
    const file = held.get(path);
    return file !== undefined && FILE_NAME.test(file) ? SERVED + file : undefined;
  };
  const read = async (path: string): Promise<Buffer> => {
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
  };

  const cssPaths = list(manifest.css).filter((p): p is string => typeof p === "string");
  let css: string | null = null;
  if (cssPaths.length > 0) {
    const sources = [];
    for (const path of cssPaths) sources.push({ path, bytes: await read(path) });
    css = await files.put(c, Buffer.from(compileCss(sources, served)), "css");
  }

  const templates: ParsedTemplate[] = [];
  for (const [name, spec] of Object.entries(
    isObject(manifest.templates) ? manifest.templates : {},
  )) {
    if (!isObject(spec) || typeof spec.file !== "string" || typeof spec.widget !== "string")
      continue;
    const parsed = parseTemplate(spec.file, await read(spec.file));
    if (!parsed.ok) throw new StyleError(parsed.problem);
    templates.push({ name, widget: spec.widget, tree: servedTree(parsed.tree, served, spec.file) });
  }
  return { css, templates };
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
