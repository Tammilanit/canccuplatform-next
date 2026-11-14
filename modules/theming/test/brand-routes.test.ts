/** `PUT …/draft/brand` and `POST …/draft/mode` (contracts/theming.md, Brand kit and Advanced mode). */
import { describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import { COLOR_TOKENS } from "@canccu/ui";
import { generateColors } from "../src/brand.js";
import { draftFiles, png, woff2 } from "./drafting.js";
import { DATABASE_URL, code, get, send } from "./helpers.js";

interface Draft {
  draft_version: number;
  mode: string;
  manifest: Record<string, unknown> & {
    tokens: Record<string, Record<string, string> | string>;
    images?: Record<string, string>;
    brand?: Record<string, string>;
    layouts?: { regions: { widgets: Record<string, unknown>[] }[] }[];
  };
  files: { path: string; bytes: number }[];
  problems: { severity: string; code: string }[];
}

const BRAND = { primary: "#1e1b4b", accent: "#f59e0b", scheme: "dark" };

describe.skipIf(!DATABASE_URL)("the brand kit's paths", () => {
  const t = draftFiles();

  /** A fresh draft with `images/logo.png` and `images/icon.png` in it. */
  async function withImages(): Promise<number> {
    const draft = await t.fresh();
    let res = await t.put("images/logo.png", draft.draft_version, await png("#ff0000", 64));
    expect(res.statusCode).toBe(200);
    res = await t.put("images/icon.png", res.json<Draft>().draft_version, await png("#00ff00"));
    expect(res.statusCode).toBe(200);
    return res.json<Draft>().draft_version;
  }

  const putBrand = (body: Record<string, unknown>, session?: string) =>
    send(t.h, "PUT", "/api/theming/draft/brand", body, session ? { session } : {});

  const toSimple = (version: number, session?: string, extra: Record<string, unknown> = {}) =>
    send(
      t.h,
      "POST",
      "/api/theming/draft/mode",
      { draft_version: version, mode: "simple", remove_advanced: true, ...extra },
      session ? { session } : {},
    );

  /** Writes the draft's manifest directly, as a package upload (#244) would leave it. */
  const setManifest = (manifest: Record<string, unknown>) =>
    withTenant("alpha", () =>
      t.h.db.tenant((c) =>
        c.query(`UPDATE theming_drafts SET manifest = $1`, [JSON.stringify(manifest)]),
      ),
    );

  const draftNow = async (): Promise<Draft> =>
    (await get(t.h, "/api/theming/draft", { session: "admin" })).json<Draft>();

  describe("PUT /api/theming/draft/brand", () => {
    it("generates the colours, takes the logo and icon, and names what it shaded", async () => {
      const version = await withImages();
      const res = await putBrand({
        ...BRAND,
        draft_version: version,
        logo: "images/logo.png",
        icon: "images/icon.png",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ draft: Draft; adjusted: string[] }>();
      expect(body.adjusted).toEqual(["primary"]);
      expect(body.draft.draft_version).toBe(version + 1);
      expect(body.draft.mode).toBe("simple");
      expect(body.draft.manifest.brand).toEqual(BRAND);
      expect(body.draft.manifest.images).toEqual({
        logo: "images/logo.png",
        icon: "images/icon.png",
      });
      expect(body.draft.manifest.tokens.colors).toEqual(
        generateColors({ primary: "#1e1b4b", accent: "#f59e0b", scheme: "dark" }).colors,
      );
      expect(body.draft.problems).toEqual([]);
    });

    it("replaces the brand whole: a field left out is gone", async () => {
      const version = await withImages();
      const first = await putBrand({
        ...BRAND,
        draft_version: version,
        logo: "images/logo.png",
        icon: "images/icon.png",
        embed_color: "#123456",
      });
      expect(first.statusCode).toBe(200);
      const res = await putBrand({
        ...BRAND,
        scheme: "light",
        draft_version: version + 1,
        logo: "images/logo.png",
      });
      expect(res.statusCode).toBe(200);
      const draft = res.json<{ draft: Draft }>().draft;
      expect(draft.manifest.brand).toEqual({ ...BRAND, scheme: "light" });
      expect(draft.manifest.images).toEqual({ logo: "images/logo.png" });
      expect((draft.manifest.tokens.colors as Record<string, string>).background).toBe("#f8fafc");
    });

    it("never changes the mode: an advanced theme keeps its fonts and sizes", async () => {
      const draft = await t.fresh();
      const edited = await send(t.h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: draft.draft_version,
        tokens: { fonts: { body: "serif" }, sizes: { radius: "2px" }, motion: "calm" },
      });
      expect(edited.json<Draft>().mode).toBe("advanced");
      const res = await putBrand({ ...BRAND, draft_version: draft.draft_version + 1 });
      expect(res.statusCode).toBe(200);
      const out = res.json<{ draft: Draft }>().draft;
      expect(out.mode).toBe("advanced");
      expect(out.manifest.tokens.fonts).toEqual({ body: "serif" });
      expect(out.manifest.tokens.sizes).toEqual({ radius: "2px" });
      expect(out.manifest.tokens.motion).toBe("calm");
      expect((out.manifest.tokens.colors as Record<string, string>).primary).not.toBe("#1e1b4b");
    });

    it("refuses a logo or icon that is not an image in the draft", async () => {
      const draft = await t.fresh();
      let res = await putBrand({
        ...BRAND,
        draft_version: draft.draft_version,
        logo: "images/none.png",
      });
      expect(res.statusCode).toBe(400);
      expect(code(res)).toBe("invalid_request");
      // An upload that failed its checks holds a problem, not an image.
      const failed = await t.put("images/bad.png", draft.draft_version, Buffer.from("not a png"));
      expect(failed.statusCode).toBe(200);
      res = await putBrand({
        ...BRAND,
        draft_version: draft.draft_version + 1,
        icon: "images/bad.png",
      });
      expect(res.statusCode).toBe(400);
      expect((await draftNow()).draft_version).toBe(draft.draft_version + 1);
    });

    it("validates the body", async () => {
      const draft = await t.fresh();
      const v = draft.draft_version;
      for (const body of [
        { ...BRAND },
        { ...BRAND, draft_version: v, scheme: "dusk" },
        { ...BRAND, draft_version: v, primary: "blue" },
        { ...BRAND, draft_version: v, extra: 1 },
        { ...BRAND, draft_version: v, logo: "fonts/x.woff2" },
        { draft_version: v, primary: "#000000", scheme: "dark" },
      ]) {
        const res = await putBrand(body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
      }
    });

    it("answers a stale version, no draft and a missing right as the other draft writes do", async () => {
      expect((await putBrand({ ...BRAND, draft_version: 1 })).statusCode).toBe(404);
      const draft = await t.fresh();
      const stale = await putBrand({ ...BRAND, draft_version: draft.draft_version + 1 });
      expect(stale.statusCode).toBe(409);
      expect(code(stale)).toBe("version_conflict");
      const member = await putBrand({ ...BRAND, draft_version: draft.draft_version }, "member");
      expect(member.statusCode).toBe(403);
    });

    it("publishes the brand's embed colour, else primary", async () => {
      let draft = await t.fresh();
      let res = await putBrand({
        ...BRAND,
        draft_version: draft.draft_version,
        embed_color: "#abcdef80",
      });
      expect(res.statusCode).toBe(200);
      let pub = await send(t.h, "POST", "/api/theming/draft/publish", {
        draft_version: draft.draft_version + 1,
      });
      expect(pub.statusCode).toBe(201);
      let current = (await get(t.h, "/api/theming/current")).json<{ embed_color: number }>();
      expect(current.embed_color).toBe(0xabcdef);

      draft = await t.fresh();
      res = await putBrand({ ...BRAND, draft_version: draft.draft_version });
      const primary = (
        res.json<{ draft: Draft }>().draft.manifest.tokens.colors as Record<string, string>
      ).primary as string;
      pub = await send(t.h, "POST", "/api/theming/draft/publish", {
        draft_version: draft.draft_version + 1,
      });
      expect(pub.statusCode).toBe(201);
      current = (await get(t.h, "/api/theming/current")).json<{ embed_color: number }>();
      expect(current.embed_color).toBe(parseInt(primary.slice(1), 16));
    });
  });

  describe("POST /api/theming/draft/mode", () => {
    const LAYOUT = {
      id: "main",
      name: "Main",
      aspect: "16:9",
      grid: { columns: 2, rows: 1 },
      regions: [
        {
          id: "left",
          area: { column: 1, row: 1, columns: 1, rows: 1 },
          widgets: [
            { widget: "clock", template: "big_clock" },
            { widget: "embed", embed: "drift" },
          ],
        },
        {
          id: "right",
          area: { column: 2, row: 1, columns: 1, rows: 1 },
          widgets: [{ widget: "logo" }],
        },
      ],
    };

    /** An advanced draft: a font file, the font and size tokens, CSS, a template and a layout using it. */
    async function advanced(): Promise<number> {
      const version = await withImages();
      const res = await t.put("fonts/brand.woff2", version, woff2());
      expect(res.statusCode).toBe(200);
      const current = await draftNow();
      await setManifest({
        ...current.manifest,
        mode: "advanced",
        brand: BRAND,
        images: { logo: "images/logo.png" },
        css: ["css/theme.css"],
        fonts: [
          {
            family: "Brand",
            file: "fonts/brand.woff2",
            licence: "OFL-1.1",
            licence_file: "fonts/OFL.txt",
          },
        ],
        templates: { big_clock: { widget: "clock", file: "templates/big_clock.html" } },
        tokens: {
          colors: { ...COLOR_TOKENS, primary: "#ff00ff" },
          fonts: { body: "Brand" },
          sizes: { radius: "0px" },
          motion: "none",
          motion_style: { pack: "broadcast" },
        },
        layouts: [LAYOUT],
      });
      return current.draft_version;
    }

    it("removes the advanced parts, keeps images, layouts, motion and motion_style, and regenerates the colours", async () => {
      const version = await advanced();
      const res = await toSimple(version);
      expect(res.statusCode).toBe(200);
      const body = res.json<{ draft: Draft; removed: string[] }>();
      expect(body.removed).toEqual(["fonts/brand.woff2"]);
      const m = body.draft.manifest;
      expect(body.draft.mode).toBe("simple");
      for (const key of ["css", "fonts", "templates", "embeds"]) expect(m).not.toHaveProperty(key);
      expect(m.tokens).toEqual({
        colors: generateColors({ primary: "#1e1b4b", accent: "#f59e0b", scheme: "dark" }).colors,
        motion: "none",
        motion_style: { pack: "broadcast" },
      });
      expect(m.images).toEqual({ logo: "images/logo.png" });
      expect(m.brand).toEqual(BRAND);
      // The default templates stand in for the removed one; the embed's widget has nothing to show.
      expect(m.layouts?.[0]?.regions[0]?.widgets).toEqual([{ widget: "clock" }]);
      expect(m.layouts?.[0]?.regions[1]?.widgets).toEqual([{ widget: "logo" }]);
      expect(body.draft.files.map((f) => f.path)).toEqual(["images/icon.png", "images/logo.png"]);
      expect(body.draft.problems).toEqual([]);
      expect(await t.fileAt("fonts/brand.woff2")).toBeUndefined();
      // The font's bytes are given back: only the two images remain stored.
      expect(await t.storedBytes()).toBe(body.draft.files.reduce((n, f) => n + f.bytes, 0));
    });

    it("answers 409 brand_missing without a brand, and changes nothing", async () => {
      const version = await advanced();
      const current = await draftNow();
      await setManifest(
        Object.fromEntries(Object.entries(current.manifest).filter(([k]) => k !== "brand")),
      );
      const res = await toSimple(version);
      expect(res.statusCode).toBe(409);
      expect(code(res)).toBe("brand_missing");
      expect(await t.fileAt("fonts/brand.woff2")).toBeDefined();
    });

    it("needs remove_advanced: true and mode: simple", async () => {
      const draft = await t.fresh();
      for (const extra of [{ remove_advanced: false }, { mode: "advanced" }, { other: 1 }]) {
        expect((await toSimple(draft.draft_version, undefined, extra)).statusCode).toBe(400);
      }
      expect((await toSimple(draft.draft_version, "member")).statusCode).toBe(403);
      expect(code(await toSimple(draft.draft_version + 1))).toBe("version_conflict");
    });

    it("removes embeds only with theming.embeds.write, and audits it", async () => {
      t.h.audit.length = 0;
      const version = await advanced();
      await withTenant("alpha", () =>
        t.h.db.tenant(async (c) => {
          const { putEmbed } = await import("../src/embeds.js");
          await putEmbed(
            c,
            t.h.files,
            "draft",
            "drift",
            "embeds/drift/index.html",
            new Map([["embeds/drift/index.html", Buffer.from("<!doctype html><p>hi</p>")]]),
          );
          await c.query(
            `UPDATE theming_drafts SET manifest = jsonb_set(manifest, '{embeds}', $1)`,
            [JSON.stringify({ drift: { entry: "embeds/drift/index.html", files: [] } })],
          );
        }),
      );
      const refused = await toSimple(version, "admin");
      expect(refused.statusCode).toBe(403);
      expect(t.h.audit).toEqual([]);

      const res = await toSimple(version, "embedder");
      expect(res.statusCode).toBe(200);
      expect(res.json<{ removed: string[] }>().removed).toEqual([
        "embeds/drift/index.html",
        "fonts/brand.woff2",
      ]);
      expect(t.h.audit).toEqual([
        expect.objectContaining({
          tenant_id: "alpha",
          actor_user_id: "u_embedder",
          action: "theming.embeds.removed",
          changes: { embeds: { old: ["drift"], new: [] } },
        }),
      ]);
      const left = await withTenant("alpha", () =>
        t.h.db.tenant((c) => c.query(`SELECT 1 FROM theming_embed_files WHERE owner = 'draft'`)),
      );
      expect(left.rows).toEqual([]);
    });
  });
});
