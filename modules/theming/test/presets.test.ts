/** The presets of Pick a look (plan issue-784 D9, D10): the demo themes and their schemes. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastFailures } from "../src/contrast.js";
import { generateColors } from "../src/brand.js";
import { PRESETS, schemeColors } from "../src/presets.js";

describe("the presets", () => {
  it("are the demo themes the image holds, in the gallery's order", () => {
    expect([...PRESETS.keys()]).toEqual(["default", "esports", "level-up", "arcade", "terminal"]);
    expect(PRESETS.get("level-up")?.name).toBe("Level up");
  });

  it("hold Arcade with its five schemes, its pixel pair and fully opaque boxes", () => {
    const arcade = PRESETS.get("arcade");
    expect(arcade?.schemes.map((s) => s.id)).toEqual([
      "cabinet",
      "player-two",
      "green-screen",
      "handheld",
      "contrast",
    ]);
    expect(arcade?.manifest.brand).toMatchObject({
      font_pair: "press-jersey",
      roundness: "square",
      backdrop: { looks: ["particles", "glows"] },
      box_opacity: 1,
    });
    expect(arcade?.manifest.tokens).toMatchObject({ motion_style: { pack: "arcade" } });
  });

  it("hold Esports with its five schemes, its pair, square corners and broadcast motion", () => {
    const esports = PRESETS.get("esports");
    expect(esports?.schemes.map((s) => s.id)).toEqual([
      "arena",
      "red-side",
      "gold",
      "studio",
      "contrast",
    ]);
    expect(esports?.manifest.brand).toMatchObject({
      font_pair: "saira",
      roundness: "square",
      backdrop: { looks: ["gradient", "glows"] },
      box_opacity: 0.9,
    });
    expect(esports?.manifest.tokens).toMatchObject({ motion_style: { pack: "broadcast" } });
  });

  it("say they hold embeds exactly when their package has an embeds folder", () => {
    for (const preset of PRESETS.values()) {
      expect(preset.embeds, preset.id).toBe(existsSync(join(preset.dir, "embeds")));
    }
    expect([...PRESETS.values()].filter((p) => p.embeds).length).toBeGreaterThan(0);
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
      const [first] = preset.schemes;
      if (first === undefined) throw new Error(preset.id);
      expect(schemeColors(first), preset.id).toEqual(tokens.colors);
    }
  });

  it("generate a scheme's colours from its brand when it brings none", () => {
    const brand = { primary: "#ff7a45", accent: "#f59e0b", scheme: "dark" as const };
    const scheme = { id: "x", name: "X", kind: "accent" as const, brand };
    expect(schemeColors(scheme)).toEqual(generateColors(brand).colors);
  });
});
