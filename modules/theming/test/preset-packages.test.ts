/**
 * The rules every preset of Pick a look keeps (plan issue-785 D10, Global constraints): a font
 * pair the platform holds, CSS the checks pass without a warning, text that reads over a
 * see-through box, no small screen text, and motion that is cheap, calm and still at `none`.
 * A later preset cannot break them without this file going red.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, walk } from "css-tree";
import type { CssNode, Declaration } from "css-tree";
import { describe, expect, it } from "vitest";
import { checkCss } from "../src/css.js";
import { BOX_OPACITY, boxContrastFailures, contrastRatio } from "../src/contrast.js";
import { FONT_PAIRS } from "../src/font-pairs.js";
import { PRESETS, schemeColors } from "../src/presets.js";
import type { Preset } from "../src/presets.js";
import { textSmallProblems } from "../src/readability.js";
import { parseTemplate } from "../src/template.js";

/** Black over the whole screen at its darkest point, by preset: Arcade's scanlines (arcade.css). */
const OVERLAY: Readonly<Record<string, number>> = { arcade: 0.3 };
const LEVELS = [".canccu-motion--calm", ".canccu-motion--lively", ".canccu-motion--party"];

/**
 * What the presets older than this test break, kept as they are (plan issue-785, Part 1 Task 2:
 * no existing look changes in this package) and named here so no other preset adds to them:
 * Level up's unlock pulse animates its shadow, and its ticker crawls at every level, `none` too;
 * Terminal and Level up set text under 27 px (their drafts warn `text_small`). Each is a
 * `Follow-up:` of the PR that added this file.
 */
const KNOWN = new Set([
  "level-up/css/cards.css: box-shadow",
  "level-up/css/cards.css: .t-ticker__track",
]);
const SMALL_TEXT_BEFORE = new Set(["terminal", "level-up"]);

interface Brand {
  font_pair?: string;
  box_opacity?: number;
}
const brandOf = (p: Preset): Brand => p.manifest.brand ?? {};
const cssPaths = (p: Preset): string[] =>
  Array.isArray(p.manifest.css) ? (p.manifest.css as string[]) : [];
const cssOf = (p: Preset, path: string): Buffer => readFileSync(join(p.dir, path));

