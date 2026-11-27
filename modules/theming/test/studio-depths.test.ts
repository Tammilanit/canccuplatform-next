/**
 * The Theme studio's depths (plan issue-784 D1, D2, D9, D11, D12): Pick a look, Make it yours and
 * their shared preview column and actions, as the server draws them.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PRESETS } from "../src/presets.js";
import { readsWell } from "../src/studio-yours.js";
import { draftFiles } from "./drafting.js";
import type { DraftBody } from "./drafting.js";
import { DATABASE_URL, get, send } from "./helpers.js";

const BLACK_LOGO = new URL("../../../events/demo/images/logo-black.svg", import.meta.url);

describe("the Reads well badge", () => {
  it("is earned at 4.5:1 and not below", () => {
    expect(readsWell("#000000", "#ffffff")).toBe(true);
    // 4.48:1: close, but a failing pair.
    expect(readsWell("#777777", "#ffffff")).toBe(false);
    expect(readsWell("#767676", "#ffffff")).toBe(true);
  });
});

describe.skipIf(!DATABASE_URL)("the Theme studio's depths", () => {
  const t = draftFiles();
  const page = (path: string, session = "embedder") => get(t.h, path, { session });
  const apply = async (preset: string, scheme: string, session = "embedder") => {
    const now = await get(t.h, "/api/theming/draft", { session: "admin" });
    const version = now.statusCode === 200 ? now.json<DraftBody>().draft_version : undefined;
    const res = await send(
      t.h,
      "PUT",
      "/api/theming/draft/preset",
      { preset, scheme, ...(version === undefined ? {} : { draft_version: version }) },
      { session },
    );
    expect(res.statusCode).toBe(200);
    return res.json<DraftBody>();
  };
  const withBlackLogo = async (): Promise<DraftBody> => {
    const applied = await apply("default", "night");
    const res = await t.put("images/logo.svg", applied.draft_version, await readFile(BLACK_LOGO));
    expect(res.statusCode).toBe(200);
    return res.json<DraftBody>();
  };

  it("shows the four tabs on every depth", async () => {
    await apply("default", "night");
    for (const path of ["", "yours", "advanced", "history"]) {
      const res = await page(`/theming/studio/${path}`);
      expect(res.statusCode, path).toBe(200);
      for (const tab of ["Pick a look", "Make it yours", "Advanced", "History"]) {
        expect(res.body, `${path}: ${tab}`).toContain(`>${tab}</a>`);
      }
    }
  });

  it("sends a visit to Make it yours or Advanced without a draft to the gallery", async () => {
    for (const path of ["yours", "advanced"]) {
      const res = await page(`/theming/studio/${path}`);
      expect(res.statusCode, path).toBe(303);
      expect(res.headers.location).toBe("/theming/studio/");
    }
  });

  describe("Pick a look", () => {
    it("shows every preset's schemes as one-click thumbnails, the chosen one pressed", async () => {
      await apply("level-up", "sunset");
      const res = await page("/theming/studio/");
      const choices = [...res.body.matchAll(/data-action="preset"[^>]*>/g)].map((m) => m[0]);
      const schemes = [...PRESETS.values()].reduce((n, p) => n + p.schemes.length, 0);
      expect(choices).toHaveLength(schemes);
      const chosen = choices.filter((c) => c.includes('aria-pressed="true"'));
      expect(chosen).toHaveLength(1);
      expect(chosen[0]).toContain('data-scheme="sunset"');
      expect(res.body).toContain("Neon berry");
      expect(res.body).toMatch(/<svg[^>]*class="canccu-studio-thumb"/);
      // The thumbnails draw the scheme's own colours.
      expect(res.body).toContain("#fff7f0");
    });

    it("offers the presets with embeds only to a writer with the embeds right", async () => {
      const res = await page("/theming/studio/", "admin");
      const levelUp = [...res.body.matchAll(/<button[^>]*data-preset="level-up"[^>]*>/g)];
      expect(levelUp.length).toBeGreaterThan(0);
      for (const [button] of levelUp) expect(button).toContain("disabled");
      expect(res.body).toContain("which your role doesn't include");
      const plain = [...res.body.matchAll(/<button[^>]*data-preset="default"[^>]*>/g)];
      for (const [button] of plain) expect(button).not.toContain("disabled");
    });

    it("offers the current theme as a start while there is no draft", async () => {
      const res = await page("/theming/studio/");
      expect(res.body).toContain('data-action="start"');
      expect(res.body).not.toContain('href="/api/theming/draft/package"');
    });
  });

  describe("Make it yours", () => {
    it("offers the plate, colours, the pairs, corners and the background as choices", async () => {
      await apply("default", "night");
      const res = await page("/theming/studio/yours");
      expect(res.statusCode).toBe(200);
      for (const kind of ["none", "light", "dark", "surface"]) {
        expect(res.body).toContain(`name="plate_kind" value="${kind}"`);
      }
      expect([...res.body.matchAll(/name="font_pair" value="[a-z-]+"/g)]).toHaveLength(14);
      expect(res.body).toContain('name="font_pair" value=""');
      for (const r of ["square", "soft", "round"]) {
        expect(res.body).toContain(`name="roundness" value="${r}"`);
      }
      for (const look of ["glows", "gradient", "particles", "waves"]) {
        expect(res.body).toContain(`name="looks" value="${look}"`);
      }
      for (const s of ["game_art", "daylight", "hype"]) expect(res.body).toContain(`name="${s}"`);
      expect(res.body).toContain("Screen settings");
      // Plain words only: no token keys or CSS values as labels.
      expect(res.body).not.toMatch(/>\s*(primary_text|text_muted|--canccu-[a-z-]+)\s*</);
    });

    it("suggests a light plate for the black logo on a dark scheme, and not once it has one", async () => {
      const draft = await withBlackLogo();
      let res = await page("/theming/studio/yours");
      expect(res.body).toMatch(/data-action="plate-suggest"[^>]*data-plate="light"/);
      const plated = await send(t.h, "PUT", "/api/theming/draft/brand", {
        draft_version: draft.draft_version,
        primary: "#3ddcff",
        accent: "#b98cff",
        scheme: "dark",
        logo: "images/logo.svg",
        logo_plate: { kind: "light", shape: "rounded", padding: "medium" },
      });
      expect(plated.statusCode).toBe(200);
      res = await page("/theming/studio/yours");
      expect(res.body).not.toContain('data-action="plate-suggest"');
      expect(res.body).toMatch(/name="plate_kind" value="light" checked/);
    });

    it("offers Reset to the preset it came from, by name", async () => {
      await apply("level-up", "berry");
      const res = await page("/theming/studio/yours");
      expect(res.body).toContain("Reset to Level up · Neon berry");
      expect(res.body).toMatch(/data-action="reset-ask"/);
    });

    it("offers to start again from a preset for a draft from elsewhere", async () => {
      await send(t.h, "POST", "/api/theming/draft", { from: "defaults" });
      const res = await page("/theming/studio/yours");
      expect(res.body).toContain("Start again from a preset");
      expect(res.body).not.toContain("Reset to");
    });

    it("draws the screen, the phone and a hub page in the preview column", async () => {
      await apply("default", "night");
      const res = await page("/theming/studio/yours");
      expect(res.body).toContain("data-screen-preview");
      expect(res.body).toMatch(/data-surface="phone"[^>]*src="\/theming\/studio\/preview\/hub\?/);
      expect(res.body).toMatch(/data-surface="page"[^>]*src="\/theming\/studio\/preview\/hub\?/);
      for (const chip of ["Quiet", "Building", "Live", "Morning", "Day", "Late night"]) {
        expect(res.body).toContain(`>${chip}</label>`);
      }
    });

    it("offers Export and Import on every depth with a draft", async () => {
      await apply("default", "night");
      for (const path of ["", "yours", "advanced"]) {
        const res = await page(`/theming/studio/${path}`);
        expect(res.body, path).toContain('href="/api/theming/draft/package"');
        expect(res.body, path).toContain('name="import"');
      }
    });

    it("offers Publish on Advanced too, which now draws the preview to hold it for", async () => {
      await apply("default", "night");
      const res = await page("/theming/studio/advanced");
      expect(res.body).toMatch(/data-action="(publish|light-ask)"/);
      expect(res.body).toContain("data-screen-preview");
    });

    it("holds the light dialog on a dark draft's pages, for a save that turns it light", async () => {
      await apply("default", "night");
      for (const path of ["", "yours", "advanced"]) {
        const res = await page(`/theming/studio/${path}`);
        expect(res.body, path).toContain('id="canccu-studio-light"');
        expect(res.body, path).not.toContain('data-action="light-ask"');
      }
    });

    it("asks before a look replaces CSS of the organiser's own under a preset", async () => {
      const applied = await apply("terminal", "cyan");
      // The preset's own CSS, fonts and templates are not the organiser's.
      expect((await page("/theming/studio/")).body).not.toContain("data-own-work");
      const up = await t.put(
        "css/extra.css",
        applied.draft_version,
        Buffer.from("a { color: red; }"),
      );
      expect(up.statusCode).toBe(200);
      for (const path of ["", "yours"]) {
        expect((await page(`/theming/studio/${path}`)).body, path).toContain('data-own-work="1"');
      }
    });
  });
});
