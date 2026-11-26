/**
 * The brand's choices beyond colour (plan issue-784 D4–D8): the logo plate, the font pair, the
 * roundness and the backdrop, through `PUT …/draft/brand` into the draft, the published tokens, the
 * token CSS and `GET /api/theming/current`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { draftFiles, png } from "./drafting.js";
import { DATABASE_URL, code, get, send } from "./helpers.js";

interface Draft {
  draft_version: number;
  mode: string;
  manifest: Record<string, unknown> & { brand?: Record<string, unknown> };
  problems: { severity: string; code: string; path?: string; message: string }[];
}

interface Current {
  tokens: { fonts: Record<string, string>; sizes: Record<string, string> };
  tokens_css_url: string;
  admin_tokens_css_url: string;
  backdrop: Record<string, unknown>;
}

const BLACK_LOGO = readFileSync(
  new URL("../../../events/demo/images/logo-black.svg", import.meta.url),
);
const DARK = { primary: "#3b82f6", accent: "#f59e0b", scheme: "dark" };
const LIGHT = { ...DARK, scheme: "light" };
const PLATE = { kind: "light", shape: "circle", padding: "large" };

describe.skipIf(!DATABASE_URL)("the brand's choices", () => {
  const t = draftFiles();

  /** A fresh draft holding the black logo at images/logo.svg and a picture at images/hall.png. */
  async function withLogo(): Promise<number> {
    const draft = await t.fresh();
    let res = await t.put("images/logo.svg", draft.draft_version, BLACK_LOGO);
    expect(res.statusCode).toBe(200);
    res = await t.put("images/hall.png", res.json<Draft>().draft_version, await png("#ffffff", 32));
    expect(res.statusCode).toBe(200);
    return res.json<Draft>().draft_version;
  }

  const putBrand = (body: Record<string, unknown>) =>
    send(t.h, "PUT", "/api/theming/draft/brand", body);

  async function publish(version: number): Promise<Current> {
    const res = await send(t.h, "POST", "/api/theming/draft/publish", { draft_version: version });
    expect(res.statusCode).toBe(201);
    return (await get(t.h, "/api/theming/current")).json<Current>();
  }

  const text = async (url: string): Promise<string> => (await get(t.h, url)).body;

  it("keeps the stored choices when a brand PUT leaves them out", async () => {
    const version = await withLogo();
    let res = await putBrand({
      draft_version: version,
      ...DARK,
      logo: "images/logo.svg",
      logo_plate: PLATE,
      font_pair: "space-inter",
      roundness: "round",
    });
    expect(res.statusCode).toBe(200);
    // What the Studio's kit form sends: colours and pictures only.
    res = await putBrand({
      draft_version: res.json<{ draft: Draft }>().draft.draft_version,
      ...DARK,
      primary: "#10b981",
      logo: "images/logo.svg",
    });
    expect(res.statusCode).toBe(200);
    const brand = res.json<{ draft: Draft }>().draft.manifest.brand;
    expect(brand).toMatchObject({
      primary: "#10b981",
      logo_plate: PLATE,
      font_pair: "space-inter",
      roundness: "round",
    });
  });

  it("keeps every choice in the brand, stays simple, and draws them in the published tokens", async () => {
    const version = await withLogo();
    const res = await putBrand({
      draft_version: version,
      ...DARK,
      logo: "images/logo.svg",
      logo_plate: PLATE,
      font_pair: "space-inter",
      roundness: "round",
      backdrop: { looks: ["glows", "waves"], game_art: false, image: "images/hall.png" },
    });
    expect(res.statusCode).toBe(200);
    const draft = res.json<{ draft: Draft }>().draft;
    expect(draft.mode).toBe("simple");
    expect(draft.manifest.brand).toEqual({
      ...DARK,
      logo_plate: PLATE,
      font_pair: "space-inter",
      roundness: "round",
      backdrop: { looks: ["glows", "waves"], game_art: false, image: "images/hall.png" },
    });
    // No font or size tokens in the simple mode: the choices are generated, never stored as tokens.
    expect(draft.manifest.tokens).not.toHaveProperty("fonts");
    expect(draft.manifest.tokens).not.toHaveProperty("sizes");
    expect(draft.problems.map((p) => p.code)).not.toContain("mode_mismatch");

    const current = await publish(draft.draft_version);
    expect(current.tokens.fonts).toMatchObject({
      heading: "Space Grotesk",
      display: "Space Grotesk",
      body: "Inter",
    });
    expect(current.tokens.sizes.radius).toBe("1rem");
    for (const url of [current.tokens_css_url, current.admin_tokens_css_url]) {
      const css = await text(url);
      expect(css).toContain("--canccu-logo-plate: #f7f7f8;");
      expect(css).toContain("--canccu-logo-plate-radius: 50%;");
      expect(css).toContain("--canccu-logo-plate-padding: 0.25;");
      expect(css).toContain("--canccu-radius: 1rem;");
      expect(css).toContain('--canccu-font-heading: "Space Grotesk"');
      expect(css).toContain('url("/theming/fonts/space-inter/inter-400.woff2")');
    }
    expect(current.backdrop).toMatchObject({
      looks: ["glows", "waves"],
      game_art: false,
      daylight: true,
      hype: true,
    });
    expect(current.backdrop.image_url).toMatch(/^\/theming\/a\/[0-9a-f]{64}\.png$/);
    // A white picture under the dark theme's background: enough scrim for the text to read.
    expect(current.backdrop.scrim).toBeGreaterThanOrEqual(0.55);
    expect(current.backdrop.scrim).toBeLessThanOrEqual(1);
  });

  it("draws the surface plate in the theme's own surface, rounded by the theme's radius", async () => {
    const version = await withLogo();
    const res = await putBrand({
      draft_version: version,
      ...DARK,
      logo: "images/logo.svg",
      logo_plate: { kind: "surface", shape: "rounded", padding: "small" },
    });
    const css = await text(
      (await publish(res.json<{ draft: Draft }>().draft.draft_version)).tokens_css_url,
    );
    expect(css).toContain("--canccu-logo-plate: var(--canccu-color-surface);");
    expect(css).toContain("--canccu-logo-plate-radius: var(--canccu-radius);");
    expect(css).toContain("--canccu-logo-plate-padding: 0.08;");
  });

  it("answers the backdrop's defaults for a theme without one, and draws no plate", async () => {
    const current = (await get(t.h, "/api/theming/current")).json<Current>();
    expect(current.backdrop).toEqual({
      looks: ["glows", "gradient", "particles", "waves"],
      game_art: true,
      daylight: true,
      hype: true,
    });
    expect(await text(current.tokens_css_url)).not.toContain("--canccu-logo-plate");
  });

  it("refuses a pair the platform does not hold, a plate it does not know, and a picture not in the draft", async () => {
    const version = await withLogo();
    for (const extra of [
      { font_pair: "no-such-pair" },
      { logo_plate: { kind: "glass", shape: "circle", padding: "small" } },
      { roundness: "blobby" },
      { backdrop: { looks: ["fireworks"] } },
      { backdrop: { image: "images/missing.png" } },
    ]) {
      const res = await putBrand({ draft_version: version, ...DARK, ...extra });
      expect(res.statusCode, JSON.stringify(extra)).toBe(400);
      expect(code(res)).toBe("invalid_request");
    }
  });

  it("warns that a black logo vanishes on a dark scheme, and stops once it sits on a plate", async () => {
    const version = await withLogo();
    let res = await putBrand({ draft_version: version, ...DARK, logo: "images/logo.svg" });
    const unreadable = res
      .json<{ draft: Draft }>()
      .draft.problems.filter((p) => p.code === "logo_unreadable");
    expect(unreadable).toEqual([
      expect.objectContaining({ severity: "warning", path: "images/logo.svg" }),
    ]);
    expect(unreadable[0]?.message).toMatch(/light plate/);

    res = await putBrand({
      draft_version: version + 1,
      ...DARK,
      logo: "images/logo.svg",
      logo_plate: PLATE,
    });
    expect(res.json<{ draft: Draft }>().draft.problems.map((p) => p.code)).not.toContain(
      "logo_unreadable",
    );

    res = await putBrand({ draft_version: version + 2, ...LIGHT, logo: "images/logo.svg" });
    expect(res.json<{ draft: Draft }>().draft.problems.map((p) => p.code)).not.toContain(
      "logo_unreadable",
    );
  });

  it("gives each value one source: an advanced radius or pair font clears the brand's choice", async () => {
    const version = await withLogo();
    const set = await putBrand({
      draft_version: version,
      ...DARK,
      font_pair: "space-inter",
      roundness: "round",
    });
    expect(set.statusCode).toBe(200);
    let res = await send(t.h, "PATCH", "/api/theming/draft/tokens", {
      draft_version: version + 1,
      tokens: { motion: "calm" },
    });
    expect(res.json<Draft>().manifest.brand).toMatchObject({
      font_pair: "space-inter",
      roundness: "round",
    });
    res = await send(t.h, "PATCH", "/api/theming/draft/tokens", {
      draft_version: version + 2,
      tokens: { sizes: { radius: "4px" } },
    });
    let brand = res.json<Draft>().manifest.brand ?? {};
    expect(brand).not.toHaveProperty("roundness");
    expect(brand.font_pair).toBe("space-inter");
    res = await send(t.h, "PATCH", "/api/theming/draft/tokens", {
      draft_version: version + 3,
      tokens: { fonts: { mono: "monospace" } },
    });
    expect(res.json<Draft>().manifest.brand?.font_pair).toBe("space-inter");
    res = await send(t.h, "PATCH", "/api/theming/draft/tokens", {
      draft_version: version + 4,
      tokens: { fonts: { body: "serif" } },
    });
    brand = res.json<Draft>().manifest.brand ?? {};
    expect(brand).not.toHaveProperty("font_pair");
    expect(brand.primary).toBe(DARK.primary);
  });
});
