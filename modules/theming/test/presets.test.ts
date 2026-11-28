/** The presets of Pick a look (plan issue-784 D9, D10): the demo themes and their schemes. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastFailures } from "../src/contrast.js";
import { generateColors } from "../src/brand.js";
import { PRESETS, presetManifest, schemeColors } from "../src/presets.js";

describe("the presets", () => {
  it("are the demo themes the image holds, in the gallery's order", () => {
    // From neutral to bold (plan issue-785 D2).
    expect([...PRESETS.keys()]).toEqual([
      "default",
      "daylight",
      "cozy-lan",
      "esports",
      "level-up",
      "synthwave",
      "arcade",
      "terminal",
    ]);
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

  it("hold Synthwave with its five schemes, its pair, soft corners and see-through boxes", () => {
    const synthwave = PRESETS.get("synthwave");
    expect(synthwave?.schemes.map((s) => s.id)).toEqual([
      "sunset",
      "miami",
      "outrun",
      "vapor",
      "contrast",
    ]);
    expect(synthwave?.manifest.mode).toBe("advanced");
    expect(synthwave?.manifest.css).toEqual(["css/synthwave.css"]);
    expect(synthwave?.manifest.brand).toMatchObject({
      font_pair: "audiowide-titillium",
      roundness: "soft",
      backdrop: { looks: ["glows", "gradient"] },
      box_opacity: 0.8,
    });
    expect(synthwave?.manifest.tokens).toMatchObject({ motion_style: { pack: "standard" } });
  });

  it.each([
    ["cozy-lan", ["fireside", "meadow", "linen", "blossom", "contrast"], "fredoka-nunito", "pill", ["hearth", "particles"]],
    ["daylight", ["morning", "sand", "mint", "dusk", "contrast"], "space-inter", "soft", ["sky", "waves"]],
  ])("hold %s as a simple theme: brand, pair, corners and background, no files of its own", (id, schemes, pair, roundness, looks) => {
    const preset = PRESETS.get(id);
    const m = preset?.manifest ?? {};
    expect(preset?.schemes.map((s) => s.id)).toEqual(schemes);
    expect(m.mode).toBe("simple");
    for (const part of ["css", "fonts", "templates", "embeds"]) expect(m, part).not.toHaveProperty(part);
    expect(m.brand).toMatchObject({ font_pair: pair, roundness, backdrop: { looks }, box_opacity: 0.9 });
    expect(m.tokens).toEqual({ colors: schemeColors(preset?.schemes[0] ?? schemes[0] as never), motion_style: { pack: "standard" } });
  }); // prettier-ignore

  it("keep a simple preset's pair, corners and background under any of its schemes (D3)", () => {
    const cozy = PRESETS.get("cozy-lan");
    const linen = cozy?.schemes.find((s) => s.id === "linen");
    if (cozy === undefined || linen === undefined) throw new Error("no Cozy LAN · Linen");
    expect(presetManifest(cozy, linen, { images: {}, brand: {} }).brand).toMatchObject({
      font_pair: "fredoka-nunito",
      roundness: "pill",
      backdrop: { looks: ["hearth", "particles"] },
      scheme: "light",
    });
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
