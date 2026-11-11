import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../player/src/screen.css", import.meta.url), "utf8");

describe("the screen's stylesheet", () => {
  it("sizes all text relative to the layout's short side, at least 2.6 % of it (readable at 20 m)", () => {
    // theming.md, Advanced mode: under 2.5 % of the screen height (27 px at 1080p) is hard to read
    // across a hall. `cqmin` follows the layout, so 1080p and 4K, landscape and portrait read alike.
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]?.trim() ?? "");
    expect(sizes.length).toBeGreaterThan(5);
    for (const size of sizes) {
      const value = /^([\d.]+)cqmin$/.exec(size);
      expect(value, size).not.toBeNull();
      expect(Number(value?.[1]), size).toBeGreaterThanOrEqual(2.6);
    }
  });

  it("sits in the platform's base layer, so a theme's CSS overrides it without !important", () => {
    expect(css).toMatch(/^(\/\*[\s\S]*?\*\/\s*)?@layer canccu-base \{[\s\S]*\}\s*$/);
    expect(css).not.toContain("!important");
  });

  it("lets every widget fill its region: no widget rule takes it out of absolute, inset 0", () => {
    // A region is a grid cell with no content height of its own; a widget set back to `relative`
    // (or given its own inset) collapses to its content, and a playlist of absolute media is 0 px.
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
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
      expect(css).toContain(`[data-ticker="${appearance}"]`);
    }
    for (const motion of ["moderate", "calm"]) expect(css).toContain(`[data-motion="${motion}"]`);
  });
});
