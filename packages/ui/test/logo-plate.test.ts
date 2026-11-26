/**
 * The logo's plate on the shell's header and the posters (contracts/theming.md, Stable classes and
 * custom properties; plan issue-784 D4): drawn from the plate's custom properties that theming's
 * token CSS sets, padded by a share of each logo's own height, and nothing without them.
 */
import { describe, expect, it } from "vitest";
import { pkgFile } from "./helpers.js";

const css = pkgFile("ui.css").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The declarations of the rules whose selector list includes `selector`, by property; the first
 * one wins, so a narrow screen's smaller logo (a media query further down) does not count.
 */
function declared(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? "").split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const d of (m[2] ?? "").split(";")) {
      const at = d.indexOf(":");
      const name = d.slice(0, at).trim();
      if (at > 0 && !out.has(name)) out.set(name, d.slice(at + 1).trim());
    }
  }
  return out;
}

describe("the logo plate in ui.css", () => {
  for (const [selector, height] of [
    [".canccu-header__logo", "1.75rem"],
    [".canccu-poster__logo", "3.5rem"],
  ] as const) {
    it(`draws ${selector} on the plate, padded by its own height`, () => {
      const rule = declared(selector);
      expect(rule.get("--canccu-logo-height")).toBe(height);
      expect(rule.get("height")).toBe("var(--canccu-logo-height)");
      expect(rule.get("background")).toBe("var(--canccu-logo-plate, transparent)");
      expect(rule.get("border-radius")).toBe("var(--canccu-logo-plate-radius, 0)");
      expect(rule.get("padding")).toBe(
        "calc(var(--canccu-logo-height) * var(--canccu-logo-plate-padding, 0))",
      );
      // The padding grows the box around the logo, never shrinks the logo inside it.
      expect(rule.get("box-sizing")).toBe("content-box");
      expect(rule.get("aspect-ratio")).toBe("var(--canccu-logo-plate-aspect, auto)");
    });
  }
});
