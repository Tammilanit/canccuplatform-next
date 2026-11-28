/**
 * The simple presets' signatures (plan issue-785 D12): the roundness `pill` and the background
 * looks `hearth` and `sky`, platform choices any organiser can pick. The default cycle stays the
 * four looks every theme had, so no existing theme starts showing the new ones.
 */
import { describe, expect, it } from "vitest";
import { backdropView } from "../src/backdrop.js";
import type { Manifest } from "../src/checks.js";
import { brandInputError, schemaErrors } from "../src/schema.js";
import { yoursView } from "../src/studio-yours.js";
import type { StudioState } from "../src/studio-views.js";
import { manifestTokens } from "../src/tokens.js";

const BRAND = { primary: "#f0a35e", accent: "#8fc7a0", scheme: "dark" };
const manifest = (brand: Record<string, unknown>): Manifest => ({
  schema_version: 1,
  name: "T",
  mode: "simple",
  tokens: {},
  brand: { ...BRAND, ...brand },
});

describe("pill corners and the hearth and sky looks", () => {
  it("are allowed in a theme and in a brand save", () => {
    const m = manifest({ roundness: "pill", backdrop: { looks: ["hearth", "sky"] } });
    expect(schemaErrors(m)).toEqual([]);
    const body = { draft_version: 1, ...BRAND, roundness: "pill", backdrop: { looks: ["sky"] } };
    expect(brandInputError(body)).toBeUndefined();
    expect(brandInputError({ ...body, backdrop: { looks: ["campfire"] } })).toBeDefined();
  });

  it("gives the pill its really round 2.5rem radius", () => {
    expect(manifestTokens(manifest({ roundness: "pill" })).sizes.radius).toBe("2.5rem");
  });

  it("keeps the default cycle to the four looks every theme had", () => {
    expect(backdropView(manifest({}), {}).looks).toEqual([
      "glows",
      "gradient",
      "particles",
      "waves",
    ]);
    const picked = manifest({ backdrop: { looks: ["hearth", "particles"] } });
    expect(backdropView(picked, {}).looks).toEqual(["hearth", "particles"]);
  });

  it("are offered in Make it yours, and checked as the brand has them", () => {
    const m = manifest({ roundness: "pill", backdrop: { looks: ["sky", "waves"] } });
    const draft = {
      draft_version: 3,
      created_from: 1,
      manifest: m,
      problems: [],
      files: [],
      updated_at: new Date(0),
      updated_by: null,
    };
    const state: StudioState = {
      draft,
      problems: [],
      current: 1,
      cssChanged: false,
      logoUrl: undefined,
      screenTheme: undefined,
      mine: [],
    };
    const html = String(yoursView(state, draft, { advice: undefined, palette: [] }));
    const checked = (name: string, value: string): boolean =>
      new RegExp(`<input[^>]*name="${name}"[^>]*value="${value}"[^>]*checked`).test(html);
    expect(checked("roundness", "pill")).toBe(true);
    expect(checked("looks", "sky")).toBe(true);
    expect(checked("looks", "waves")).toBe(true);
    expect(html).toMatch(/name="looks"[^>]*value="hearth"/);
    expect(checked("looks", "hearth")).toBe(false);
    expect(checked("looks", "glows")).toBe(false);
  });
});
