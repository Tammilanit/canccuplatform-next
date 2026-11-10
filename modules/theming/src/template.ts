/**
 * Widget templates (contracts/theming.md, Widget templates and The parsed tree; plan area H): the
 * Mustache subset inside the HTML subset, parsed at upload into the tree every surface renders, so
 * no surface ever parses template text and data never becomes markup.
 *
 * Mustache tags are found in the raw text first, so an entity such as `&#123;` can never make one.
 * Each tag is then replaced by a private-use marker and the HTML parsed with `parse5` twice: the
 * first pass tells a tag in text from one in an attribute value; the second has each tag in text as
 * an HTML comment, which the parser keeps where it stands even inside a table, where text would be
 * moved out of it.
 */
import { html, parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import type { Problem } from "./checks.js";
import { isStableClass, isThemeClass } from "./classes.js";
import { StyleError } from "./css.js";
import { plainPath, readText } from "./text.js";

type ChildNode = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

export const TEMPLATE_LIMIT = 32 * 1024;
const MAX_SECTIONS = 8;
/** Not the contract's: a bound on the tree's depth, so neither the checks nor a renderer recurse without end. */
const MAX_ELEMENTS = 32;

const ELEMENTS = new Set(
  "div span p h1 h2 h3 h4 ul ol li strong em b i small br img figure figcaption time table thead tbody tr th td".split(
    " ",
  ),
);
const VOID = new Set(["br", "img"]);
const ATTRIBUTES = new Set([
  "class",
  "alt",
  "aria-label",
  "aria-hidden",
  "datetime",
  "colspan",
  "rowspan",
  "src",
]);
/** TemplateNode `field` of contracts/theming.openapi.yaml. */
const NAME = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/;
const IMAGE = /^images\/[A-Za-z0-9._/-]+\.(png|jpe?g|webp|svg)$/i;
/**
 * A field the widget documents as an image address. Until the screen contract names each widget's
 * fields, the convention is the name: `url` or ending in `_url` (`image_url`, `qr_url`).
 */
const IMAGE_FIELD = /(^|[._])url$/;

const MARK_OPEN = "";
const MARK_CLOSE = "";
const MARK = /(\d+)/g;
const mark = (i: number): string => `${MARK_OPEN}${i}${MARK_CLOSE}`;

export type TemplateNode =
  | { text: string }
  | { field: string }
  | { section: string; inverted: boolean; children: TemplateNode[] }
  | { element: string; attrs: Record<string, TemplateNode[]>; children?: TemplateNode[] };

export type TemplateResult =
  { ok: true; tree: TemplateNode[]; refs: string[] } | { ok: false; problem: Problem };

interface Tag {
  kind: "field" | "open" | "close";
  inverted: boolean;
  name: string;
  line: number;
  raw: string;
}

class Refusal extends Error {}

function refuse(line: number | undefined, why: string): never {
  throw new Refusal(line === undefined ? why : `line ${line}: ${why}`);
}

/** The text with every Mustache tag replaced by its marker, and the tags; comments dropped. */
function tokenize(text: string): { marked: string; tags: Tag[] } {
  const tags: Tag[] = [];
  let marked = "";
  let at = 0;
  let line = 1;
  let counted = 0;
  for (;;) {
    const start = text.indexOf("{{", at);
    if (start < 0) return { marked: marked + text.slice(at), tags };
    marked += text.slice(at, start);
    line += text.slice(counted, start).split("\n").length - 1;
    counted = start;
    const end = text.indexOf("}}", start + 2);
    if (text[start + 2] === "{") refuse(line, "{{{ }}} (unescaped output) is not allowed");
    if (end < 0) refuse(line, "a {{ is not closed");
    const inner = text.slice(start + 2, end);
    const raw = `{{${inner}}}`;
    at = end + 2;
    const body = inner.trimStart();
    const sigil = body[0] ?? "";
    if (sigil === "!") {
      // Its line breaks stay, so the parser's lines are still the template's.
      marked += "\n".repeat(inner.split("\n").length - 1);
      continue;
    }
    if ("&>{<=$".includes(sigil) && sigil !== "") refuse(line, `{{${sigil} … }} is not allowed`);
    const section = sigil === "#" || sigil === "^" || sigil === "/";
    const name = (section ? body.slice(1) : body).trim();
    if (name === ".") refuse(line, "{{.}} is not allowed: name the field");
    if (!NAME.test(name)) {
      refuse(line, `${raw} names no field (lowercase snake_case names joined by dots)`);
    }
    const kind = !section ? "field" : sigil === "/" ? "close" : "open";
    tags.push({ kind, inverted: sigil === "^", name, line, raw });
    marked += mark(tags.length - 1);
  }
}

/** Where each tag stands after the first parse: in text or in an attribute's value. */
function contexts(marked: string, tags: Tag[]): ("text" | "attr")[] {
  const found: ("text" | "attr" | "twice" | undefined)[] = tags.map(() => undefined);
  const note = (value: string, where: "text" | "attr"): void => {
    for (const m of value.matchAll(MARK)) {
      const i = Number(m[1]);
      found[i] = found[i] === undefined ? where : "twice";
    }
  };
  const walk = (nodes: ChildNode[]): void => {
    for (const node of nodes) {
      if (node.nodeName === "#text") note((node as { value: string }).value, "text");
      if (!("tagName" in node)) continue;
      for (const attr of node.attrs) note(attr.value, "attr");
      walk(node.childNodes);
    }
  };
  walk(parseFragment(marked).childNodes);
  return found.map((where, i) => {
    const tag = tags[i] as Tag;
    // The parser copies a misnested <b> or <em> with its attributes, and their tags with them.
    if (where === "twice")
      refuse(tag.line, `the elements around ${tag.raw} are not nested properly`);
    if (where === undefined) {
      refuse(
        tag.line,
        `${tag.raw} stands where no tag can: inside an element's tag or an HTML comment`,
      );
    }
    return where;
  });
}

/** Builds one list of nodes, folding the tags into sections that must close within it. */
class Folder {
  private readonly root: TemplateNode[] = [];
  private readonly stack: { tag: Tag; children: TemplateNode[] }[] = [];

  constructor(private readonly outer: number) {}

  get depth(): number {
    return this.outer + this.stack.length;
  }

  push(node: TemplateNode): void {
    const target = this.stack.at(-1)?.children ?? this.root;
    const last = target.at(-1);
    if ("text" in node && last !== undefined && "text" in last) last.text += node.text;
    else target.push(node);
  }

  tag(tag: Tag): void {
    if (tag.kind === "field") {
      this.push({ field: tag.name });
      return;
    }
    if (tag.kind === "open") {
      if (this.depth >= MAX_SECTIONS)
        refuse(tag.line, `sections nest at most ${MAX_SECTIONS} deep`);
      const children: TemplateNode[] = [];
      this.push({ section: tag.name, inverted: tag.inverted, children });
      this.stack.push({ tag, children });
      return;
    }
    const top = this.stack.pop();
    if (top === undefined) refuse(tag.line, `${tag.raw} closes no section opened in its element`);
    if (top.tag.name !== tag.name) refuse(tag.line, `${tag.raw} closes ${top.tag.raw}`);
  }

  end(): TemplateNode[] {
    const open = this.stack.at(-1);
    if (open !== undefined)
      refuse(open.tag.line, `${open.tag.raw} is not closed within its element`);
    return this.root;
  }
}

interface Context {
  tags: Tag[];
  refs: string[];
}

/** `class`: whole names, stable or `t-`; data may only lengthen a literal `t-` name. */
function checkClass(nodes: TemplateNode[], line: number | undefined): void {
  let literal = "";
  let head: string | undefined;
  let open = false;
  let afterSection = false;
  const finish = (): void => {
    if (open && head !== undefined && !head.startsWith("t-")) {
      refuse(line, `the class ${head}… takes data only after a literal t- prefix`);
    }
    if (open && head === undefined && !isStableClass(literal) && !isThemeClass(literal)) {
      refuse(line, `the class ${literal} is neither stable nor t-`);
    }
    [literal, head, open] = ["", undefined, false];
  };
  const apart = (): never =>
    refuse(line, "a section in class holds whole class names, set apart by spaces");
  for (const node of nodes) {
    if ("text" in node) {
      for (const ch of node.text) {
        if (/\s/.test(ch)) {
          finish();
          afterSection = false;
        } else {
          if (afterSection) apart();
          literal += ch;
          open = true;
        }
      }
    } else if ("field" in node) {
      if (!open) refuse(line, "a class name takes data only after a literal t- prefix");
      head ??= literal;
    } else if ("section" in node) {
      if (open || afterSection) apart();
      checkClass(node.children, line);
      afterSection = true;
    }
  }
  finish();
}

/** `src` on `img`: one package image, or one field the widget documents as an image address. */
function checkSrc(nodes: TemplateNode[], line: number | undefined, refs: string[]): void {
  const only = nodes.length === 1 ? nodes[0] : undefined;
  if (only !== undefined && "field" in only && IMAGE_FIELD.test(only.field)) return;
  if (only !== undefined && "text" in only && IMAGE.test(only.text) && plainPath(only.text)) {
    if (!refs.includes(only.text)) refs.push(only.text);
    return;
  }
  refuse(line, "src takes a package image (images/…) or one image address field (…_url)");
}

function attrValue(value: string, sections: number, ctx: Context): TemplateNode[] {
  const folder = new Folder(sections);
  let last = 0;
  for (const m of value.matchAll(MARK)) {
    if (m.index > last) folder.push({ text: value.slice(last, m.index) });
    folder.tag(ctx.tags[Number(m[1])] as Tag);
    last = m.index + m[0].length;
  }
  if (last < value.length) folder.push({ text: value.slice(last) });
  return folder.end();
}

function element(node: Element, sections: number, depth: number, ctx: Context): TemplateNode {
  const line = node.sourceCodeLocation?.startLine;
  const name = node.tagName;
  if (node.namespaceURI !== html.NS.HTML || !ELEMENTS.has(name)) {
    refuse(line, `<${name}> is not allowed`);
  }
  if (depth >= MAX_ELEMENTS) refuse(line, `elements nest at most ${MAX_ELEMENTS} deep`);
  const attrs: Record<string, TemplateNode[]> = {};
  for (const attr of node.attrs) {
    if (
      attr.namespace !== undefined ||
      !ATTRIBUTES.has(attr.name) ||
      (attr.name === "src" && name !== "img")
    ) {
      refuse(line, `the attribute ${attr.name} is not allowed on <${name}>`);
    }
    const value = attrValue(attr.value, sections, ctx);
    if (attr.name === "class") checkClass(value, line);
    if (attr.name === "src") checkSrc(value, line, ctx.refs);
    attrs[attr.name] = value;
  }
  if (VOID.has(name)) return { element: name, attrs };
  return { element: name, attrs, children: children(node.childNodes, sections, depth + 1, ctx) };
}

function children(
  nodes: ChildNode[],
  sections: number,
  depth: number,
  ctx: Context,
): TemplateNode[] {
  const folder = new Folder(sections);
  for (const node of nodes) {
    const line = (node as { sourceCodeLocation?: { startLine: number } | null }).sourceCodeLocation
      ?.startLine;
    if (node.nodeName === "#text") {
      const value = (node as { value: string }).value;
      // Only inside an element that keeps its text raw (script, style, textarea), refused anyway.
      if (value.includes(MARK_OPEN)) refuse(line, "a tag stands where no tag can");
      folder.push({ text: value });
    } else if (node.nodeName === "#comment") {
      const m = /^(\d+)$/.exec((node as { data: string }).data);
      if (m === null) refuse(line, "HTML comments are not allowed; use {{! … }}");
      folder.tag(ctx.tags[Number(m[1])] as Tag);
    } else if ("tagName" in node) {
      folder.push(element(node, folder.depth, depth, ctx));
    } else {
      refuse(line, `${node.nodeName} is not allowed`);
    }
  }
  return folder.end();
}

/** Parses and checks one template; the tree, and the package images it names. */
export function parseTemplate(path: string, bytes: Buffer): TemplateResult {
  const problem = (code: string, message: string): TemplateResult => ({
    ok: false,
    problem: { severity: "error", code, path, message },
  });
  if (bytes.length > TEMPLATE_LIMIT)
    return problem("file_too_large", "A template is at most 32 KB.");
  const text = readText(bytes);
  if (text === undefined) {
    return problem(
      "template_forbidden",
      "Refused: a template is UTF-8 text without control characters.",
    );
  }
  if (text.includes(MARK_OPEN) || text.includes(MARK_CLOSE)) {
    return problem(
      "template_forbidden",
      "Refused: the private-use characters U+E000 and U+E001 are not allowed.",
    );
  }
  try {
    const { marked, tags } = tokenize(text);
    const where = contexts(marked, tags);
    const second = marked.replace(MARK, (m, i: string) =>
      where[Number(i)] === "text" ? `<!--${m}-->` : m,
    );
    const ctx: Context = { tags, refs: [] };
    const fragment = parseFragment(second, { sourceCodeLocationInfo: true });
    return { ok: true, tree: children(fragment.childNodes, 0, 0, ctx), refs: ctx.refs };
  } catch (err) {
    if (err instanceof Refusal) return problem("template_forbidden", `Refused: ${err.message}.`);
    throw err;
  }
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
