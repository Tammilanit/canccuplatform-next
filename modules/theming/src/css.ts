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
import { fontSizes } from "./readability.js";
import type { FontSize } from "./readability.js";
import { IMAGE, plainPath, readText } from "./text.js";

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

/**
 * Functions that take a URL as a string, which would pass by the url() rules. Inside them a string
 * is refused (but in `type()`), and so is a value filled in at use, which may be a string held in a
 * custom property.
 */
const STRING_URL_FUNCTIONS = new Set([
  "image-set",
  "-webkit-image-set",
  "image",
  "src",
  "cross-fade",
  "-webkit-cross-fade",
]);

/** The package's fonts, by their package paths (as in theme.yaml). */
const FONT = /^fonts\/[A-Za-z0-9._/-]+\.woff2$/i;

const FILLED_IN = new Set(["var", "env", "attr"]);

const MAX_REASONS = 5;
const MAX_CLASSES = 10;

export type CssResult =
  | { ok: true; refs: string[]; warnings: Problem[]; sizes: FontSize[] }
  | { ok: false; problem: Problem };

interface Inspected {
  ast: StyleSheet;
  refs: string[];
  /** Where each of `refs` is first named. */
  refsAt: Map<string, { line?: number; column?: number }>;
  warnings: Problem[];
}

/** One refused rule, where it is. */
interface Reason {
  why: string;
  line: number | undefined;
  column: number | undefined;
}

/** A refused file: its one problem, and each reason on its own for the editor (plan issue-784 D15). */
interface Refused {
  problem: Problem;
  reasons: Problem[];
}

const located = (line: number | undefined, column: number | undefined) => ({
  ...(line === undefined ? {} : { line }),
  ...(column === undefined ? {} : { column }),
});

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

