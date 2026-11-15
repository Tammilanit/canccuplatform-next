/// <reference lib="dom" />
/**
 * The Studio's brand kit and tokens in Chromium (studio.browser.test.ts has the rest of the
 * pages): each change saves at once, a change made mid-save follows it, and a refused file or font
 * is put right.
 */
import type { Route } from "playwright-core";
import { describe, expect, it } from "vitest";
import { SCRIPTED, png } from "./drafting.js";
import { demoZip } from "./packaging.js";
import { browser, studioSuite } from "./studio-page.js";

describe.skipIf(browser === undefined)("the brand kit in Chromium", { timeout: 30_000 }, () => {
  const s = studioSuite();
  const { open, api, draft, act, change, typeHex } = s;

  it("saves the brand kit with a new logo, keeping what it does not show", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const page = await open("/theming/studio/");
    const logo = {
      name: "Our Logo.PNG",
      mimeType: "image/png",
      buffer: await png("#ff7a45", 32),
    };
    await change(page, () => page.setInputFiles('input[name="logo_file"]', logo));
    await typeHex(page, "primary", "#ff7a45");
    await change(page, () => page.check('input[name="scheme"][value="light"]'));
    const saved = await draft();
    expect(saved.manifest.brand).toEqual({
      primary: "#ff7a45",
      accent: "#f59e0b",
      scheme: "light",
    });
    expect(saved.manifest.images).toEqual({ logo: "images/logo.png" });
    expect(await page.locator("img.canccu-studio-drop__logo").count()).toBe(1);

    // A colour picked on the swatch is its hex too; saving without a new file keeps the logo.
    await change(page, () => page.fill('input[data-hex-for="accent"]', "#7c5cff"));
    expect(await page.inputValue('input[name="accent"]')).toBe("#7c5cff");
    const again = await draft();
    expect((again.manifest.brand as { accent: string }).accent).toBe("#7c5cff");
    expect(again.manifest.images).toEqual({ logo: "images/logo.png" });
  });

  it("saves a change made while the last one is still saving, then reloads once", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const page = await open("/theming/studio/");
    const logo = { name: "logo.png", mimeType: "image/png", buffer: await png("#ff7a45", 32) };
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let saves = 0;
    // The first save waits until every other change is made, so they all land mid-save.
    await page.route("**/api/theming/draft/brand", async (route: Route) => {
      saves += 1;
      if (saves === 1) await held;
      await route.continue();
    });
    let loads = 0;
    page.on("load", () => (loads += 1));
    const loaded = page.waitForEvent("load");
    await page.setInputFiles('input[name="logo_file"]', logo);
    const field = page.locator('input[name="primary"]');
    await field.fill("#7c5cff");
    await field.blur();
    await page.check('input[name="scheme"][value="light"]');
    release();
    await loaded;

    expect(saves).toBe(2);
    expect(loads).toBe(1);
    const saved = await draft();
    expect(saved.manifest.brand).toEqual({
      primary: "#7c5cff",
      accent: "#f59e0b",
      scheme: "light",
    });
    expect(saved.manifest.images).toEqual({ logo: "images/logo.png" });
    expect(await page.isChecked('input[name="scheme"][value="light"]')).toBe(true);
    expect(await page.isHidden(".canccu-studio-notice")).toBe(true);
  });

  it("takes a refused logo out of the draft again and says why", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const page = await open("/theming/studio/");
    const logo = { name: "logo.svg", mimeType: "image/svg+xml", buffer: SCRIPTED };
    await change(page, () => page.setInputFiles('input[name="logo_file"]', logo));
    expect(await page.textContent(".canccu-studio-notice")).toContain("images/logo.svg");
    const after = await draft();
    expect((after.files ?? []).map((f) => f.path)).not.toContain("images/logo.svg");
    expect(after.problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("fixes a font the theme does not hold in one click", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const v = (await draft()).draft_version;
    await api("PATCH", "/api/theming/draft/tokens", {
      draft_version: v,
      tokens: { fonts: { body: "Inter" } },
    });
    const page = await open("/theming/studio/");
    expect(await page.locator('.canccu-pagehead [data-action="publish"]').isDisabled()).toBe(true);
    expect(await page.inputValue('select[name="body"]')).toBe("Inter");
    await act(page, '[data-action="font-system"][data-token="body"]');
    expect((await draft()).problems).toEqual([]);
    // Not the notice of a preview on a screen, which waits hidden above (#444).
    const title = ".canccu-notice__title:not([data-screen-preview-title])";
    expect(await page.textContent(title)).toBe("Ready to publish");
    expect(await page.inputValue('select[name="body"]')).toBe("");
  });

  it("sets the text font to a font the theme holds, and back to the system font", async () => {
    const res = await fetch(`${s.origin}/api/theming/draft/package`, {
      method: "PUT",
      headers: {
        cookie: "canccu_session=embedder",
        origin: s.origin,
        "content-type": "application/zip",
      },
      body: new Uint8Array(await demoZip("terminal")),
    });
    expect(res.status).toBe(200);
    const fonts = (await draft()).manifest.fonts as { family: string }[];
    const family = fonts[0]?.family ?? "";
    expect(family).not.toBe("");
    const page = await open("/theming/studio/");
    await change(page, () => page.selectOption('select[name="body"]', ""));
    const tokens = () =>
      draft().then((d) => (d.manifest.tokens as { fonts?: { body?: string } }).fonts?.body);
    expect(await tokens()).toBeUndefined();
    await change(page, () => page.selectOption('select[name="body"]', family));
    expect(await tokens()).toBe(family);
    expect(await page.inputValue('select[name="body"]')).toBe(family);
  });

  it("saves only the tokens that changed", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const page = await open("/theming/studio/advanced");
    await page.fill('input[name="sizes.radius"]', "0px");
    await act(page, '[data-action="tokens"] button[type="submit"]');
    const saved = await draft();
    expect(saved.manifest.mode).toBe("advanced");
    expect((saved.manifest.tokens as { sizes?: unknown }).sizes).toEqual({ radius: "0px" });
    expect((saved.manifest.tokens as { fonts?: unknown }).fonts).toBeUndefined();
  });
});
