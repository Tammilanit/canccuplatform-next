/**
 * Box transparency (contracts/theming.md, Brand kit: `box_opacity`; plan issue-785 D11): the
 * screen's boxes let the background show through, and the contrast rules still hold at the worst
 * point the stage draws behind a box.
 */
import { describe, expect, it } from "vitest";
import { generateColors } from "../src/brand.js";
import { raiseBoxOpacity } from "../src/brand-routes.js";
import { BOX_OPACITY, boxContrastFailures, minBoxOpacity } from "../src/contrast.js";
import { PRESETS, schemeColors } from "../src/presets.js";
import { fillTokens, manifestCss, manifestTokens, tokensCss } from "../src/tokens.js";
import { draftFiles } from "./drafting.js";
import { DATABASE_URL, send } from "./helpers.js";

const BRAND = { primary: "#ff4fd8", accent: "#22e4ff", scheme: "dark" as const };
const COLORS = generateColors(BRAND).colors;
const opacityVar = (css: string) => /--canccu-box-opacity: ([0-9.]+);/.exec(css)?.[1];

describe("boxContrastFailures", () => {
  it("passes a fully opaque box whenever the scheme passes its rules", () => {
    expect(boxContrastFailures(COLORS, 1)).toEqual([]);
  });

  it("names the pair and the ground that fail when the box is too see-through", () => {
    const colors = { ...COLORS, surface: "#000000", text: "#ffffff", primary: "#ffffff" };
    expect(boxContrastFailures(colors, 0.5)).toContain("text on the box over primary");
  });
});

describe("minBoxOpacity", () => {
  it("is the lowest step of 0.05 from 0.5 at which the box passes", () => {
    const min = minBoxOpacity(COLORS);
    expect(boxContrastFailures(COLORS, min)).toEqual([]);
    if (min > 0.5) expect(boxContrastFailures(COLORS, min - 0.05)).not.toEqual([]);
    expect(Math.round(min * 20)).toBe(min * 20);
  });

  it("is 1 when only an opaque box passes", () => {
    // #767676 on black is 4.54:1: any white showing through the box takes it under 4.5.
    const white = { background: "#ffffff", primary: "#ffffff", accent: "#ffffff" };
    expect(minBoxOpacity({ ...COLORS, ...white, surface: "#000000", text: "#767676" })).toBe(1);
  });
});

describe("the presets' boxes", () => {
  it("keep every scheme's text readable at the preset's own opacity", () => {
    for (const preset of PRESETS.values()) {
      const brand = preset.manifest.brand as { box_opacity?: number } | undefined;
      for (const scheme of preset.schemes) {
        const failures = boxContrastFailures(
          schemeColors(scheme),
          brand?.box_opacity ?? BOX_OPACITY,
        );
        expect(failures, `${preset.id}/${scheme.id}`).toEqual([]);
      }
    }
  });
});

describe("the token CSS", () => {
  it("carries the platform's 0.9 when the theme sets none", () => {
    expect(opacityVar(tokensCss(fillTokens({})))).toBe("0.9");
  });

  it("carries the brand's opacity, raised to the lowest its colours allow", () => {
    const manifest = { brand: { ...BRAND, box_opacity: 0.5 }, tokens: { colors: COLORS } };
    const css = manifestCss(manifest, manifestTokens(manifest));
    expect(opacityVar(css)).toBe(String(minBoxOpacity(COLORS)));
    const opaque = { ...manifest, brand: { ...BRAND, box_opacity: 1 } };
    expect(opacityVar(manifestCss(opaque, manifestTokens(opaque)))).toBe("1");
  });
});

describe("raiseBoxOpacity", () => {
  it("judges the filled colours: a partial tokens.colors keeps the 0.9 the token CSS draws", () => {
    const manifest = {
      brand: { ...BRAND, box_opacity: 0.9 },
      tokens: { colors: { primary: COLORS.primary, accent: COLORS.accent } },
    };
    const css = manifestCss(manifest, manifestTokens(manifest));
    expect(opacityVar(css)).toBe("0.9");
    expect(raiseBoxOpacity(manifest)).toBe(false);
    expect(manifest.brand.box_opacity).toBe(0.9);
  });
});

describe.skipIf(!DATABASE_URL)("PUT /api/theming/draft/brand with box_opacity", () => {
  const t = draftFiles();
  interface Body {
    draft: { manifest: { brand: Record<string, unknown> } };
    adjusted: string[];
  }
  const putBrand = async (box_opacity: unknown, version?: number) =>
    send(t.h, "PUT", "/api/theming/draft/brand", {
      ...BRAND,
      draft_version: version ?? (await t.fresh()).draft_version,
      box_opacity,
    });

  it("raises a value under the lowest the colours allow, and says so", async () => {
    const min = minBoxOpacity(COLORS);
    expect(min).toBeGreaterThan(0.5);
    const res = await putBrand(0.5);
    expect(res.statusCode).toBe(200);
    const body = res.json<Body>();
    expect(body.draft.manifest.brand.box_opacity).toBe(min);
    expect(body.adjusted).toContain("box_opacity");
  });

  it("keeps a fully opaque box as it is", async () => {
    const res = await putBrand(1);
    expect(res.statusCode).toBe(200);
    const body = res.json<Body>();
    expect(body.draft.manifest.brand.box_opacity).toBe(1);
    expect(body.adjusted).not.toContain("box_opacity");
  });

  it("refuses a value outside 0.5–1 or off its steps", async () => {
    const version = (await t.fresh()).draft_version;
    for (const bad of [0.4, 1.1, 0.72, "0.9"]) {
      expect((await putBrand(bad, version)).statusCode, String(bad)).toBe(400);
    }
  });
});
