import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(new URL(`../player/src/${file}`, import.meta.url), "utf8");
const css = read("screen.css");
/** The built-in look's sheets: the frame and unit, each widget's look, the claims. */
const SHEETS = ["screen.css", "widgets.css", "claims.css"] as const;
const looks = SHEETS.map(read).join("\n");
/** The rules alone: the comments name what the rules must not hold. */
const rules = looks.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the screen's stylesheet", () => {
  it("sizes all text relative to the layout's short side, at least 2.6 % of it (readable at 20 m)", () => {
    // theming.md, Advanced mode: under 2.5 % of the screen height (27 px at 1080p) is hard to read
    // across a hall. `--canccu-u` is 1 % of the layout's short side, so 1080p and 4K, landscape and
    // portrait read alike.
    const sizes = [...looks.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]?.trim() ?? "");
    expect(sizes.length).toBeGreaterThan(5);
    for (const size of sizes) {
      const value = /^calc\(([\d.]+) \* var\(--canccu-u\)\)$/.exec(size);
      expect(value, size).not.toBeNull();
      expect(Number(value?.[1]), size).toBeGreaterThanOrEqual(2.6);
    }
  });

  it("measures its unit on the layout, so a theme's own containers do not shrink the text", () => {
    // A bare `cqmin` would read the nearest container: a theme's widget, if the theme makes it one.
    expect(css).toMatch(/@property --canccu-u \{[^}]*syntax: "<length>";[^}]*inherits: true;/);
    expect(css).toMatch(/\.canccu-layout > \* \{\s*--canccu-u: 1cqmin;\s*\}/);
    expect(rules.replace(/--canccu-u: 1cqmin/, "")).not.toMatch(/\dcq(min|w|h|i|b|max)\b/);
  });

  it("sits in the platform's base layer, so a theme's CSS overrides it without !important", () => {
    const comment = String.raw`\/\*[\s\S]*?\*\/\s*`;
    const unit = String.raw`@property --canccu-u \{[^}]*\}\s*`;
    const layered = String.raw`@layer canccu-base \{[\s\S]*\}\s*$`;
    expect(css).toMatch(new RegExp(`^(${comment})*${unit}(${comment})*${layered}`));
    for (const file of SHEETS.slice(1)) {
      expect(read(file), file).toMatch(new RegExp(`^(${comment})*${layered}`));
    }
    expect(rules).not.toContain("!important");
  });

  it("lets every widget fill its region: no widget rule takes it out of absolute, inset 0", () => {
    // A region is a grid cell with no content height of its own; a widget set back to `relative`
    // (or given its own inset) collapses to its content, and a playlist of absolute media is 0 px.
    const rules = [...looks.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selector: (m[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim(),
      body: m[2] ?? "",
    }));
    const widgetRules = rules.filter((r) =>
      /\.canccu-region\s*>\s*\.canccu-widget/.test(r.selector),
    );
    expect(widgetRules.some((r) => r.selector.includes("--playlist"))).toBe(true);
    expect(widgetRules.some((r) => r.selector.includes("--embed"))).toBe(true);
    for (const { selector, body } of widgetRules) {
      for (const [, value] of body.matchAll(/(?:^|;)\s*position:\s*([^;]+)/g)) {
        expect(value?.trim(), selector).toBe("absolute");
      }
      if (selector === ".canccu-region > .canccu-widget") continue;
      expect(body, selector).not.toMatch(/(?:^|;)\s*(inset|top|right|bottom|left|height):/);
    }
  });

  it("has a look for every ticker appearance and every motion", () => {
    for (const appearance of ["high_contrast", "minimal", "broadcast"]) {
      expect(looks).toContain(`[data-ticker="${appearance}"]`);
    }
    for (const motion of ["moderate", "calm"]) expect(looks).toContain(`[data-motion="${motion}"]`);
  });
});
