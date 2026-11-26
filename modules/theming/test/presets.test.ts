/** The presets of Pick a look (plan issue-784 D9, D10): the demo themes and their schemes. */
import { describe, expect, it } from "vitest";
import { contrastFailures } from "../src/contrast.js";
import { generateColors } from "../src/brand.js";
import { PRESETS, schemeColors } from "../src/presets.js";

describe("the presets", () => {
  it("are the demo themes the image holds, in the gallery's order", () => {
    expect([...PRESETS.keys()]).toEqual(["default", "terminal", "level-up"]);
    expect(PRESETS.get("level-up")?.name).toBe("Level up");
  });

  it("each have 3–5 schemes, among them one dark and one light", () => {
    for (const preset of PRESETS.values()) {
      expect(preset.schemes.length, preset.id).toBeGreaterThanOrEqual(3);
      expect(preset.schemes.length, preset.id).toBeLessThanOrEqual(5);
      const kinds = preset.schemes.map((s) => s.kind);
      expect(kinds, preset.id).toContain("dark");
      expect(kinds, preset.id).toContain("light");
    }
  });

  it("never give a scheme that fails the contrast rules", () => {
    for (const preset of PRESETS.values()) {
      for (const scheme of preset.schemes) {
        expect(contrastFailures(schemeColors(scheme)), `${preset.id}/${scheme.id}`).toEqual([]);
      }
    }
  });

  it("start with the package's own colours", () => {
    for (const preset of PRESETS.values()) {
      const tokens = preset.manifest.tokens as { colors: Record<string, string> };
      expect(schemeColors(preset.schemes[0]!), preset.id).toEqual(tokens.colors);
    }
  });

  it("generate a scheme's colours from its brand when it brings none", () => {
    const brand = { primary: "#ff7a45", accent: "#f59e0b", scheme: "dark" as const };
    const scheme = { id: "x", name: "X", kind: "accent" as const, brand };
    expect(schemeColors(scheme)).toEqual(generateColors(brand).colors);
  });
});
