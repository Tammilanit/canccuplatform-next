/**
 * The safety rules (contracts/theming.md, Advanced mode): the pairing code, the offline marker and
 * the privacy link keep their look whatever a theme's layer says, because every declaration of
 * theirs is `!important` in `canccu-base`, the first layer. That a theme cannot hide them in a
 * browser is proven by modules/theming/test/safety.browser.test.ts, with theming's own compile.
 */
import { describe, expect, it } from "vitest";
import { SAFETY_CLASSES } from "../src/index.js";
import { pkgFile } from "./helpers.js";

const css = pkgFile("ui.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of every rule whose selector list is exactly `selector`, in canccu-base. */
function declarations(selector: RegExp): string[] {
  const base = /@layer canccu-base \{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? "";
  const out: string[] = [];
  for (const m of base.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector.test((m[1] ?? "").trim())) continue;
    out.push(
      ...(m[2] ?? "")
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d !== ""),
    );
  }
  return out;
}

describe("the safety rules in canccu-base", () => {
  it("names the four safety elements", () => {
    expect(SAFETY_CLASSES).toEqual([
      "canccu-pairing-code",
      "canccu-offline-marker",
      "canccu-preview-mark",
      "canccu-privacy-link",
    ]);
  });

  it.each(SAFETY_CLASSES)("resets every property of .%s first, all !important", (name) => {
    const own = declarations(new RegExp(`(^|,)\\s*\\.${name}\\s*(,|$)`));
    expect(own[0]).toBe("all: initial !important");
    for (const d of own) expect(d).toMatch(/!important$/);
    expect(own).toEqual(
      expect.arrayContaining([
        "position: fixed !important",
        "z-index: 2147483647 !important",
        "display: block !important",
      ]),
    );
    const pseudo = declarations(new RegExp(`\\.${name}::(before|after)`));
    expect(pseudo).toContain("content: none !important");
    const lines = declarations(new RegExp(`\\.${name}::first-(line|letter)`));
    expect(lines).toContain("all: inherit !important");
  });

  it("puts the Preview mark flush in the top left corner, inside the screen's safe inset", () => {
    // Set in from the edges it covered the header's logo; 1.7em of a 0.42-inset font stays under
    // the three quarters of the inset that the layout's burn-in drift leaves free.
    const own = declarations(/^\.canccu-preview-mark$/);
    expect(own).toEqual(
      expect.arrayContaining([
        "top: 0 !important",
        "left: 0 !important",
        "padding: 0.25em 1.2em !important",
        "font-size: clamp(16px, calc(var(--canccu-safe-inset, 48px) * 0.42), 3.9vmin) !important",
      ]),
    );
  });

  it("keeps the page and the root from hiding, moving or covering what they hold", () => {
    const guard = declarations(/^:root,\s*\.canccu-page$/);
    for (const d of guard) expect(d).toMatch(/!important$/);
    for (const property of [
      "display",
      "opacity",
      "filter",
      "transform",
      "transform-style",
      "offset-path",
      "clip",
      "clip-path",
      "mask",
      "mask-border",
      "-webkit-mask-box-image",
      "mix-blend-mode",
      "content-visibility",
      "contain",
      "container-type",
      "zoom",
    ]) {
      expect(guard.some((d) => d.startsWith(`${property}:`))).toBe(true);
    }
    expect(declarations(/^:root::before,\s*:root::after$/)).toContain("content: none !important");
    expect(declarations(/^\.canccu-page::before,\s*\.canccu-page::after$/)).toContain(
      "z-index: auto !important",
    );
  });
});
