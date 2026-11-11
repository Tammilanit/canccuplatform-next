/**
 * The small-text warning (contracts/theming.md, Advanced mode, Small text; plan D11): a static
 * check of a theme's CSS, never a render. Each CSS file keeps its font sizes from its upload
 * (`font_sizes`, migrations/008), so every draft change re-checks them without reading the file:
 * the root size one file sets changes what `rem` means in all the others.
 */
import * as csstree from "css-tree";
import type { CssNode, Rule, StyleSheet } from "css-tree";
import type { SqlClient } from "@canccu/kit";
import type { Manifest, Problem } from "./checks.js";
import { list } from "./checks.js";

/** One `font-size` (or the size of a `font` shorthand) as written, with the selectors it may apply to. */
export interface FontSize {
  selector: string;
  value: string;
  /** Set on `:root` or `html`: the root size `rem` resolves against. */
  root: boolean;
}

const SCREEN = { width: 1920, height: 1080 };
/** 2.5 % of the screen height. */
const MIN_PX = 27;
/** The platform sets no root or body size (packages/ui ui.css), so text inherits the browser's. */
const PLATFORM_PX = 16;
const MAX_WARNINGS = 10;

/** Absolute size keywords, as Chromium and Firefox resolve them at a 16 px medium. */
const KEYWORDS: Record<string, number> = {
  "xx-small": 9,
  "x-small": 10,
  small: 13,
  medium: 16,
  large: 18,
  "x-large": 24,
  "xx-large": 32,
  "xxx-large": 48,
};

const SURFACE = /^canccu-surface--(.+)$/;
const ROOT = /^(:root|html)$/i;

/** False when a top-level compound names another surface's class: `<body>` carries exactly one. */
function onScreen(selector: CssNode): boolean {
  if (selector.type !== "Selector") return true;
  for (const part of selector.children) {
    if (part.type !== "ClassSelector") continue;
    const surface = SURFACE.exec(csstree.ident.decode(part.name));
    if (surface !== null && surface[1] !== "screen") return false;
  }
  return true;
}

/** The node that gives a `font` shorthand its size: the first length, percentage, keyword or math. */
function shorthandSize(value: CssNode): CssNode | undefined {
  if (value.type !== "Value") return undefined;
  for (const node of value.children) {
    if (node.type === "Dimension" || node.type === "Percentage" || node.type === "Function") {
      return node;
    }
    if (node.type === "Identifier" && node.name.toLowerCase() in KEYWORDS) return node;
  }
  return undefined;
}

/** The font sizes of a parsed, checked style sheet, for `textSmallProblems`. */
export function fontSizes(ast: StyleSheet): FontSize[] {
  const out: FontSize[] = [];
  const visit = (nodes: Iterable<CssNode>, applies: boolean, nested: boolean): void => {
    for (const node of nodes) {
      if (node.type === "Atrule") {
        const name = node.name.toLowerCase();
        // A keyframe is no selector, and what it animates passes through sizes set elsewhere.
        if (node.block !== null && !name.endsWith("keyframes")) {
          visit(node.block.children, applies, nested);
        }
      } else if (node.type === "Rule") visitRule(node, applies, nested);
    }
  };
  const visitRule = (rule: Rule, parentApplies: boolean, nested: boolean): void => {
    const selectors =
      rule.prelude.type === "SelectorList" ? [...rule.prelude.children] : [rule.prelude];
    const kept = selectors.filter(onScreen).map((s) => csstree.generate(s));
    const applies = parentApplies && kept.length > 0;
    const selector = kept.join(", ");
    for (const node of rule.block.children) {
      if (node.type === "Rule") {
        visitRule(node, applies, true);
        continue;
      }
      if (node.type === "Atrule" && node.block !== null) {
        visit(node.block.children, applies, true);
        continue;
      }
      if (!applies || node.type !== "Declaration") continue;
      const property = node.property.toLowerCase();
      const size =
        property === "font-size"
          ? node.value
          : property === "font"
            ? shorthandSize(node.value)
            : undefined;
      if (size === undefined) continue;
      out.push({ selector, value: csstree.generate(size), root: !nested && ROOT.test(selector) });
    }
  };
  visit(ast.children, true, false);
  return out;
}

