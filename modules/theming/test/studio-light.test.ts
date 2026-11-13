/**
 * Publishing a light look warns about the venue screens first (#444; design sheet 6, Q11 b: warn
 * only in step 3). The brand kit's view is drawn from a draft as the page would, no database needed.
 */
import { describe, expect, it } from "vitest";
import type { Manifest } from "../src/checks.js";
import { brandKitView } from "../src/studio-kit.js";
import type { StudioState } from "../src/studio-views.js";

function stateOf(colors: Record<string, string>, scheme: "dark" | "light"): StudioState {
  const manifest: Manifest = {
    schema_version: 1,
    name: "T",
    mode: "simple",
    brand: { primary: colors.primary ?? "#3ddcff", accent: "#b98cff", scheme },
    tokens: { colors },
  };
  return {
    draft: {
      draft_version: 3,
      created_from: 1,
      manifest,
      problems: [],
      files: [],
      updated_at: new Date(0),
      updated_by: null,
    },
    problems: [],
    current: 1,
    cssChanged: false,
    logoUrl: undefined,
    screenTheme: undefined,
  };
}

const page = (s: StudioState): string => {
  const v = brandKitView(s, false, undefined);
  return `${String(v.actions)}${String(v.body)}`;
};
const LIGHT = { background: "#f8fafc", surface: "#ffffff", text: "#0f172a", primary: "#2563eb" };
const DARK = { background: "#0b0d1a", surface: "#161a2e", text: "#f3f5ff", primary: "#3ddcff" };

describe("publishing a light look", () => {
  it("asks first, saying what a light screen does in a dark hall", () => {
    const body = page(stateOf(LIGHT, "light"));
    // Both Publish buttons (title row and the phone's row) open the warning instead.
    expect(body.match(/data-action="light-ask"/g)).toHaveLength(2);
    const dialog = /<dialog[^>]*id="canccu-studio-light"[\s\S]*?<\/dialog>/.exec(body)?.[0] ?? "";
    expect(dialog).toContain("A light look on venue screens");
    expect(dialog).toContain("a light screen is bright and tiring");
    expect(dialog).toMatch(/data-action="dialog-close"[\s\S]*data-action="publish"/);
    expect(dialog).toContain("Publish as it is");
  });

  it("warns for a light background whatever the brand's scheme says (an advanced draft)", () => {
    expect(page(stateOf(LIGHT, "dark"))).toContain('data-action="light-ask"');
  });

  it("publishes a dark look at once", () => {
    const body = page(stateOf(DARK, "dark"));
    expect(body).not.toContain("light-ask");
    expect(body).not.toContain("canccu-studio-light");
    expect(body.match(/data-action="publish"/g)).toHaveLength(2);
  });
});

describe("preview on a screen (#444, sheet 6)", () => {
  it("offers it beside Preview, with the screen, how long, and the notice while it runs", () => {
    const body = page(stateOf(DARK, "dark"));
    expect(body.match(/data-screen-preview="open"/g)).toHaveLength(2);
    expect(body).toContain("Preview on a screen…");
    const dialog = /<dialog[^>]*id="canccu-studio-screen"[\s\S]*?<\/dialog>/.exec(body)?.[0] ?? "";
    expect(dialog).toContain("Preview the draft on a screen");
    expect(dialog).toContain("data-screen-preview-list");
    for (const [value, label] of [
      ["2", "2 min"],
      ["5", "5 min"],
      ["", "Until I end it"],
    ]) {
      expect(dialog).toContain(`value="${value}"`);
      expect(dialog).toContain(label);
    }
    expect(dialog).toContain("Start preview");
    const notice = /<div[^>]*data-screen-preview-notice[\s\S]*?End preview/.exec(body)?.[0] ?? "";
    expect(notice).toContain("hidden");
    expect(notice).toContain("Every other screen shows the published theme.");
  });

  it("is not offered without a draft", () => {
    const none = brandKitView({ ...stateOf(DARK, "dark"), draft: undefined }, false, undefined);
    expect(String(none.body)).not.toContain("canccu-studio-screen");
  });
});
