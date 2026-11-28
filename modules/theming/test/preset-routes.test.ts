/**
 * `GET /api/theming/presets` and `PUT /api/theming/draft/preset` (contracts/theming.md, Presets;
 * plan issue-784 D10, D11): applying a preset keeps the event's logo and its plate, and Reset is
 * the same call with the draft's own preset.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readPackage } from "../src/zip.js";
import { draftFiles } from "./drafting.js";
import { DATABASE_URL, code, get, send } from "./helpers.js";

interface Draft {
  draft_version: number;
  mode: string;
  manifest: Record<string, unknown> & {
    tokens: { colors: Record<string, string> };
    images?: Record<string, string>;
    brand?: Record<string, unknown>;
    preset?: { id: string; scheme: string };
    css?: string[];
  };
  files: { path: string }[];
}

interface Listed {
  presets: {
    id: string;
    name: string;
    embeds: boolean;
    schemes: { id: string; name: string; kind: string; colors: Record<string, string> }[];
  }[];
}

const BLACK_LOGO = new URL("../../../events/demo/images/logo-black.svg", import.meta.url);
const PLATE = { kind: "light", shape: "rounded", padding: "medium" };

describe.skipIf(!DATABASE_URL)("the presets' paths", () => {
  const t = draftFiles();

  const apply = (body: Record<string, unknown>, session = "embedder") =>
    send(t.h, "PUT", "/api/theming/draft/preset", body, { session });
  const draftNow = async (): Promise<Draft> =>
    (await get(t.h, "/api/theming/draft", { session: "admin" })).json<Draft>();

  /** A draft with the black logo on a light plate and its own Discord colour. */
  async function eventDraft(): Promise<Draft> {
    const fresh = await t.fresh();
    const up = await t.put("images/logo.svg", fresh.draft_version, await readFile(BLACK_LOGO));
    expect(up.statusCode).toBe(200);
    const brand = await send(t.h, "PUT", "/api/theming/draft/brand", {
      draft_version: up.json<Draft>().draft_version,
      primary: "#3ddcff",
      accent: "#b98cff",
      scheme: "dark",
      logo: "images/logo.svg",
      embed_color: "#5865f2",
      logo_plate: PLATE,
    });
    expect(brand.statusCode).toBe(200);
    return brand.json<{ draft: Draft }>().draft;
  }

  it("lists every preset with its schemes and their colours", async () => {
    const res = await get(t.h, "/api/theming/presets", { session: "admin" });
    expect(res.statusCode).toBe(200);
    const { presets } = res.json<Listed>();
    expect(presets.map((p) => p.id)).toEqual([
      "default",
      "daylight",
      "cozy-lan",
      "esports",
      "level-up",
      "synthwave",
      "arcade",
      "terminal",
    ]);
    const levelUp = presets.find((p) => p.id === "level-up");
    expect(levelUp?.embeds).toBe(true);
    expect(presets.find((p) => p.id === "default")?.embeds).toBe(false);
    expect(levelUp?.schemes.map((s) => s.id)).toEqual(["sunset", "berry", "daylight", "contrast"]);
    expect(levelUp?.schemes[2]?.colors.background).toBe("#fff7f0");
    const member = await get(t.h, "/api/theming/presets", { session: "member" });
    expect(member.statusCode).toBe(403);
  });

  it("keeps the event's logo, plate and Discord colour and takes the scheme's colours", async () => {
    const before = await eventDraft();
    const res = await apply({
      preset: "level-up",
      scheme: "daylight",
      draft_version: before.draft_version,
    });
    expect(res.statusCode).toBe(200);
    const after = res.json<Draft>();
    expect(after.manifest.images?.logo).toBe("images/logo.svg");
    expect(after.files.map((f) => f.path)).toContain("images/logo.svg");
    expect(after.manifest.brand).toMatchObject({
      logo_plate: PLATE,
      embed_color: "#5865f2",
      primary: "#b84a00",
      scheme: "light",
    });
    expect(after.manifest.preset).toEqual({ id: "level-up", scheme: "daylight" });
    expect(after.manifest.tokens.colors.background).toBe("#fff7f0");
    // The preset's own look comes with it.
    expect(after.manifest.css?.length).toBeGreaterThan(0);
    expect(after.manifest.name).toBe("Level up");
  });

  it("resets to the preset after a colour change", async () => {
    const before = await eventDraft();
    const applied = (
      await apply({ preset: "default", scheme: "night", draft_version: before.draft_version })
    ).json<Draft>();
    const changed = await send(t.h, "PUT", "/api/theming/draft/brand", {
      draft_version: applied.draft_version,
      primary: "#ff7a45",
      accent: "#f59e0b",
      scheme: "dark",
      logo: "images/logo.svg",
    });
    expect(changed.json<{ draft: Draft }>().draft.manifest.tokens.colors.primary).not.toBe(
      "#3ddcff",
    );
    const { preset } = changed.json<{ draft: Draft }>().draft.manifest;
    const reset = await apply({
      preset: preset?.id,
      scheme: preset?.scheme,
      draft_version: changed.json<{ draft: Draft }>().draft.draft_version,
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json<Draft>().manifest.tokens.colors).toEqual(applied.manifest.tokens.colors);
    expect(reset.json<Draft>().manifest.images?.logo).toBe("images/logo.svg");
  });

  it("keeps a scheme's own colours through a brand change that leaves the colours", async () => {
    const before = await eventDraft();
    const applied = (
      await apply({ preset: "terminal", scheme: "cyan", draft_version: before.draft_version })
    ).json<Draft>();
    const brand = applied.manifest.brand as Record<string, unknown>;
    const corners = await send(t.h, "PUT", "/api/theming/draft/brand", {
      draft_version: applied.draft_version,
      primary: brand.primary,
      accent: brand.accent,
      scheme: brand.scheme,
      logo: "images/logo.svg",
      roundness: "round",
    });
    expect(corners.statusCode).toBe(200);
    const after = corners.json<{ draft: Draft }>().draft;
    expect(after.manifest.brand?.roundness).toBe("round");
    expect(after.manifest.tokens.colors).toEqual(applied.manifest.tokens.colors);
    // A new main colour is what makes the colours again.
    const recoloured = await send(t.h, "PUT", "/api/theming/draft/brand", {
      draft_version: after.draft_version,
      primary: "#ff7a45",
      accent: brand.accent,
      scheme: brand.scheme,
      logo: "images/logo.svg",
    });
    expect(recoloured.json<{ draft: Draft }>().draft.manifest.tokens.colors).not.toEqual(
      applied.manifest.tokens.colors,
    );
  });

  it("keeps Esports' pair, corners, background and boxes under its light scheme, and the event's logo", async () => {
    const before = await eventDraft();
    const res = await apply({
      preset: "esports",
      scheme: "studio",
      draft_version: before.draft_version,
    });
    expect(res.statusCode).toBe(200);
    const after = res.json<Draft>();
    expect(after.manifest.images?.logo).toBe("images/logo.svg");
    expect(after.manifest.brand).toMatchObject({
      font_pair: "saira",
      roundness: "square",
      backdrop: { looks: ["gradient", "glows"] },
      box_opacity: 0.9,
      logo_plate: PLATE,
      primary: "#0050c8",
      scheme: "light",
    });
    expect(after.manifest.preset).toEqual({ id: "esports", scheme: "studio" });
  });

  it("keeps Cozy LAN's simple mode, pill corners and hearth under its light scheme (#785 D12)", async () => {
    const before = await eventDraft();
    const res = await apply({ preset: "cozy-lan", scheme: "linen", draft_version: before.draft_version });
    expect(res.statusCode).toBe(200);
    const after = res.json<Draft>();
    expect(after.mode).toBe("simple");
    expect(after.manifest.images?.logo).toBe("images/logo.svg");
    expect(after.manifest.brand).toMatchObject({
      font_pair: "fredoka-nunito",
      roundness: "pill",
      backdrop: { looks: ["hearth", "particles"] },
      logo_plate: PLATE,
      scheme: "light",
    });
  }); // prettier-ignore

  it("applies each of Part 2's presets in each scheme with its files passing every check", async () => {
    await eventDraft();
    for (const [preset, schemes] of [
      ["synthwave", ["sunset", "miami", "outrun", "vapor", "contrast"]],
      ["cozy-lan", ["fireside", "meadow", "linen", "blossom", "contrast"]],
      ["daylight", ["morning", "sand", "mint", "dusk", "contrast"]],
    ] as const) {
      for (const scheme of schemes) {
        const before = await draftNow();
        const res = await apply({ preset, scheme, draft_version: before.draft_version });
        expect(res.statusCode, `${preset} · ${scheme}`).toBe(200);
        const { problems } = res.json<{ problems: { code: string }[] }>();
        // The test's widget list has no announcements, which Level up's layouts show (D7).
        const own = problems.filter((p) => p.code !== "widget_unknown");
        expect(own, `${preset} · ${scheme}`).toEqual([]);
      }
    }
  }); // prettier-ignore

  it("refuses a preset with embeds to a session without the embeds right", async () => {
    const before = await eventDraft();
    const res = await apply(
      { preset: "level-up", scheme: "sunset", draft_version: before.draft_version },
      "admin",
    );
    expect(res.statusCode).toBe(403);
    expect(await draftNow()).toEqual(before);
  });

  it("refuses a stale version with 409", async () => {
    const before = await eventDraft();
    const res = await apply({
      preset: "default",
      scheme: "daylight",
      draft_version: before.draft_version - 1,
    });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("version_conflict");
  });

  it("starts the draft when there is none", async () => {
    const res = await apply({ preset: "default", scheme: "contrast" }, "admin");
    expect(res.statusCode).toBe(200);
    const draft = res.json<Draft>();
    expect(draft.mode).toBe("simple");
    expect(draft.manifest.preset).toEqual({ id: "default", scheme: "contrast" });
    expect(draft.manifest.tokens.colors.background).toBe("#000000");
    expect(draft.manifest.images?.logo).toBe("images/logo.svg");
  });

  it("keeps the published logo, plate and Discord colour when there is no draft", async () => {
    const own = await eventDraft();
    const published = await send(t.h, "POST", "/api/theming/draft/publish", {
      draft_version: own.draft_version,
    });
    expect(published.statusCode).toBe(201);
    expect((await get(t.h, "/api/theming/draft", { session: "admin" })).statusCode).toBe(404);
    const logoOf = async (url: string): Promise<Buffer | undefined> => {
      const read = await readPackage((await get(t.h, url, { session: "admin" })).rawPayload);
      if (!read.ok) throw new Error(read.why);
      return read.files.get("images/logo.svg");
    };
    const publishedLogo = await logoOf("/api/theming/revisions/1/package");
    expect(publishedLogo).toBeDefined();

    const res = await apply({ preset: "terminal", scheme: "cyan" });
    expect(res.statusCode).toBe(200);
    const draft = res.json<Draft>();
    expect(draft.manifest.images?.logo).toBe("images/logo.svg");
    expect(draft.manifest.brand).toMatchObject({ logo_plate: PLATE, embed_color: "#5865f2" });
    expect(await logoOf("/api/theming/draft/package")).toEqual(publishedLogo);
  });

  it("names an unknown preset or scheme as not found", async () => {
    expect((await apply({ preset: "nope", scheme: "night" })).statusCode).toBe(404);
    expect((await apply({ preset: "default", scheme: "nope" })).statusCode).toBe(404);
    expect(code(await apply({ preset: "default" }))).toBe("invalid_request");
  });
});
