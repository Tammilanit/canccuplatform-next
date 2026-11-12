/**
 * The Studio's preview surfaces, the draft's CSS they link, the starting points and the static
 * files (plan issue-185 D7, D9; contracts/theming.md, Draft, preview, publish).
 */
import { describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import { draftFiles, png } from "./drafting.js";
import type { DraftBody } from "./drafting.js";
import { DATABASE_URL, code, get, send } from "./helpers.js";
import { demoZip, putPackage } from "./packaging.js";

const SURFACE_CSP = /frame-ancestors 'self'/;

describe.skipIf(!DATABASE_URL)("the Studio previews", () => {
  const t = draftFiles();
  const as = (path: string, session = "admin") => get(t.h, path, { session });
  const links = (body: string): string[] =>
    [...body.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1] ?? "");

  /** Lists a CSS file in the draft's theme.yaml, as a package upload would. */
  const listCss = (path: string) =>
    withTenant("alpha", () =>
      t.h.db.tenant((c) =>
        c.query(
          `UPDATE theming_drafts SET manifest = manifest || jsonb_build_object('css', jsonb_build_array($1::text))`,
          [path],
        ),
      ),
    );

  /** A draft from the terminal starting point: CSS, fonts, a logo. */
  const terminal = async (): Promise<DraftBody> => {
    const res = await putPackage(t.h, await demoZip("terminal"), { session: "embedder" });
    expect(res.statusCode).toBe(200);
    return res.json<DraftBody>();
  };

  describe("the surfaces", () => {
    it("are surface pages, framed only by the event's own pages and never cached", async () => {
      for (const surface of ["screen", "hub", "admin", "discord"]) {
        const res = await as(`/theming/studio/preview/${surface}`);
        expect(res.statusCode, surface).toBe(200);
        expect(res.headers["content-security-policy"]).toMatch(SURFACE_CSP);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.body).not.toContain("<script");
      }
    });

    it("need theming.theme.write", async () => {
      expect((await as("/theming/studio/preview/screen", "member")).statusCode).toBe(403);
      expect((await as("/theming/studio/preview/screen", "")).statusCode).toBe(303);
    });

    it("answer 404 for a surface there is none of", async () => {
      expect((await as("/theming/studio/preview/billboard")).statusCode).toBe(404);
      // Names an object inherits are no surface either.
      for (const name of ["toString", "constructor", "__proto__"]) {
        expect((await as(`/theming/studio/preview/${name}`)).statusCode).toBe(404);
      }
    });

    it("show the current theme without canccu_theme=draft", async () => {
      await terminal();
      const res = await as("/theming/studio/preview/screen");
      const current = await get(t.h, "/api/theming/current");
      const theme = current.json<{ tokens_css_url: string }>();
      expect(links(res.body)).toEqual([
        "/theming/studio/static/ui.css",
        "/theming/studio/static/preview.css",
        theme.tokens_css_url,
      ]);
      expect(res.body).toContain("canccu-surface--screen");
    });

    it("show the draft with canccu_theme=draft: its tokens, its CSS and its logo", async () => {
      const draft = await terminal();
      const v = draft.draft_version;
      const res = await as(`/theming/studio/preview/screen?canccu_theme=draft&v=${v}`);
      expect(links(res.body)).toEqual([
        "/theming/studio/static/ui.css",
        "/theming/studio/static/preview.css",
        `/theming/studio/draft/tokens.css?v=${v}`,
        `/theming/studio/draft/theme.css?v=${v}`,
      ]);
      expect(res.body).toMatch(
        /class="canccu-header__logo" src="\/theming\/draft\/[0-9a-f]{64}\.svg"/,
      );
      expect(res.body).toContain("canccu-layout");
      expect(res.body).toContain("canccu-widget");
    });

    it("show the current theme for canccu_theme=draft while there is no draft", async () => {
      const res = await as("/theming/studio/preview/hub?canccu_theme=draft&v=3");
      expect(links(res.body).some((l) => l.startsWith("/theming/studio/draft/"))).toBe(false);
      expect(res.body).toContain("canccu-surface--hub");
    });

    it("draw the organiser pages as they are: the shell in the platform's look, no theme", async () => {
      const draft = await terminal();
      const v = draft.draft_version;
      const res = await as(`/theming/studio/preview/admin?canccu_theme=draft&v=${v}`);
      // No organiser page links the event's tokens yet (UX audit C3): the preview shows that.
      expect(links(res.body)).toEqual([
        "/theming/studio/static/ui.css",
        "/theming/studio/static/preview.css",
      ]);
      expect(res.body).toContain("canccu-surface--admin");
      expect(res.body).toContain('class="canccu-header"');
      expect(res.body).toContain('class="canccu-tabs"');
    });

    it("draw the hub's Now card without a badge that means nothing", async () => {
      const res = await as("/theming/studio/preview/hub");
      expect(res.body).not.toContain("canccu-badge--ok");
      expect(res.body).toContain("canccu-badge--late");
      expect(res.body).toContain("Turn on alerts");
    });

    it("draw the Discord card in the embed colour, the primary's unless the brand sets one", async () => {
      const draft = await t.fresh();
      let res = await as("/theming/studio/preview/discord?canccu_theme=draft");
      expect(res.body).toContain('fill="#3b82f6"');
      res = await send(t.h, "PUT", "/api/theming/draft/brand", {
        draft_version: draft.draft_version,
        primary: "#3b82f6",
        accent: "#f59e0b",
        scheme: "dark",
        embed_color: "#12ab34",
      });
      expect(res.statusCode).toBe(200);
      res = await as("/theming/studio/preview/discord?canccu_theme=draft");
      expect(res.body).toContain('fill="#12ab34"');
      // A whole embed: who posts it, the message and its text, as the bot sends it.
      expect(res.body).toContain('class="canccu-preview-discord__author"');
      expect(res.body).toContain("Dinner is 15 min late");
    });
  });

  describe("the draft's CSS", () => {
    it("serves the draft's tokens and admin tokens, never cached", async () => {
      const draft = await t.fresh();
      const res = await send(t.h, "PUT", "/api/theming/draft/brand", {
        draft_version: draft.draft_version,
        primary: "#1e1b4b",
        accent: "#f59e0b",
        scheme: "light",
      });
      expect(res.statusCode).toBe(200);
      const tokens = await as("/theming/studio/draft/tokens.css");
      expect(tokens.statusCode).toBe(200);
      expect(tokens.headers["content-type"]).toMatch(/^text\/css/);
      expect(tokens.headers["cache-control"]).toBe("no-store");
      expect(tokens.headers["x-content-type-options"]).toBe("nosniff");
      expect(tokens.body).toContain("--canccu-color-background: #f8fafc;");
      const admin = await as("/theming/studio/draft/admin-tokens.css");
      expect(admin.body).toContain(":root");
    });

    it("compiles the draft's CSS with its files at their draft addresses", async () => {
      const draft = await t.fresh();
      let res = await t.put("images/bg.png", draft.draft_version, await png());
      res = await t.put(
        "css/a.css",
        res.json<DraftBody>().draft_version,
        Buffer.from(".canccu-page { background: url(images/bg.png); }"),
      );
      expect(res.statusCode).toBe(200);
      await listCss("css/a.css");
      const css = await as("/theming/studio/draft/theme.css");
      expect(css.statusCode).toBe(200);
      expect(css.body).toContain("@layer canccu-theme");
      expect(css.body).toMatch(/url\("?\/theming\/draft\/[0-9a-f]{64}\.png"?\)/);
      expect(css.body).not.toContain("/theming/a/");
    });

    it("answers no_draft without a draft and 404 for another name", async () => {
      expect(code(await as("/theming/studio/draft/tokens.css"))).toBe("no_draft");
      await t.fresh();
      expect((await as("/theming/studio/draft/other.css")).statusCode).toBe(404);
      expect((await as("/theming/studio/draft/theme.css")).body).toBe("");
    });

    it("needs theming.theme.write and keeps every event's draft its own", async () => {
      await terminal();
      expect((await as("/theming/studio/draft/theme.css", "member")).statusCode).toBe(403);
      const other = await get(t.h, "/theming/studio/draft/theme.css", {
        host: "beta.test",
        session: "admin",
      });
      expect(code(other)).toBe("no_draft");
    });

    it("serves a draft whose CSS fails as no CSS at all", async () => {
      const draft = await t.fresh();
      const res = await t.put("css/a.css", draft.draft_version, Buffer.from("@import 'x.css';"));
      expect(res.statusCode).toBe(200);
      await listCss("css/a.css");
      const css = await as("/theming/studio/draft/theme.css");
      expect(css.statusCode).toBe(200);
      expect(css.body).toBe("");
    });
  });

  describe("the starting points", () => {
    it("serve each demo theme as a package the upload takes", async () => {
      for (const name of ["default", "terminal", "level-up"]) {
        const zip = await as(`/theming/studio/starters/${name}.zip`);
        expect(zip.statusCode, name).toBe(200);
        expect(zip.headers["content-type"]).toBe("application/zip");
        const draft = await as("/api/theming/draft");
        const version =
          draft.statusCode === 200 ? draft.json<DraftBody>().draft_version : undefined;
        const res = await putPackage(t.h, zip.rawPayload, {
          session: "embedder",
          ...(version === undefined ? {} : { version }),
        });
        expect(res.statusCode, name).toBe(200);
        expect(res.json<DraftBody>().problems.filter((p) => p.severity === "error")).toEqual([]);
      }
    });

    it("answer 404 for another name and need the right", async () => {
      expect((await as("/theming/studio/starters/other.zip")).statusCode).toBe(404);
      expect((await as("/theming/studio/starters/terminal.zip", "member")).statusCode).toBe(403);
    });
  });

  describe("the static files", () => {
    it("serve ui.css, the Studio's CSS and script, and nothing else", async () => {
      for (const [name, type] of [
        ["ui.css", "text/css"],
        ["studio.css", "text/css"],
        ["preview.css", "text/css"],
        ["studio.js", "text/javascript"],
      ] as const) {
        const res = await as(`/theming/studio/static/${name}`, "");
        expect(res.statusCode, name).toBe(200);
        expect(res.headers["content-type"]).toMatch(new RegExp(`^${type}`));
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
      }
      expect((await as("/theming/studio/static/ui.css", "")).body).toContain("@layer canccu-base");
      expect((await as("/theming/studio/static/../package.json", "")).statusCode).toBe(404);
      expect((await as("/theming/studio/static/other.js", "")).statusCode).toBe(404);
      for (const name of ["constructor", "toString", "hasOwnProperty"]) {
        expect((await as(`/theming/studio/static/${name}`, "")).statusCode).toBe(404);
      }
    });

    it("keep the preview's own rules under the theme's layer", async () => {
      const css = (await as("/theming/studio/static/preview.css", "")).body;
      expect(css.trim()).toMatch(/^(\/\*[\s\S]*?\*\/\s*)?@layer canccu-base \{[\s\S]*\}$/);
    });
  });

  it("shows no logo for a draft without one", async () => {
    const draft = await t.fresh();
    await t.put("images/x.png", draft.draft_version, await png());
    const res = await as("/theming/studio/preview/hub?canccu_theme=draft");
    expect(res.body).not.toContain("canccu-header__logo");
  });
});