/** Pixels per unit on the screen; `rem` comes from the theme's root, `em` and `%` from the platform. */
function unitPx(unit: string, rootPx: number): number | undefined {
  const u = unit.toLowerCase();
  if (u === "px") return 1;
  if (u === "rem") return rootPx;
  if (u === "em") return PLATFORM_PX;
  if (u === "pt") return 4 / 3;
  if (u === "pc") return 16;
  if (u === "in") return 96;
  if (u === "cm") return 96 / 2.54;
  if (u === "mm") return 96 / 25.4;
  if (u === "q") return 96 / 101.6;
  const viewport = /^[sld]?v(h|w|b|i|min|max)$/.exec(u)?.[1];
  if (viewport === undefined) return undefined;
  const side =
    viewport === "w" || viewport === "i" || viewport === "max" ? SCREEN.width : SCREEN.height;
  return side / 100;
}

/** A length in px, or a plain number inside math; undefined for what cannot be resolved. */
type Quantity = { px: number } | { n: number };

/** css-tree keeps the spaces around `+` and `-` in the operator. */
const operator = (node: CssNode | undefined): string | undefined =>
  node?.type === "Operator" ? node.value.trim() : undefined;

function evaluate(nodes: CssNode[], rootPx: number): Quantity | undefined {
  const terms = nodes.filter((n) => n.type !== "WhiteSpace");
  let at = 0;
  const factor = (): Quantity | undefined => {
    const node = terms[at++];
    if (node === undefined) return undefined;
    switch (node.type) {
      case "Number":
        return { n: Number(node.value) };
      case "Percentage":
        return { px: (Number(node.value) / 100) * PLATFORM_PX };
      case "Dimension": {
        const per = unitPx(node.unit, rootPx);
        return per === undefined ? undefined : { px: Number(node.value) * per };
      }
      case "Parentheses":
        return evaluate([...node.children], rootPx);
      case "Function":
        return math(node.name.toLowerCase(), [...node.children], rootPx);
      default:
        return undefined;
    }
  };
  const product = (): Quantity | undefined => {
    let left = factor();
    while (left !== undefined) {
      const op = operator(terms[at]);
      if (op !== "*" && op !== "/") break;
      at++;
      const right = factor();
      if (right === undefined) return undefined;
      if (op === "*") {
        if ("n" in left && "n" in right) left = { n: left.n * right.n };
        else if ("n" in left && "px" in right) left = { px: left.n * right.px };
        else if ("px" in left && "n" in right) left = { px: left.px * right.n };
        else return undefined;
      } else {
        if (!("n" in right) || right.n === 0) return undefined;
        left = "n" in left ? { n: left.n / right.n } : { px: left.px / right.n };
      }
    }
    return left;
  };
  let total = product();
  while (total !== undefined && at < terms.length) {
    const op = operator(terms[at++]);
    if (op !== "+" && op !== "-") return undefined;
    const next = product();
    if (next === undefined || "n" in next !== "n" in total) return undefined;
    const sign = op === "+" ? 1 : -1;
    total =
      "n" in total
        ? { n: total.n + sign * (next as { n: number }).n }
        : { px: total.px + sign * (next as { px: number }).px };
  }
  return total;
}

/** calc(), min(), max() at the screen's size; clamp() at its minimum, as the contract asks. */
function math(name: string, children: CssNode[], rootPx: number): Quantity | undefined {
  const args: CssNode[][] = [[]];
  for (const node of children) {
    if (operator(node) === ",") args.push([]);
    else args[args.length - 1]?.push(node);
  }
  const values = args.map((a) => evaluate(a, rootPx));
  if (values.some((v) => v === undefined || !("px" in v))) return undefined;
  const px = (values as { px: number }[]).map((v) => v.px);
  if (name === "calc" && px.length === 1) return { px: px[0] as number };
  if (name === "min") return { px: Math.min(...px) };
  if (name === "max") return { px: Math.max(...px) };
  if (name === "clamp" && px.length === 3) return { px: px[0] as number };
  return undefined;
}

