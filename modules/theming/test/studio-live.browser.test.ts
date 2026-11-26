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
    f.evaluate(
      (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
      name,
    );
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
    await page.locator('input[data-hex-for="primary"]').fill("#ff7a45");
    for (const selector of [SCREEN, PHONE, HUB]) {
      const f = await frame(page, selector);
      await expect.poll(() => cssVar(f, "--canccu-color-primary"), selector).toBe("#ff7a45");
    }
    await expect.poll(() => held.length).toBe(1);
    expect(await page.getAttribute(".canccu-studio", "data-save-state")).toBe("saving");
    await page.unroute("**/api/theming/draft/brand");
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
    await page.route("**/theming/studio/preview/hub?*", (r) => {
      held.push(r);
    });
    await page.goto(`${s.origin}/theming/studio/yours`);
    await expect.poll(() => held.length).toBe(2);
    await page.locator('input[data-hex-for="accent"]').fill("#22aa88");
    await page.unroute("**/theming/studio/preview/hub?*");
    await Promise.all(held.map((r) => r.continue()));
    for (const selector of [PHONE, HUB]) {
      const f = await frame(page, selector);
      await expect.poll(() => cssVar(f, "--canccu-color-accent"), selector).toBe("#22aa88");
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
    await page.route("**/theming/studio/preview/**", (r) => {
      held.push(r);
    });
    const before = (await draft()).draft_version;
    await page.click('input[name="roundness"][value="round"]', { force: true });
    await savedAfter(page, before);
    await expect.poll(() => held.length).toBeGreaterThan(0);
    expect(await publish.isDisabled()).toBe(true);
    await page.unroute("**/theming/studio/preview/**");
    await Promise.all(held.map((r) => r.continue()));
    await expect.poll(() => publish.isDisabled()).toBe(false);
  });

  it("keeps the screen frame in place over a save: the page never reloads it", async () => {
    await eventDraft();
    const page = await open("/theming/studio/yours");
    const box = () => page.locator(SCREEN).boundingBox();
    const at = await box();
    const before = (await draft()).draft_version;
    await page.click('input[name="font_pair"][value="space-inter"]', { force: true });
    await savedAfter(page, before);
    expect(await box()).toEqual(at);
    const screen = await frame(page, SCREEN);
    await expect
      .poll(() => cssVar(screen, "--canccu-font-heading"))
      .toContain("Space Grotesk");
  });
});
