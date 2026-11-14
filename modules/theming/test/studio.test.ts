/** The Studio pages under `/theming/studio/` (plan issue-185 D8, D10): brand kit, advanced, history. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import { draftFiles, png } from "./drafting.js";
import type { DraftBody } from "./drafting.js";
import { DATABASE_URL, OUTSIDE_IP, get, send } from "./helpers.js";
import { STARTERS, STARTERS_WITH_EMBEDS } from "../src/studio-views.js";
import { demoZip, putPackage } from "./packaging.js";

describe("the starters with embeds", () => {
  it("are the demo themes that hold an embeds folder", () => {
    const themes = fileURLToPath(new URL("../../../events/demo/themes/", import.meta.url));
    const withEmbeds = STARTERS.filter((name) => existsSync(join(themes, name, "embeds")));
    expect(withEmbeds.length).toBeGreaterThan(0);
    expect([...STARTERS_WITH_EMBEDS].sort()).toEqual([...withEmbeds].sort());
  });
});

describe.skipIf(!DATABASE_URL)("the Studio pages", () => {
  const t = draftFiles();
  /** A page as `session` sees it; "" sends no session cookie. */
  const page = (path: string, session = "admin") => get(t.h, path, { session });

  const publish = async (version: number) => {
    const res = await send(t.h, "POST", "/api/theming/draft/publish", { draft_version: version });
    expect(res.statusCode).toBe(201);
  };

  describe("access", () => {
    it("sends a browser without a session to admin's sign-in, back to the page", async () => {
      const res = await page("/theming/studio/history?before=3", "");
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe(
        `/admin/sign-in?next=${encodeURIComponent("/theming/studio/history?before=3")}`,
      );
    });

    it("asks for the session before the address rule, as admin's own pages do", async () => {
      const res = await get(t.h, "/theming/studio/", { host: "zeta.test", ip: OUTSIDE_IP });
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe(
        `/admin/sign-in?next=${encodeURIComponent("/theming/studio/")}`,
      );
    });

    it("answers a page saying why to a session without theming.theme.write", async () => {
      const res = await page("/theming/studio/", "member");
      expect(res.statusCode).toBe(403);
      expect(res.headers["content-type"]).toMatch(/^text\/html/);
      expect(res.body).toContain("No access");
      expect(res.body).toContain("the Theme studio");
      // The right's id goes to the log, never to the page (UX audit B3).
      expect(res.body).not.toContain("theming.theme.write");
    });

    it("keeps the admin address rule", async () => {
      const res = await get(t.h, "/theming/studio/", {
        host: "zeta.test",
        session: "admin",
        ip: OUTSIDE_IP,
      });
      expect(res.statusCode).toBe(403);
      expect(res.headers["content-type"]).toMatch(/^text\/html/);
    });

    it("sends the admin page policy: never framed, frames its own previews", async () => {
      for (const path of [
        "/theming/studio/",
        "/theming/studio/advanced",
        "/theming/studio/history",
      ]) {
        const res = await page(path);
        expect(res.statusCode, path).toBe(200);
        const csp = res.headers["content-security-policy"] as string;
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain("frame-src 'self' https://alpha.test/theming/sandbox/");
        expect(csp).toMatch(/style-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.body).toContain('<script src="/theming/studio/static/studio.js"');
        expect(res.body).toContain('<script src="/theming/studio/static/studio-screen.js"');
      }
      const script = await page("/theming/studio/static/studio-screen.js");
      expect(script.statusCode).toBe(200);
      expect(script.headers["content-type"]).toMatch(/^text\/javascript/);
    });
  });

  describe("the brand kit page", () => {
    it("offers every starting point to a writer with the embeds right", async () => {
      const res = await page("/theming/studio/", "embedder");
      expect(res.body).toContain('data-action="start"');
      for (const name of ["default", "terminal", "level-up"]) {
        expect(res.body).toContain(`data-starter="${name}"`);
      }
      // Named as organisers read them, not by their slugs (UX audit C2).
      expect(res.body).toMatch(/data-starter="level-up"[^>]*>Level-up</);
      expect(res.body).not.toContain(">level-up<");
      expect(res.body).not.toContain("theming.embeds.write");
    });

    it("offers a writer without the embeds right only the starters without embeds", async () => {
      const res = await page("/theming/studio/");
      expect(res.body).toContain('data-action="start"');
      expect(res.body).toContain('data-starter="default"');
      for (const name of ["terminal", "level-up"]) {
        expect(res.body).not.toContain(`data-starter="${name}"`);
      }
      // Says why the others are missing, rather than leaving them to a refusal, in words.
      expect(res.body).toContain("ask an event owner to add embeds");
      expect(res.body).not.toContain("theming.embeds.write");
      expect(res.body).not.toContain('data-action="brand"');
      // The current theme is shown, not a draft.
      expect(res.body).toContain('data-fallback-src="/theming/studio/preview/screen"');
      expect(res.body).toContain('src="/theming/studio/preview/hub"');
    });

    it("shows the draft's brand, its colours and what was adjusted", async () => {
      const draft = await t.fresh();
      const res = await send(t.h, "PUT", "/api/theming/draft/brand", {
        draft_version: draft.draft_version,
        primary: "#1e1b4b",
        accent: "#f59e0b",
        scheme: "light",
        embed_color: "#11223344",
      });
      expect(res.statusCode).toBe(200);
      const body = (await page("/theming/studio/")).body;
      expect(body).toContain('data-draft-version="2"');
      // The field takes every colour the schema does, so its value never blocks a Save.
      const pattern = /name="embed_color" pattern="([^"]+)"[^>]*value="#11223344"/.exec(body)?.[1];
      expect(pattern).toBeDefined();
      expect(new RegExp(`^(?:${pattern})$`, "v").test("#11223344")).toBe(true);
      expect(new RegExp(`^(?:${pattern})$`, "v").test("#112233")).toBe(true);
      expect(body).toContain('data-action="brand"');
      expect(body).toContain('value="#1e1b4b"');
      expect(body).toMatch(/<input[^>]*value="light"[^>]*checked/);
      expect(body).toContain('data-token="primary_text"');
      // Each colour shows its colour and its hex; the made colours go by name, not token id.
      expect(body).toMatch(
        /<input[^>]*type="color"[^>]*data-hex-for="primary"[^>]*value="#1e1b4b"/,
      );
      expect(body).toContain("Text on primary");
      expect(body).not.toMatch(/<code>[a-z_]+<\/code>/);
      // The light scheme keeps the dark primary; the accent fails 3:1 on white and is shaded.
      expect(body).toContain('data-adjusted="accent"');
      expect(body).not.toContain('data-adjusted="primary"');
    });

    it("frames the draft preview of the current version on four surfaces", async () => {
      const draft = await t.fresh();
      const v = draft.draft_version;
      const body = (await page("/theming/studio/")).body;
      for (const surface of ["hub", "admin", "discord"]) {
        expect(body).toContain(
          `src="/theming/studio/preview/${surface}?canccu_theme=draft&amp;v=${v}"`,
        );
      }
      // The screen is the real player of a zone, given the draft's look; the sample is its fallback.
      expect(body).toContain(
        `data-fallback-src="/theming/studio/preview/screen?canccu_theme=draft&amp;v=${v}"`,
      );
      expect(body).toContain(`data-tokens-css-url="/theming/studio/draft/tokens.css?v=${v}"`);
    });

    it("puts the form beside the previews, Preview and Publish in the title row, Discard under the form", async () => {
      await t.fresh();
      const body = (await page("/theming/studio/")).body;
      expect(body).toMatch(
        /class="canccu-studio-kit"[\s\S]*data-action="brand"[\s\S]*data-screen-preview/,
      );
      const row = /<div class="canccu-cluster">([\s\S]*?)<\/div><\/div>/.exec(body)?.[1] ?? "";
      expect(row).toMatch(/data-action="preview"[\s\S]*data-action="publish"/);
      expect(row).not.toContain("discard");
      // Sheet 6: Discard under the form, apart from Publish; on a phone the same two buttons
      // share a row above the bottom bar.
      expect(body).toMatch(
        /class="canccu-studio-side"[\s\S]*data-action="font"[\s\S]*canccu-studio-danger-link[^>]*data-action="discard-ask"/,
      );
      expect(body).toMatch(
        /class="canccu-studio-pendbar"><button[^>]*data-action="preview"[\s\S]*data-action="publish"/,
      );
      // Discard asks first, in a dialog of the page's own.
      expect(body).toMatch(/<dialog[^>]*canccu-studio-dialog[\s\S]*data-action="discard"/);
    });

    it("offers the system font as the text font while the theme holds no font", async () => {
      await t.fresh();
      const body = (await page("/theming/studio/")).body;
      const select = /<select[^>]*name="body"[^>]*>([\s\S]*?)<\/select>/.exec(body)?.[1] ?? "";
      expect(select).toMatch(/<option value="" selected>System font<\/option>/);
      expect(select.match(/<option/g)).toHaveLength(1);
    });

    it("says where the draft stands in words", async () => {
      await t.fresh();
      const body = (await page("/theming/studio/")).body;
      expect(body).toContain("last changed by you");
      expect(body).toContain("Nothing published yet");
      for (const jargon of ["advanced mode", "Revision 0", "u_admin", "Draft version"]) {
        expect(body).not.toContain(jargon);
      }
    });

    it("says a clean draft is ready to publish", async () => {
      await t.fresh();
      const body = (await page("/theming/studio/")).body;
      expect(body).toContain("Ready to publish");
      expect(body).toMatch(/<button[^>]*data-action="publish"(?![^>]*disabled)[^>]*>/);
    });

    it("runs publish's check, in words, with the fix as a button (UX audit C1)", async () => {
      const fonted = { host: "fonted.test", session: "admin" };
      const res = await send(t.h, "POST", "/api/theming/draft", { from: "current" }, fonted);
      expect(res.statusCode).toBe(201);
      const body = (await get(t.h, "/theming/studio/", fonted)).body;
      expect(body).toContain("Can&#39;t publish yet");
      expect(body).toContain("The text font Inter isn&#39;t in the theme");
      expect(body).toMatch(/data-action="font-system"[^>]*data-token="body"/);
      expect(body).toMatch(/<button[^>]*data-action="publish"[^>]*disabled/);
      // The field shows the font the problem names, and the problem sits right under it (sheet 6).
      expect(body).toMatch(/<option value="Inter" selected>Inter<\/option>/);
      expect(body).toMatch(
        /data-action="font"[\s\S]*?<\/form>\s*<div class="canccu-notice canccu-notice--down"/,
      );
      expect(body).not.toContain("theme.yaml#");
    });

    it("lets a draft without CSS changes publish at once", async () => {
      await t.fresh();
      const body = (await page("/theming/studio/")).body;
      expect(body).toMatch(/<button[^>]*data-action="publish"/);
      expect(body).not.toContain("data-needs-preview");
    });

    it("holds Publish for the preview when the draft's CSS differs from the current", async () => {
      const res = await putPackage(t.h, await demoZip("terminal"), { session: "embedder" });
      expect(res.statusCode).toBe(200);
      const body = (await page("/theming/studio/")).body;
      expect(body).toMatch(/<button[^>]*data-needs-preview[^>]*disabled/);
    });

    it("no longer holds Publish once the same CSS is published", async () => {
      let res = await putPackage(t.h, await demoZip("terminal"), { session: "embedder" });
      const version = res.json<DraftBody>().draft_version;
      res = await send(
        t.h,
        "POST",
        "/api/theming/draft/publish",
        { draft_version: version },
        { session: "embedder" },
      );
      expect(res.statusCode).toBe(201);
      res = await send(t.h, "POST", "/api/theming/draft", { from: "current" });
      expect(res.statusCode).toBe(201);
      const body = (await page("/theming/studio/")).body;
      expect(body).toMatch(/<button[^>]*data-action="publish"/);
      expect(body).not.toContain("data-needs-preview");
    });

    it("disables Publish for a draft with an error and lists the problem", async () => {
      const draft = await t.fresh();
      const res = await t.put("images/bad.png", draft.draft_version, Buffer.from("not a png"));
      expect(res.statusCode).toBe(200);
      const body = (await page("/theming/studio/")).body;
      expect(body).toMatch(/<button[^>]*data-action="publish"[^>]*disabled/);
      expect(body).toContain("images/bad.png");
      expect(body).toContain("Can&#39;t publish yet");
    });
  });

  describe("the advanced page", () => {
    it("offers the package upload, the problems and the tokens", async () => {
      const draft = await t.fresh();
      const body = (await page("/theming/studio/advanced")).body;
      expect(body).toContain('data-action="package"');
      expect(body).toContain('type="file"');
      expect(body).toContain('data-action="tokens"');
      expect(body).toContain('name="colors.primary"');
      // Colours as swatches with their hex, by name (UX audit C5).
      expect(body).toMatch(/<input[^>]*type="color"[^>]*data-hex-for="colors.text_muted"/);
      expect(body).toContain("Muted text");
      expect(body).toContain('name="sizes.radius"');
      // The motion style's four choices (contracts/theming.md, Motion vocabulary).
      for (const field of ["speed", "intensity", "spotlight", "pack"])
        expect(body).toContain(`name="motion_style.${field}"`);
      expect(body).toContain("Glow and tracing border");
      expect(body).toContain(`data-draft-version="${draft.draft_version}"`);
      expect(body).toContain("Ready to publish");
    });

    it("offers the way back to simple only for an advanced draft", async () => {
      const draft = await t.fresh();
      expect((await page("/theming/studio/advanced")).body).not.toContain('data-action="simple"');
      const res = await send(t.h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: draft.draft_version,
        tokens: { sizes: { radius: "0px" } },
      });
      expect(res.json<{ mode: string }>().mode).toBe("advanced");
      expect((await page("/theming/studio/advanced")).body).toContain('data-action="simple"');
    });

    it("lists the draft's files", async () => {
      const res = await putPackage(t.h, await demoZip("terminal"), { session: "embedder" });
      expect(res.statusCode).toBe(200);
      expect((await page("/theming/studio/advanced")).body).toContain("css/theme.css");
    });

    it("asks for the brand kit before the way back to simple, which needs a brand", async () => {
      const res = await putPackage(t.h, await demoZip("terminal"), { session: "embedder" });
      expect(res.statusCode).toBe(200);
      const body = (await page("/theming/studio/advanced")).body;
      expect(body).not.toContain('data-action="simple"');
      expect(body).toContain("Save the brand kit first");
    });

    it("lets a package start a draft when there is none", async () => {
      const body = (await page("/theming/studio/advanced")).body;
      expect(body).toContain('data-action="package"');
      expect(body).not.toContain("data-draft-version");
    });
  });

  describe("the history page", () => {
    it("lists the revisions newest first, each with a one-click restore but the current", async () => {
      await publish((await t.fresh()).draft_version);
      await publish((await t.fresh()).draft_version);
      const body = (await page("/theming/studio/history")).body;
      expect(body).toContain('data-current-revision="2"');
      expect(body.indexOf("Revision 2")).toBeLessThan(body.indexOf("Revision 1"));
      expect(body).toContain('data-action="restore" data-revision="1"');
      expect(body).not.toContain('data-revision="2"');
      expect(body).toContain('href="/api/theming/revisions/1/package"');
    });

    it("marks a pinned revision", async () => {
      await publish((await t.fresh()).draft_version);
      await withTenant("alpha", () =>
        t.h.db.tenant((c) => c.query(`INSERT INTO theming_pins (theme_revision) VALUES (1)`)),
      );
      const body = (await page("/theming/studio/history")).body;
      await withTenant("alpha", () => t.h.db.tenant((c) => c.query(`DELETE FROM theming_pins`)));
      expect(body).toContain("Pinned");
    });

    it("pages with before", async () => {
      for (let i = 0; i < 3; i++) await publish((await t.fresh()).draft_version);
      const body = (await page("/theming/studio/history?before=2")).body;
      expect(body).toContain("Revision 1");
      expect(body).not.toContain("Revision 3");
    });

    it("offers older revisions only when there are some", async () => {
      // Retention keeps exactly a page (20), so a full page alone must not offer more.
      for (let i = 0; i < 21; i++) await publish((await t.fresh()).draft_version);
      let body = (await page("/theming/studio/history")).body;
      expect(body).toContain("Revision 21");
      expect(body).toContain("Revision 2<");
      expect(body).not.toContain("Older revisions");
      body = (await page("/theming/studio/history?before=2")).body;
      expect(body).toContain("No older revisions");
      expect(body).not.toContain("Nothing published yet");

      // A pinned older revision is kept beyond the 20, so it is a page further.
      await withTenant("alpha", () =>
        t.h.db.tenant((c) => c.query(`INSERT INTO theming_pins (theme_revision) VALUES (2)`)),
      );
      await publish((await t.fresh()).draft_version);
      body = (await page("/theming/studio/history")).body;
      await withTenant("alpha", () => t.h.db.tenant((c) => c.query(`DELETE FROM theming_pins`)));
      expect(body).not.toContain("Revision 2<");
      expect(body).toContain('href="/theming/studio/history?before=3"');
    });

    it("says so when nothing is published yet", async () => {
      const body = (await page("/theming/studio/history")).body;
      expect(body).toContain("Nothing published yet");
      expect(body).toContain('data-current-revision="0"');
    });
  });

  it("shows the draft logo on the brand kit page", async () => {
    const draft = await t.fresh();
    let res = await t.put("images/logo.png", draft.draft_version, await png("#ff0000", 16));
    res = await send(t.h, "PUT", "/api/theming/draft/brand", {
      draft_version: res.json<DraftBody>().draft_version,
      logo: "images/logo.png",
      primary: "#3b82f6",
      accent: "#f59e0b",
      scheme: "dark",
    });
    expect(res.statusCode).toBe(200);
    const body = (await page("/theming/studio/")).body;
    expect(body).toMatch(/<img[^>]*src="\/theming\/draft\/[0-9a-f]{64}\.png"/);
    // The kept logo is one void <input>: an end tag is invalid HTML and leaves a second input.
    expect(body).toContain('<input type="hidden" name="logo" value="images/logo.png">');
    expect(body).not.toContain("</input");
    expect(body).not.toContain("</img");
  });
});
