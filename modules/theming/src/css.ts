/**
 * A theme's CSS (contracts/theming.md, Advanced mode, CSS rules; plan area G): checked with
 * `css-tree` at upload, every failure one `css_forbidden` problem, and compiled at publish into one
 * file in `@layer canccu-theme`, generated again from the parsed tree so no text of the upload can
 * close the layer early.
 */
import * as csstree from "css-tree";
import type { CssNode, StyleSheet, WalkContext } from "css-tree";
import type { Problem } from "./checks.js";
import { isStableClass, isThemeClass } from "./classes.js";
import { plainPath, readText } from "./text.js";

/** `css/` takes 256 KB together (The theme package), so no one file passes it either. */
export const CSS_LIMIT = 256 * 1024;

/**
 * An allow-list, stricter than the contract's three forbidden at-rules: what the demo themes and
 * ordinary theming use. `@property` registers a property for the whole page, past any layer.
 */
const AT_RULES = new Set([
  "charset",
  "media",
  "supports",
  "container",
  "layer",
  "keyframes",
  "-webkit-keyframes",
  "font-face",
]);

/** Functions that take a URL as a string, which would pass by the url() rules. */
const STRING_URL_FUNCTIONS = new Set([
  "image-set",
  "-webkit-image-set",
  "image",
  "src",
  "cross-fade",
  "-webkit-cross-fade",
]);

/** The package's images and fonts, by their package paths (as in theme.yaml). */
const IMAGE = /^images\/[A-Za-z0-9._/-]+\.(png|jpe?g|webp|svg)$/i;
const FONT = /^fonts\/[A-Za-z0-9._/-]+\.woff2$/i;

const MAX_REASONS = 5;
const MAX_CLASSES = 10;

export type CssResult =
  { ok: true; refs: string[]; warnings: Problem[] } | { ok: false; problem: Problem };

interface Inspected {
  ast: StyleSheet;
  refs: string[];
  warnings: Problem[];
}

/** Names as the browser reads them: CSS escapes resolved, ASCII case folded. */
const plain = (name: string): string => csstree.ident.decode(name).toLowerCase();

/** The whole text with its escapes resolved, for the rules that hold "anywhere". */
function unescaped(text: string): string {
  return text
    .replace(/\\\r?\n/g, "")
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?/g, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
    })
    .replace(/\\(.)/g, "$1")
    .toLowerCase();
}

function packageUrl(value: string, inFontFace: boolean): string | undefined {
  const pattern = inFontFace ? FONT : IMAGE;
  return pattern.test(value) && plainPath(value) ? value : undefined;
}

