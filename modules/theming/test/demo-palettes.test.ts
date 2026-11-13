/**
 * The demo event's palettes (#432): Default is the design guideline's "Demo night"
 * (docs/design/mockups.html), and Level up keeps a palette of its own, so the two demo themes never
 * look the same. Both pass the contract's contrast rules, so admin pages take their colours.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { contrastFailures } from "../src/contrast.js";
import { parseManifest } from "../src/manifest.js";

const DEMO_NIGHT = {
  background: "#0b0d1a",
  surface: "#161a2e",
  border: "#343c66",
  text: "#f3f5ff",
  text_muted: "#a9b1d6",
  primary: "#3ddcff",
  primary_text: "#0b0d1a",
  accent: "#b98cff",
  status_ok: "#3ee39a",
  status_degraded: "#ffc94d",
  status_down: "#ff6b7d",
};

async function manifest(theme: string): Promise<Record<string, any>> {
  const bytes = await readFile(
    new URL(`../../../events/demo/themes/${theme}/theme.yaml`, import.meta.url),
  );
  const parsed = parseManifest(bytes);
  if (!parsed.ok) throw new Error(parsed.why);
  return parsed.manifest as Record<string, any>;
}

describe("the demo palettes", () => {
  it("gives the Default theme the Demo night palette, its brand included", async () => {
    const m = await manifest("default");
    expect(m.tokens.colors).toEqual(DEMO_NIGHT);
    expect(m.brand).toMatchObject({ primary: "#3ddcff", accent: "#b98cff", scheme: "dark" });
  });

  it("gives Level up colours of its own", async () => {
    const colors = (await manifest("level-up")).tokens.colors as Record<string, string>;
    for (const token of ["background", "surface", "primary", "accent"] as const) {
      expect(colors[token]).not.toBe(DEMO_NIGHT[token]);
    }
  });

  it("keeps every contrast rule in both", async () => {
    for (const theme of ["default", "level-up"]) {
      expect(contrastFailures((await manifest(theme)).tokens.colors)).toEqual([]);
    }
  });
});
