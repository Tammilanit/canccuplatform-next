/**
 * What the brand's choices generate (plan issue-784 D4, D6, D7): the radius and font tokens, the
 * plate's custom properties and the pair's `@font-face` rules. Deterministic, like the colours.
 */
import { describe, expect, it } from "vitest";
import { brandTokens } from "../src/brand.js";
import { manifestCss, manifestTokens, platformTokens } from "../src/tokens.js";

const BRAND = { primary: "#3b82f6", accent: "#f59e0b", scheme: "dark" as const };

describe("brandTokens", () => {
  it("gives the radius of each roundness", () => {
    expect(brandTokens({ ...BRAND, roundness: "square" })).toEqual({ sizes: { radius: "0" } });
    expect(brandTokens({ ...BRAND, roundness: "soft" })).toEqual({ sizes: { radius: "0.5rem" } });
    expect(brandTokens({ ...BRAND, roundness: "round" })).toEqual({ sizes: { radius: "1rem" } });
  });

  it("gives the pair's families as the heading, display and body fonts", () => {
    expect(brandTokens({ ...BRAND, font_pair: "space-inter" })).toEqual({
      fonts: { heading: "Space Grotesk", display: "Space Grotesk", body: "Inter" },
    });
  });

  it("gives nothing for a pair this platform does not hold, nor for the default brand", () => {
    expect(brandTokens({ ...BRAND, font_pair: "newer-pair" })).toEqual({});
    expect(brandTokens(BRAND)).toEqual({});
  });
});

describe("manifestTokens", () => {
  it("leaves a theme without choices exactly at its tokens", () => {
    expect(manifestTokens({ brand: BRAND })).toEqual(platformTokens());
    expect(manifestTokens({})).toEqual(platformTokens());
  });

  it("fills in the brand's choices, and lets a token the theme sets win", () => {
    const tokens = manifestTokens({
      brand: { ...BRAND, roundness: "round", font_pair: "space-inter" },
      tokens: { fonts: { body: "serif" }, motion: "calm" },
    });
    expect(tokens.sizes.radius).toBe("1rem");
    expect(tokens.fonts).toMatchObject({
      heading: "Space Grotesk",
      display: "Space Grotesk",
      body: "serif",
    });
    expect(tokens.motion).toBe("calm");
  });
});

describe("manifestCss", () => {
  const css = (brand: Record<string, unknown>): string => {
    const manifest = { brand: { ...BRAND, ...brand } };
    return manifestCss(manifest, manifestTokens(manifest));
  };

  it("draws a light circle plate with large padding", () => {
    const out = css({ logo_plate: { kind: "light", shape: "circle", padding: "large" } });
    expect(out).toContain("  --canccu-logo-plate: #f7f7f8;\n");
    expect(out).toContain("  --canccu-logo-plate-radius: 50%;\n");
    expect(out).toContain("  --canccu-logo-plate-padding: 0.25;\n");
    expect(out).toContain("  --canccu-logo-plate-aspect: 1;\n");
  });

  it("draws the dark plate and the medium padding", () => {
    const out = css({ logo_plate: { kind: "dark", shape: "rounded", padding: "medium" } });
    expect(out).toContain("--canccu-logo-plate: #121317;");
    expect(out).toContain("--canccu-logo-plate-radius: var(--canccu-radius);");
    expect(out).toContain("--canccu-logo-plate-padding: 0.15;");
    expect(out).not.toContain("--canccu-logo-plate-aspect");
  });

  it("draws no plate for none, and the same CSS as before for a theme without choices", () => {
    expect(css({ logo_plate: { kind: "none", shape: "rounded", padding: "small" } })).not.toContain(
      "logo-plate",
    );
    expect(css({})).not.toContain("logo-plate");
    expect(css({})).not.toContain("@font-face");
  });

  it("appends the pair's @font-face rules after the :root block", () => {
    const out = css({ font_pair: "bebas-roboto" });
    const root = out.indexOf(":root");
    const face = out.indexOf('@font-face { font-family: "Bebas Neue"');
    expect(root).toBe(0);
    expect(face).toBeGreaterThan(root);
    expect(out).toContain('url("/theming/fonts/bebas-roboto/roboto-700.woff2")');
  });
});