function inspect(path: string, bytes: Buffer): Inspected | Problem {
  const refuse = (message: string, code = "css_forbidden"): Problem => ({
    severity: "error",
    code,
    path,
    message,
  });
  if (bytes.length > CSS_LIMIT) return refuse("CSS is at most 256 KB.", "file_too_large");
  const text = readText(bytes);
  if (text === undefined) return refuse("Refused: CSS is UTF-8 text without control characters.");

  const reasons: string[] = [];
  const fail = (line: number | undefined, why: string): void => {
    reasons.push(line === undefined ? why : `line ${line}: ${why}`);
  };
  let ast: CssNode;
  try {
    ast = csstree.parse(text, {
      positions: true,
      parseCustomProperty: true,
      onParseError: (err) => {
        const line = (err as { line?: number }).line;
        fail(line, `the CSS does not parse (${err.message})`);
      },
    });
  } catch (err) {
    return refuse(`Refused: the CSS does not parse (${(err as Error).message}).`);
  }

  const refs: string[] = [];
  const unstable = new Set<string>();
  csstree.walk(ast, function (this: WalkContext, node: CssNode) {
    const line = node.loc?.start.line;
    const fn = this.function === null ? undefined : plain(this.function.name);
    switch (node.type) {
      case "Atrule": {
        const name = plain(node.name);
        if (!AT_RULES.has(name)) fail(line, `@${name} is not allowed`);
        else if (name === "charset") {
          const given = node.prelude === null ? "" : csstree.generate(node.prelude);
          if (!/^"utf-8"$/i.test(given)) fail(line, "@charset may only be UTF-8");
        }
        break;
      }
      case "Declaration":
        if (/^(-[a-z]+-)?(behavior|binding)$/.test(plain(node.property))) {
          fail(line, `${plain(node.property)} is not allowed`);
        }
        break;
      case "Function": {
        const name = plain(node.name);
        if (/(^|-)expression$/.test(name)) fail(line, "expression() is not allowed");
        if (name === "local") fail(line, "local() is not allowed: @font-face takes package fonts");
        // An escaped `url(` is still a URL to the browser, though not to the parser.
        if (name === "url") fail(line, "url() must be written without escapes");
        break;
      }
      case "String":
        if (fn !== undefined && STRING_URL_FUNCTIONS.has(fn)) {
          fail(line, `${fn}() takes images only as url()`);
        }
        break;
      case "Url": {
        const inFontFace = this.atrule !== null && plain(this.atrule.name) === "font-face";
        const ref = packageUrl(node.value, inFontFace);
        if (ref === undefined) {
          fail(
            line,
            `url(${node.value}) is not a package ${inFontFace ? "font (fonts/…woff2)" : "image (images/…)"}`,
          );
        } else if (!refs.includes(ref)) refs.push(ref);
        break;
      }
      case "Raw":
        if (!/^[\s;]*$/.test(node.value)) fail(line, "the CSS does not parse here");
        break;
      case "ClassSelector": {
        const name = csstree.ident.decode(node.name);
        if (!isStableClass(name) && !isThemeClass(name)) unstable.add(name);
        break;
      }
    }
  });
  const all = unescaped(text);
  if (all.includes("javascript:")) fail(undefined, "javascript: is not allowed anywhere");
  if (/expression\s*\(/.test(all) && !reasons.some((r) => r.includes("expression()"))) {
    fail(undefined, "expression() is not allowed anywhere");
  }
  if (reasons.length > 0) {
    const more = reasons.length > MAX_REASONS ? ` (and ${reasons.length - MAX_REASONS} more)` : "";
    return refuse(`Refused: ${reasons.slice(0, MAX_REASONS).join("; ")}${more}.`);
  }

  const warnings: Problem[] = [];
  if (unstable.size > 0) {
    const names = [...unstable];
    const more = names.length > MAX_CLASSES ? ` and ${names.length - MAX_CLASSES} more` : "";
    warnings.push({
      severity: "warning",
      code: "class_unstable",
      path,
      message: `Styles classes that are neither stable nor t-: ${names.slice(0, MAX_CLASSES).join(", ")}${more}; they may change in any release.`,
    });
  }
  return { ast: ast as StyleSheet, refs, warnings };
}

/** The checks of one CSS file, and the package files its url()s name (for the draft's checks). */
export function checkCss(path: string, bytes: Buffer): CssResult {
  const inspected = inspect(path, bytes);
  return "ast" in inspected
    ? { ok: true, refs: inspected.refs, warnings: inspected.warnings }
    : { ok: false, problem: inspected };
}

/** A revision's CSS that cannot be compiled: publish answers it as `theme_invalid`. */
export class StyleError extends Error {
  constructor(readonly problem: Problem) {
    super(`${problem.path ?? ""}: ${problem.message}`);
  }
}

/**
 * A revision's CSS, its files in theme.yaml's order, as one file in `@layer canccu-theme`, each
 * url() rewritten by `served` from its package path to the served address. Checked again here, so
 * a publish never ships what the checks of its own version refuse.
 */
export function compileCss(
  files: { path: string; bytes: Buffer }[],
  served: (path: string) => string | undefined,
): string {
  const parts = files.map(({ path, bytes }) => {
    const inspected = inspect(path, bytes);
    if (!("ast" in inspected)) throw new StyleError(inspected);
    csstree.walk(inspected.ast, (node, item, list) => {
      if (node.type === "Url") {
        const address = served(node.value);
        if (address === undefined) {
          throw new StyleError({
            severity: "error",
            code: "css_forbidden",
            path,
            message: `url(${node.value}) names a file the package does not hold.`,
          });
        }
        node.value = address;
      } else if (
        node.type === "Comment" ||
        (node.type === "Atrule" && plain(node.name) === "charset")
      ) {
        // Inside a layer @charset is invalid, and comments are no part of the look.
        list.remove(item);
      }
    });
    return csstree.generate(inspected.ast);
  });
  return `@layer canccu-theme{${parts.filter((p) => p !== "").join("\n")}}`;
}