function inspect(path: string, bytes: Buffer): Inspected | Refused {
  const refuse = (message: string, code = "css_forbidden"): Refused => {
    const problem: Problem = { severity: "error", code, path, message };
    return { problem, reasons: [problem] };
  };
  if (bytes.length > CSS_LIMIT) return refuse("CSS is at most 256 KB.", "file_too_large");
  const text = readText(bytes);
  if (text === undefined) return refuse("Refused: CSS is UTF-8 text without control characters.");

  const reasons: Reason[] = [];
  const fail = (line: number | undefined, why: string, column?: number): void => {
    if (!reasons.some((r) => r.line === line && r.why === why)) reasons.push({ why, line, column });
  };
  const at = (node: CssNode): [number | undefined, number | undefined] => [
    node.loc?.start.line,
    node.loc?.start.column,
  ];
  let ast: CssNode;
  try {
    ast = csstree.parse(text, {
      positions: true,
      parseCustomProperty: true,
      onParseError: (err) => {
        const { line, column } = err as { line?: number; column?: number };
        fail(line, `the CSS does not parse (${err.message})`, column);
      },
    });
  } catch (err) {
    return refuse(`Refused: the CSS does not parse (${(err as Error).message}).`);
  }

  const refs: string[] = [];
  const refsAt: Inspected["refsAt"] = new Map();
  const unstable = new Map<string, number | undefined>();
  csstree.walk(ast, function (this: WalkContext, node: CssNode) {
    const [line, column] = at(node);
    switch (node.type) {
      case "Atrule": {
        const name = plain(node.name);
        if (!AT_RULES.has(name)) fail(line, `@${name} is not allowed`, column);
        else if (name === "charset") {
          const given = node.prelude === null ? "" : csstree.generate(node.prelude);
          if (!/^"utf-8"$/i.test(given)) fail(line, "@charset may only be UTF-8", column);
        }
        break;
      }
      case "Declaration":
        if (/^(-[a-z]+-)?(behavior|binding)$/.test(plain(node.property))) {
          fail(line, `${plain(node.property)} is not allowed`, column);
        }
        break;
      case "Function": {
        const name = plain(node.name);
        if (/(^|-)expression$/.test(name)) fail(line, "expression() is not allowed", column);
        if (name === "local")
          fail(line, "local() is not allowed: @font-face takes package fonts", column);
        // An escaped `url(` is still a URL to the browser, though not to the parser.
        if (name === "url") fail(line, "url() must be written without escapes", column);
        // Every level below, not only its own arguments: image-set(var(--u) 1x) is a string URL.
        if (STRING_URL_FUNCTIONS.has(name)) {
          csstree.walk(node, function (this: WalkContext, inner: CssNode) {
            const [where, col] = at(inner);
            const nearest = this.function === null ? "" : plain(this.function.name);
            if (inner.type === "String" && nearest !== "type") {
              fail(where, `${name}() takes images only as url()`, col);
            }
            if (inner.type === "Function" && FILLED_IN.has(plain(inner.name))) {
              fail(where, `${name}() takes images only as url(), not ${plain(inner.name)}()`, col);
            }
          });
        }
        break;
      }
      case "Url": {
        const inFontFace = this.atrule !== null && plain(this.atrule.name) === "font-face";
        const ref = packageUrl(node.value, inFontFace);
        if (ref === undefined) {
          fail(
            line,
            `url(${node.value}) is not a package ${inFontFace ? "font (fonts/…woff2)" : "image (images/…)"}`,
            column,
          );
        } else if (!refs.includes(ref)) {
          refs.push(ref);
          refsAt.set(ref, located(line, column));
        }
        break;
      }
      case "Raw":
        if (!/^[\s;]*$/.test(node.value)) fail(line, "the CSS does not parse here", column);
        break;
      case "ClassSelector": {
        const name = csstree.ident.decode(node.name);
        if (!isStableClass(name) && !isThemeClass(name) && !unstable.has(name))
          unstable.set(name, line);
        break;
      }
    }
  });
  const all = unescaped(text);
  if (all.includes("javascript:")) fail(undefined, "javascript: is not allowed anywhere");
  if (/expression\s*\(/.test(all) && !reasons.some((r) => r.why.includes("expression()"))) {
    fail(undefined, "expression() is not allowed anywhere");
  }
  if (reasons.length > 0) {
    const more = reasons.length > MAX_REASONS ? ` (and ${reasons.length - MAX_REASONS} more)` : "";
    const said = reasons.map((r) => (r.line === undefined ? r.why : `line ${r.line}: ${r.why}`));
    const first = reasons.find((r) => r.line !== undefined);
    const problem: Problem = {
      severity: "error",
      code: "css_forbidden",
      path,
      message: `Refused: ${said.slice(0, MAX_REASONS).join("; ")}${more}.`,
      ...located(first?.line, first?.column),
    };
    return {
      problem,
      reasons: reasons.map((r) => ({
        severity: "error",
        code: "css_forbidden",
        path,
        message: `Refused: ${r.why}.`,
        ...located(r.line, r.column),
      })),
    };
  }

  const warnings: Problem[] = [];
  if (unstable.size > 0) {
    const names = [...unstable.keys()];
    const more = names.length > MAX_CLASSES ? ` and ${names.length - MAX_CLASSES} more` : "";
    warnings.push({
      severity: "warning",
      code: "class_unstable",
      path,
      message: `Styles classes that are neither stable nor t-: ${names.slice(0, MAX_CLASSES).join(", ")}${more}; they may change in any release.`,
      ...located(unstable.values().next().value, undefined),
    });
  }
  return { ast: ast as StyleSheet, refs, refsAt, warnings };
}

/**
 * The checks of one CSS file, with what the draft's checks need of it: the package files its
 * url()s name and its font sizes (readability.ts).
 */
export function checkCss(path: string, bytes: Buffer): CssResult {
  const inspected = inspect(path, bytes);
  return "ast" in inspected
    ? {
        ok: true,
        refs: inspected.refs,
        warnings: inspected.warnings,
        sizes: fontSizes(inspected.ast),
      }
    : { ok: false, problem: inspected.problem };
}

/**
 * The checks of one CSS file as the editor shows them (plan issue-784 D15): each refused rule on
 * its own with its line, or, when it passes, what `checkCss` keeps of it.
 */
export function cssReasons(
  path: string,
  bytes: Buffer,
):
  | { ok: true; refsAt: Inspected["refsAt"]; warnings: Problem[]; sizes: FontSize[] }
  | { ok: false; reasons: Problem[] } {
  const inspected = inspect(path, bytes);
  if (!("ast" in inspected)) return { ok: false, reasons: inspected.reasons };
  return {
    ok: true,
    refsAt: inspected.refsAt,
    warnings: inspected.warnings,
    sizes: fontSizes(inspected.ast),
  };
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
    if (!("ast" in inspected)) throw new StyleError(inspected.problem);
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