/** `color` darkened by black at `alpha`, as the overlay draws it. */
function darkened(color: string, alpha: number): string {
  const c = [1, 3, 5].map((at) => Math.round(parseInt(color.slice(at, at + 2), 16) * (1 - alpha)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The text and status colours on the box, darkened together by the overlay. */
function overlayFailures(colors: Record<string, string>, alpha: number): string[] {
  const box = darkened(colors.surface ?? "", alpha);
  const pairs: [string, number][] = [
    ["text", 4.5],
    ["text_muted", 4.5],
    ["status_ok", 3],
    ["status_degraded", 3],
    ["status_down", 3],
  ];
  return pairs
    .filter(([fg, min]) => contrastRatio(darkened(colors[fg] ?? "", alpha), box) < min)
    .map(([fg]) => `${fg} on the box under the overlay`);
}

/** Every rule of a preset's CSS with its selector, and every declaration under a `@keyframes`. */
function parts(css: string): {
  rules: { selector: string; decls: Declaration[] }[];
  frames: Declaration[];
} {
  const ast = parse(css, { parseValue: false, parseCustomProperty: false });
  const rules: { selector: string; decls: Declaration[] }[] = [];
  const frames: Declaration[] = [];
  walk(ast, {
    enter(node: CssNode) {
      if (node.type === "Atrule" && node.name === "keyframes" && node.block !== null) {
        walk(node.block, (d) => {
          if (d.type === "Declaration") frames.push(d);
        });
      }
      if (node.type !== "Rule") return;
      const rule = node;
      const decls: Declaration[] = [];
      rule.block.children.forEach((d) => {
        if (d.type === "Declaration") decls.push(d);
      });
      const selector = rule.prelude.type === "Raw" ? rule.prelude.value : cssText(rule.prelude);
      rules.push({ selector, decls });
    },
  });
  // Keyframe selectors (`from`, `50%`) are no rules a level class could guard.
  return { rules: rules.filter((r) => !/^(from|to|[\d.]+%)/.test(r.selector.trim())), frames };
}

const cssText = (node: CssNode): string => {
  let out = "";
  walk(node, (n) => {
    if (n.type === "ClassSelector") out += `.${n.name}`;
    else if (n.type === "TypeSelector") out += n.name;
    else if (n.type === "Combinator" || n.type === "Selector") out += " ";
  });
  return out;
};

const value = (d: Declaration): string => (d.value.type === "Raw" ? d.value.value : "");

/** Every time in an `animation` shorthand, in seconds. */
const durations = (v: string): number[] =>
  [...v.matchAll(/(?<![\w-])([\d.]+)(m?s)\b/g)].map(
    (m) => Number(m[1]) / (m[2] === "ms" ? 1000 : 1),
  );

describe("every preset", () => {
  const presets = [...PRESETS.values()];

  it("names only a font pair the platform holds", () => {
    // Without a pair a preset keeps its own fonts or, as Default does, the device's.
    for (const p of presets) {
      const pair = brandOf(p).font_pair;
      if (pair !== undefined) expect(FONT_PAIRS.has(pair), `${p.id}: ${pair}`).toBe(true);
    }
  });

  it("has CSS that passes the checks with no warning", () => {
    for (const p of presets) {
      for (const path of cssPaths(p)) {
        expect(checkCss(path, cssOf(p, path)), `${p.id}/${path}`).toMatchObject({
          ok: true,
          warnings: [],
        });
      }
    }
  });

  it("has templates that pass the checks", () => {
    for (const p of presets) {
      const templates = (p.manifest.templates ?? {}) as Record<string, { file: string }>;
      for (const { file } of Object.values(templates)) {
        const result = parseTemplate(file, readFileSync(join(p.dir, file)));
        expect(result.ok ? "ok" : result.problem.message, `${p.id}/${file}`).toBe("ok");
      }
    }
  });

  it("keeps its text contrast over the box and under its overlay", () => {
    for (const p of presets) {
      const opacity = brandOf(p).box_opacity ?? BOX_OPACITY;
      for (const scheme of p.schemes) {
        const colors = schemeColors(scheme);
        const where = `${p.id}/${scheme.id}`;
        expect(boxContrastFailures(colors, opacity), where).toEqual([]);
        const overlay = OVERLAY[p.id];
        if (overlay !== undefined) expect(overlayFailures(colors, overlay), where).toEqual([]);
      }
    }
  });

  it("has no screen text under 27 px at 1080p", () => {
    for (const p of presets.filter((x) => !SMALL_TEXT_BEFORE.has(x.id))) {
      const files = cssPaths(p).map((path) => {
        const result = checkCss(path, cssOf(p, path));
        return { path, sizes: result.ok ? result.sizes : [] };
      });
      expect(textSmallProblems(files), p.id).toEqual([]);
    }
  });

  it("animates only transform and opacity", () => {
    for (const p of presets) {
      for (const path of cssPaths(p)) {
        const { frames } = parts(cssOf(p, path).toString("utf8"));
        const props = [...new Set(frames.map((d) => d.property))]
          .filter((prop) => !["transform", "opacity", "offset"].includes(prop))
          .map((prop) => `${p.id}/${path}: ${prop}`)
          .filter((x) => !KNOWN.has(x));
        expect(props).toEqual([]);
      }
    }
  });

  // A one-shot entrance may play at any level, as the player's own 400 ms crossfade does at
  // `none`: the rule is for what keeps moving, which must stop at `none` and stay slow.
  it("loops only at a motion level, and never faster than once a second", () => {
    const bad: string[] = [];
    for (const p of presets) {
      for (const path of cssPaths(p)) {
        for (const { selector, decls } of parts(cssOf(p, path).toString("utf8")).rules) {
          for (const d of decls.filter((x) => x.property === "animation")) {
            if (!/\binfinite\b/.test(value(d))) continue;
            const where = `${p.id}/${path}: ${selector.trim()}`;
            if (!LEVELS.some((l) => selector.includes(l))) bad.push(`${where} (no level)`);
            if (durations(value(d)).some((sec) => sec > 0 && sec < 1)) bad.push(`${where} (fast)`);
          }
        }
      }
    }
    expect(bad.filter((x) => !KNOWN.has(x.replace(/ \((no level|fast)\)$/, "")))).toEqual([]);
  });

  it("Esports keeps the emergency's red and the countdown's spotlight trace", () => {
    const esports = presets.find((p) => p.id === "esports");
    if (esports === undefined) throw new Error("no esports preset");
    const css = cssPaths(esports)
      .map((path) => cssOf(esports, path).toString("utf8"))
      .join("\n");
    // The slab ground is a theme-layer rule and would beat the base layer's fixed red.
    expect(css).toContain(".canccu-widget:not(:has(.canccu-widget__level--emergency)) {");
    // The sheen takes ::after, which the spotlight's trace draws on.
    const sheens = css.match(/\.canccu-widget--countdown[^{]*::after/g) ?? [];
    expect(sheens.length).toBe(3);
    for (const s of sheens) expect(s, s).toContain(":not(.canccu-spotlight--trace)");
  });
});