/** The size `value` gives on the screen, in px, or undefined when it cannot be resolved. */
function resolve(value: string, rootPx: number): number | undefined {
  let ast: CssNode;
  try {
    ast = csstree.parse(value, { context: "value" });
  } catch {
    return undefined;
  }
  if (ast.type !== "Value") return undefined;
  const nodes = [...ast.children].filter((n) => n.type !== "WhiteSpace");
  const only = nodes.length === 1 ? nodes[0] : undefined;
  if (only?.type === "Identifier") return KEYWORDS[only.name.toLowerCase()];
  // A bare 0 is a length; any other bare number is no font size.
  if (only?.type === "Number") return Number(only.value) === 0 ? 0 : undefined;
  const q = evaluate(nodes, rootPx);
  return q !== undefined && "px" in q ? q.px : undefined;
}

const px = (n: number): string => `${String(Math.round(n * 10) / 10)}px`;

/** The theme's CSS files in theme.yaml's order, each with the font sizes it set at upload. */
export function textSmallProblems(files: { path: string; sizes: FontSize[] }[]): Problem[] {
  // A root size is resolved against the platform's: `rem` and `em` on the root mean its initial size.
  let rootPx = PLATFORM_PX;
  for (const { sizes } of files) {
    for (const s of sizes) {
      if (!s.root) continue;
      const resolved = resolve(s.value, PLATFORM_PX);
      if (resolved !== undefined) rootPx = resolved;
    }
  }
  const out: Problem[] = [];
  for (const { path, sizes } of files) {
    const found: string[] = [];
    for (const s of sizes) {
      const size = resolve(s.value, s.root ? PLATFORM_PX : rootPx);
      // The root size is the scale `rem` reads, not text of its own, unless it shrinks the
      // platform's text below its own size.
      if (size === undefined || size >= (s.root ? PLATFORM_PX : MIN_PX)) continue;
      found.push(
        s.root
          ? `${s.selector}: font-size ${s.value} shrinks the platform's text to ${px(size)} on the screen, hard to read across a hall`
          : `${s.selector}: font-size ${s.value} is ${px(size)} on a 1920×1080 screen, under ${String(MIN_PX)}px (2.5 % of its height), hard to read across a hall`,
      );
    }
    const more = found.length - MAX_WARNINGS;
    const shown = found
      .slice(0, MAX_WARNINGS)
      .map((m, i) =>
        more > 0 && i === MAX_WARNINGS - 1 ? `${m} (and ${String(more)} more in this file)` : m,
      );
    out.push(
      ...shown.map((message): Problem => ({
        severity: "warning",
        code: "text_small",
        path,
        message: `${message}.`,
      })),
    );
  }
  return out;
}

/** `text_small` for the draft: the CSS files theme.yaml lists, in its order, as stored. */
export async function readabilityProblems(c: SqlClient, manifest: Manifest): Promise<Problem[]> {
  const order = list(manifest.css).filter((p): p is string => typeof p === "string");
  if (order.length === 0) return [];
  const { rows } = await c.query(
    `SELECT path, font_sizes FROM theming_package_files
      WHERE owner = 'draft' AND file IS NOT NULL AND path = ANY($1::text[])`,
    [order],
  );
  const byPath = new Map(
    (rows as { path: string; font_sizes: FontSize[] }[]).map((r) => [r.path, r.font_sizes]),
  );
  return textSmallProblems(
    order.flatMap((path) => {
      const sizes = byPath.get(path);
      return sizes === undefined ? [] : [{ path, sizes }];
    }),
  );
}
