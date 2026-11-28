/// <reference lib="dom" />
/**
 * The live preview of Pick a look and Make it yours in Chromium (plan issue-784 D2, D3, D11):
 * a change reaches every frame before its save answers, saves never reload the page, a stale save
 * says so, and Publish still waits for the frames to show the saved version. Screen's zones are not
 * served here, so the screen frame is the Studio's sample screen, which takes the same messages.
 */
import { readFile } from "node:fs/promises";
import type { Frame, Page, Route } from "playwright-core";
import { describe, expect, it } from "vitest";
import { generateColors } from "../src/brand.js";
import { minBoxOpacity } from "../src/contrast.js";
import { seeThrough } from "../src/studio-yours-background.js";
import { png } from "./drafting.js";
import { browser, studioSuite } from "./studio-page.js";

const BLACK_LOGO = new URL("../../../events/demo/images/logo-black.svg", import.meta.url);

describe.skipIf(browser === undefined)("the live preview in Chromium", { timeout: 40_000 }, () => {
  const s = studioSuite();
  const { open, api, draft, context } = s;

  /** A draft from Default · Night with the black logo, as an organiser starts. */
  async function eventDraft(): Promise<void> {
    const applied = await api("PUT", "/api/theming/draft/preset", {
      preset: "default",
      scheme: "night",
    });
    expect(applied.status).toBe(200);
    const version = ((await applied.json()) as { draft_version: number }).draft_version;
    const put = await fetch(
      `${s.origin}/api/theming/draft/file?path=images%2Flogo.svg&draft_version=${version}`,
      {
        method: "PUT",
        headers: { cookie: "canccu_session=embedder", origin: s.origin },
        body: new Uint8Array(await readFile(BLACK_LOGO)),
      },
    );
    expect(put.status).toBe(200);
  }

  /** The frame an iframe of the preview column shows. */
  async function frame(page: Page, selector: string): Promise<Frame> {
    const f = await (await page.waitForSelector(selector, { state: "attached" })).contentFrame();
    if (f === null) throw new Error(`${selector} shows no frame`);
    return f;
  }
  const SCREEN = "iframe[data-screen-preview]";
  const PHONE = 'iframe[data-surface="phone"]';
  const HUB = 'iframe[data-surface="page"]';
  const cssVar = (f: Frame, name: string) =>
    f.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  /** Waits until the page has saved the version after `version` and says so. */
  const savedAfter = (page: Page, version: number) =>
    page.waitForFunction(
      (v) => {
        const root = document.querySelector<HTMLElement>(".canccu-studio");
        return Number(root?.dataset.draftVersion) > v && root?.dataset.saveState === "saved";
      },
      version,
      { timeout: 15_000 },
    );

  it("tries a scheme from the gallery in the screen frame without reloading the page", async () => {
    await eventDraft();
    const page = await open("/theming/studio/");
    let loads = 0;
    page.on("load", () => (loads += 1));
    const before = (await draft()).draft_version;
    await page.click('[data-action="preset"][data-preset="default"][data-scheme="daylight"]');
    const screen = await frame(page, SCREEN);
    await expect.poll(() => cssVar(screen, "--canccu-color-background")).toBe("#f5f6fb");
    await savedAfter(page, before);
    expect(loads).toBe(0);
    expect((await draft()).manifest.preset).toEqual({ id: "default", scheme: "daylight" });
    expect(
      await page.getAttribute(
        '[data-action="preset"][data-preset="default"][data-scheme="daylight"]',
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("puts the logo on the plate the check suggests, in the screen frame too", async () => {
    await eventDraft();
    const page = await open("/theming/studio/yours");
    const suggest = page.locator('[data-action="plate-suggest"]');
    expect(await suggest.getAttribute("data-plate")).toBe("light");
    const before = (await draft()).draft_version;
    await suggest.click();
    await savedAfter(page, before);
    const brand = (await draft()).manifest.brand as { logo_plate?: { kind: string } };
    expect(brand.logo_plate?.kind).toBe("light");
    const screen = await frame(page, SCREEN);
    await expect.poll(() => cssVar(screen, "--canccu-logo-plate")).toBe("#f7f7f8");
    // Once on a plate, the check has nothing more to say.
    await expect.poll(() => page.locator('[data-action="plate-suggest"]').count()).toBe(0);
  });

  it("sends a colour change to all three frames before its save answers", async () => {
    await eventDraft();
    const page = await open("/theming/studio/yours");
    const held: Route[] = [];
    await page.route("**/api/theming/draft/brand", (r) => {
      held.push(r);
    });
    // Only the first save is held: the handler stays, so nothing is left to it when it goes.
    await page.locator('input[data-hex-for="primary"]').fill("#ff7a45");
    for (const selector of [SCREEN, PHONE, HUB]) {
      const f = await frame(page, selector);
      await expect.poll(() => cssVar(f, "--canccu-color-primary")).toBe("#ff7a45");
    }
    await expect.poll(() => held.length).toBe(1);
    expect(await page.getAttribute(".canccu-studio", "data-save-state")).toBe("saving");
    await held[0]?.continue();
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>(".canccu-studio")?.dataset.saveState === "saved",
    );
    expect((await draft()).manifest.brand).toMatchObject({ primary: "#ff7a45" });
  });

  it("applies a change to a frame that was still loading once it is ready", async () => {
    await eventDraft();
    const page = await (await context()).newPage();
    const held: Route[] = [];
    let holding = true;
    await page.route("**/theming/studio/preview/hub?*", (r) =>
      holding ? void held.push(r) : r.continue(),
    );
    await page.goto(`${s.origin}/theming/studio/yours`, { waitUntil: "domcontentloaded" });
    await expect.poll(() => held.length).toBe(2);
    await page.locator('input[data-hex-for="accent"]').fill("#22aa88");
    holding = false;
    await Promise.all(held.map((r) => r.continue()));
    for (const selector of [PHONE, HUB]) {
      const f = await frame(page, selector);
      await expect.poll(() => cssVar(f, "--canccu-color-accent")).toBe("#22aa88");
    }
  });

  it("says another organiser changed the draft, and saves nothing over it", async () => {
    await eventDraft();
    const first = await open("/theming/studio/yours");
    const second = await open("/theming/studio/yours");
    const before = (await draft()).draft_version;
    await first.click('input[name="roundness"][value="round"]', { force: true });
    await savedAfter(first, before);
    const saved = await draft();
    await second.click('input[name="roundness"][value="square"]', { force: true });
    await second.waitForFunction(
      () => document.querySelector<HTMLElement>(".canccu-studio")?.dataset.saveState === "conflict",
    );
    expect(await second.textContent(".canccu-studio-notice")).toContain("Another organiser");
    expect(await draft()).toEqual(saved);
  });

  it("holds Publish after a save until the frames show the saved version", async () => {
    await eventDraft();
    // Terminal brings CSS, so its draft's Publish waits for the previews (issue-185 D10).
    const applied = await api("PUT", "/api/theming/draft/preset", {
      preset: "terminal",
      scheme: "cyan",
      draft_version: (await draft()).draft_version,
    });
    expect(applied.status).toBe(200);
    const page = await open("/theming/studio/yours");
    const publish = page.locator('.canccu-pagehead [data-action="publish"]');
    await expect.poll(() => publish.isDisabled()).toBe(false);
    const held: Route[] = [];
    let holding = true;
    await page.route("**/theming/studio/preview/**", (r) =>
      holding ? void held.push(r) : r.continue(),
    );
    const before = (await draft()).draft_version;
    await page.click('input[name="roundness"][value="round"]', { force: true });
    await savedAfter(page, before);
    await expect.poll(() => held.length).toBeGreaterThan(0);
    expect(await publish.isDisabled()).toBe(true);
    holding = false;
    await Promise.all(held.map((r) => r.continue()));
    await expect.poll(() => publish.isDisabled()).toBe(false);
  });

  it("saves the box transparency and shows it on the screen frame before the save answers", async () => {
    await eventDraft();
    const page = await open("/theming/studio/yours");
    const before = (await draft()).draft_version;
    await page.locator('input[name="box_opacity"]').fill("1");
    const screen = await frame(page, SCREEN);
    await expect.poll(() => cssVar(screen, "--canccu-box-opacity")).toBe("1");
    await savedAfter(page, before);
    expect((await draft()).manifest.brand).toMatchObject({ box_opacity: 1 });
  });

  it("shows the raised box transparency the screens draw, in the frame and on the slider", async () => {
    await eventDraft();
    // Colours whose boxes need more than 0.5 of solid (box-opacity.test.ts).
    const brand = { primary: "#ff4fd8", accent: "#22e4ff", scheme: "dark" as const };
    const min = minBoxOpacity(generateColors(brand).colors);
    expect(min).toBeGreaterThan(0.5);
    const put = await api("PUT", "/api/theming/draft/brand", {
      ...brand,
      box_opacity: 1,
      draft_version: (await draft()).draft_version,
    });
    expect(put.status).toBe(200);
    const page = await open("/theming/studio/yours");
    const slider = page.locator('input[name="box_opacity"]');
    const screen = await frame(page, SCREEN);
    const before = (await draft()).draft_version;
    await slider.fill("0.5");
    await expect.poll(() => cssVar(screen, "--canccu-box-opacity")).toBe("0.5");
    await savedAfter(page, before);
    expect((await draft()).manifest.brand).toMatchObject({ box_opacity: min });
    // The save raised it: the frame and the slider show what the screens draw, not what was asked.
    await expect.poll(() => cssVar(screen, "--canccu-box-opacity")).toBe(String(min));
    await expect.poll(() => slider.inputValue()).toBe(String(min));
    await expect
      .poll(() => page.locator('output[for="canccu-studio-box-opacity"]').textContent())
      .toBe(seeThrough(min));
  });

  it("keeps the screen frame in place over a save: the page never reloads it", async () => {
    await eventDraft();
    const page = await open("/theming/studio/yours");
    // Where the frame sits in the preview column, which stays in view as the page scrolls.
    const box = () =>
      page.evaluate((sel) => {
        const frame = document.querySelector(sel)?.getBoundingClientRect();
        const column = document.querySelector(".canccu-studio-column")?.getBoundingClientRect();
        return frame && column
          ? { x: frame.x - column.x, y: frame.y - column.y, w: frame.width, h: frame.height }
          : undefined;
      }, SCREEN);
    const at = await box();
    const before = (await draft()).draft_version;
    await page.click('input[name="font_pair"][value="space-inter"]', { force: true });
    await savedAfter(page, before);
    expect(await box()).toEqual(at);
    const screen = await frame(page, SCREEN);
    await expect.poll(() => cssVar(screen, "--canccu-font-heading")).toContain("Space Grotesk");
  });
  it("keeps the preset's pair and corners through the next edit after Reset", async () => {
    await eventDraft();
    const preset = (await draft()).manifest.brand as Record<string, unknown>;
    const page = await open("/theming/studio/yours");
    let before = (await draft()).draft_version;
    await page.click('input[name="font_pair"][value="space-inter"]', { force: true });
    await page.click('input[name="roundness"][value="round"]', { force: true });
    await savedAfter(page, before);
    expect((await draft()).manifest.brand).toMatchObject({
      font_pair: "space-inter",
      roundness: "round",
    });
    await page.click('[data-action="reset-ask"]');
    await Promise.all([
      page.waitForEvent("load"),
      page.click('#canccu-studio-reset [data-action="preset"]'),
    ]);
    before = (await draft()).draft_version;
    await page.click('[data-action="plate-suggest"]');
    await savedAfter(page, before);
    const brand = (await draft()).manifest.brand as Record<string, unknown>;
    expect(brand.font_pair).toEqual(preset.font_pair);
    // The form sends its corners on every save: the preset's, or Soft where it names none.
    expect(brand.roundness).toEqual(preset.roundness ?? "soft");
  });

  it("asks before Publish when a save without a reload turns the draft light", async () => {
    await eventDraft();
    const page = await open("/theming/studio/");
    const before = (await draft()).draft_version;
    await page.click('[data-action="preset"][data-preset="default"][data-scheme="daylight"]');
    await savedAfter(page, before);
    const publish = page.locator('.canccu-pagehead [data-action="light-ask"]');
    await expect.poll(() => publish.isDisabled()).toBe(false);
    await publish.click();
    await expect.poll(() => page.isVisible("#canccu-studio-light")).toBe(true);
  });

  it("never names an older version than the last save, whatever refresh lands late", async () => {
    await eventDraft();
    const page = await open("/theming/studio/yours");
    // The first refresh is answered as the page was then, and only after the next save's.
    let late: (() => Promise<void>) | undefined;
    await page.route("**/theming/studio/yours", async (r) => {
      if (late !== undefined) return r.continue();
      const answer = await r.fetch();
      late = () => r.fulfill({ response: answer });
    });
    let before = (await draft()).draft_version;
    await page.click('input[name="roundness"][value="round"]', { force: true });
    // Its refresh is the one held, so the page is not yet "saved": the draft says it is.
    await expect.poll(async () => (await draft()).draft_version).toBeGreaterThan(before);
    await expect.poll(() => late !== undefined).toBe(true);
    before = (await draft()).draft_version;
    await page.click('input[name="roundness"][value="square"]', { force: true });
    await savedAfter(page, before);
    await late?.();
    await page.waitForTimeout(300);
    before = (await draft()).draft_version;
    await page.click('input[name="font_pair"][value="space-inter"]', { force: true });
    await savedAfter(page, before);
    expect(await page.getAttribute(".canccu-studio", "data-save-state")).toBe("saved");
    expect((await draft()).manifest.brand).toMatchObject({
      roundness: "square",
      font_pair: "space-inter",
    });
  });

  it("stops, rather than adopt a version another organiser wrote before the refresh was read", async () => {
    await eventDraft();
    const page = await open("/theming/studio/yours");
    let hold = true;
    await page.route("**/theming/studio/yours", async (r) => {
      if (!hold) return r.continue();
      hold = false;
      // Another organiser saves after this page's save and before its refresh is read.
      const other = await api("PUT", "/api/theming/draft/preset", {
        preset: "default",
        scheme: "daylight",
        draft_version: (await draft()).draft_version,
      });
      expect(other.status).toBe(200);
      await r.continue();
    });
    const before = (await draft()).draft_version;
    await page.click('input[name="roundness"][value="round"]', { force: true });
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>(".canccu-studio")?.dataset.saveState === "conflict",
    );
    expect(await page.textContent(".canccu-studio-notice")).toContain("Another organiser");
    const stored = await draft();
    expect(stored.draft_version).toBeGreaterThan(before + 1);
    await page.click('input[name="roundness"][value="square"]', { force: true });
    await page.waitForTimeout(800);
    expect(await draft()).toEqual(stored);
  });

  it("shows the draft's colours again when a look is refused, or kept out by Keep my draft", async () => {
    await eventDraft();
    const page = await open("/theming/studio/");
    const screen = await frame(page, SCREEN);
    const tokens = (await draft()).manifest.tokens as { colors: { background: string } };
    const night = tokens.colors.background;
    await expect.poll(() => cssVar(screen, "--canccu-color-background")).toBe(night);
    await page.route("**/api/theming/draft/preset", (r) =>
      r.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "missing_right", message: "No." } }),
      }),
    );
    await page.click('[data-action="preset"][data-preset="default"][data-scheme="daylight"]');
    await expect.poll(() => page.isVisible(".canccu-studio-notice")).toBe(true);
    await expect.poll(() => cssVar(screen, "--canccu-color-background")).toBe(night);

    // Own CSS under the preset: the look waits for a yes, and the frames with it.
    await page.unroute("**/api/theming/draft/preset");
    const css = await fetch(
      `${s.origin}/api/theming/draft/file?path=css%2Fextra.css&draft_version=${(await draft()).draft_version}`,
      {
        method: "PUT",
        headers: { cookie: "canccu_session=embedder", origin: s.origin },
        body: "a { color: red; }",
      },
    );
    expect(css.status).toBe(200);
    const asked = await open("/theming/studio/");
    const asking = await frame(asked, SCREEN);
    await expect.poll(() => cssVar(asking, "--canccu-color-background")).toBe(night);
    await asked.click('[data-action="preset"][data-preset="default"][data-scheme="daylight"]');
    await expect.poll(() => asked.isVisible("#canccu-studio-replace")).toBe(true);
    await asked.click('#canccu-studio-replace [data-action="dialog-close"]');
    await asked.waitForTimeout(300);
    expect(await cssVar(asking, "--canccu-color-background")).toBe(night);
    expect((await draft()).manifest.preset).toEqual({ id: "default", scheme: "night" });
  });

  it("names the loss in Reset's dialog when the draft holds its own CSS", async () => {
    await eventDraft();
    const page = await open("/theming/studio/yours");
    const note = page.locator("#canccu-studio-reset .canccu-studio-own-note");
    await page.click('[data-action="reset-ask"]');
    expect(await note.isVisible()).toBe(false);
    await page.click('#canccu-studio-reset [data-action="dialog-close"]');
    const css = await fetch(
      `${s.origin}/api/theming/draft/file?path=css%2Fextra.css&draft_version=${(await draft()).draft_version}`,
      {
        method: "PUT",
        headers: { cookie: "canccu_session=embedder", origin: s.origin },
        body: "a { color: red; }",
      },
    );
    expect(css.status).toBe(200);
    const again = await open("/theming/studio/yours");
    await again.click('[data-action="reset-ask"]');
    const named = again.locator("#canccu-studio-reset .canccu-studio-own-note");
    expect(await named.isVisible()).toBe(true);
    expect(await named.textContent()).toContain("own CSS");
  });

  it("keeps a logo picked just before an earlier save's refresh lands", async () => {
    await eventDraft();
    const page = await open("/theming/studio/yours");
    const held: Route[] = [];
    await page.route("**/theming/studio/yours", (r) =>
      held.length === 0 ? void held.push(r) : r.continue(),
    );
    const before = (await draft()).draft_version;
    await page.click('input[name="roundness"][value="round"]', { force: true });
    await expect.poll(() => held.length).toBe(1);
    await page.setInputFiles('input[name="logo_file"]', {
      name: "logo.png",
      mimeType: "image/png",
      buffer: await png("#ff0000", 64),
    });
    // The refresh lands inside the 400 ms before the logo's save.
    await held[0]?.continue();
    const logo = async () => ((await draft()).manifest.images as { logo?: string }).logo;
    await expect.poll(logo, { timeout: 15_000 }).toBe("images/logo.png");
    await savedAfter(page, before);
  });
});
