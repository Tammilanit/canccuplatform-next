/// <reference lib="dom" />
/**
 * The storyboard builder in Chromium (#627, step 4 polish sheets 05 and 06): the strip with the
 * chosen step's form beside it and the preview's column at 1280 px; at 390 px nothing is wider
 * than the phone and Overview, Round and Preview are three tabs; static/story-builder.js opens a
 * step's form from the strip and moves a step with the keys, keeping the order in the form. The
 * page is the server's own view.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { builderHead, builderView } from "../src/story/builder.js";
import { describeStory } from "../src/story/describe.js";
import { PRESETS } from "../src/story/presets.js";
import { DEFAULT_SETTINGS } from "../src/story/store.js";
import { launch } from "./chromium.js";

const browser = await launch();
const file = (url: URL | string) => readFileSync(url, "utf8");
const css = [
  file(createRequire(import.meta.url).resolve("@canccu/ui/ui.css")),
  file(new URL("../static/moments.css", import.meta.url)),
  file(new URL("../static/organiser.css", import.meta.url)),
  ...["story-controls", "story-round", "story-side", "story-builder"].map((n) =>
    file(new URL(`../static/${n}.css`, import.meta.url)),
  ),
].join("\n");
const script = file(new URL("../static/story-builder.js", import.meta.url));
const ORIGIN = "http://moments.test";

async function open(width: number, key = "starting_soon"): Promise<Page> {
  if (browser === undefined) throw new Error("the suite runs only with a browser");
  const story = PRESETS.find((s) => s.key === key);
  if (story === undefined) throw new Error(`no preset ${key}`);
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  const zoneName = (z: string) => z;
  const head = builderHead({
    story,
    zones: ["main", "entrance"],
    zoneName,
    canWrite: true,
    canTake: true,
  });
  const body = builderView({
    story,
    d: describeStory(story, DEFAULT_SETTINGS, () => 0),
    settings: DEFAULT_SETTINGS,
    zoneName,
    zones: ["main", "entrance"],
    cues: ["tournament.pre", "tournament.start"],
    revision: 0,
    canWrite: true,
    canTake: true,
    airtime: [{ zone: "main", share: 0.1 }],
    step: 0,
    sample: (text) => text.replace("{item.title}", "Demo Cup, final"),
  });
  // The preview's frame and its API calls answer nothing here; the builder is what is tested.
  await page.route(`${ORIGIN}/**`, (route) =>
    route.request().url().includes("/moments/storyboards")
      ? route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<!doctype html><html><head><style>${css}</style></head><body class="canccu-page"><main class="canccu-main"><div class="canccu-pagehead"><p>${String(head.description)}</p>${String(head.actions)}</div>${String(body)}</main><script>${script}</script></body></html>`,
        })
      : route.fulfill({ status: 404, body: "" }),
  );
  await page.goto(`${ORIGIN}/moments/storyboards?edit=${key}`);
  return page;
}

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  if (b === null) throw new Error(`${selector} is not drawn`);
  return b;
};
const shownForm = (page: Page) =>
  page.$$eval("[data-step-form]", (forms) =>
    forms.filter((f) => !(f as HTMLElement).hidden).map((f) => (f as HTMLElement).dataset.stepForm),
  );

describe.skipIf(browser === undefined)(
  "the storyboard builder in Chromium",
  { timeout: 30_000 },
  () => {
    afterAll(async () => {
      await browser?.close();
    });

    it("puts the strip, the chosen step's form and the preview's column side by side at 1280 px", async () => {
      const page = await open(1280);
      const strip = await box(page, ".moments-builder__strip");
      const form = await box(page, ".moments-builder__step");
      const side = await box(page, ".moments-builder__side");
      expect(strip.x + strip.width).toBeLessThanOrEqual(form.x);
      expect(form.x + form.width).toBeLessThanOrEqual(side.x);
      expect(Math.abs(strip.y - form.y)).toBeLessThan(2);
      expect(Math.abs(form.y - side.y)).toBeLessThan(2);
      // Two even columns of fields, labels above them.
      const title = await box(page, '[data-step-form="0"] [data-field="title"]');
      const cue = await box(page, '[data-step-form="0"] [data-field="cue"]');
      expect(await page.isVisible(".moments-builder__tabs")).toBe(false);
      expect(Math.abs(title.width - cue.width)).toBeLessThan(2);
    });

    it("opens a step's form from the strip and keeps the choice in the form and the address", async () => {
      const page = await open(1280);
      expect(await shownForm(page)).toEqual(["0"]);
      await page.locator('.moments-step[data-step="1"]').click();
      expect(await shownForm(page)).toEqual(["1"]);
      expect(await page.inputValue('input[name="step"]')).toBe("1");
      expect(new URL(page.url()).searchParams.get("step")).toBe("1");
      expect(await page.getAttribute('.moments-step[data-step="1"]', "aria-current")).toBe("step");
    });

    it('keeps the preview\'s zone when an "Only if" zone box is ticked', async () => {
      const page = await open(1280);
      const before = await page.getAttribute("[data-story-preview]", "data-zone");
      await page.evaluate(() => {
        const box = [
          ...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="zone"]'),
        ].find(
          (x) =>
            x.value !== document.querySelector("[data-story-preview]")?.getAttribute("data-zone"),
        );
        if (box === undefined) throw new Error("no condition zone box");
        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(await page.getAttribute("[data-story-preview]", "data-zone")).toBe(before);
    });

    it("turns a mark off on the other steps when it is ticked on one", async () => {
      const page = await open(1280);
      await page.evaluate(() => {
        const boxes = [...document.querySelectorAll<HTMLInputElement>('input[name="dot"]')];
        for (const b of boxes) b.checked = false;
        for (const b of boxes.slice(0, 2)) {
          b.checked = true;
          b.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      expect(
        await page.$$eval(
          'input[name="dot"]',
          (xs) => xs.filter((x) => (x as HTMLInputElement).checked).length,
        ),
      ).toBe(1);
    });

    it("moves a step with the arrow keys, renumbers the strip and keeps the order for Save", async () => {
      const page = await open(1280);
      await page.locator('.moments-step[data-step="1"]').focus();
      await page.keyboard.press("ArrowUp");
      expect(await page.inputValue('input[name="order"]')).toBe("1,0");
      const labels = await page.$$eval(".moments-step__name", (xs) => xs.map((x) => x.textContent));
      expect(labels).toEqual(["1 · Countdown", "2 · Sting"]);
      expect(await page.isVisible("[data-builder-unsaved]")).toBe(true);
      expect(await page.textContent("[data-builder-state]")).toBe("1 change");
      expect(
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.step),
      ).toBe("1");
    });

    it("fits a phone, as three tabs with the checks in one line", async () => {
      const page = await open(390);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(wide).toBeLessThanOrEqual(390);
      expect(await page.isVisible(".moments-builder__tabs")).toBe(true);
      expect(await page.isVisible(".moments-builder__checkline")).toBe(true);
      expect(await page.isVisible(".moments-builder__rounds")).toBe(true);
      expect(await page.isVisible(".moments-builder__strip")).toBe(false);
      await page.getByRole("tab", { name: "Round" }).click();
      expect(await page.isVisible(".moments-builder__strip")).toBe(true);
      expect(await page.isVisible(".moments-builder__rounds")).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      await page.locator(".moments-builder__checkline").evaluate((x) => {
        x.scrollIntoView();
      });
      await page.getByRole("tab", { name: "Preview" }).click();
      expect(await page.isVisible(".moments-builder__checks")).toBe(true);
      expect(await page.isVisible(".moments-builder__strip")).toBe(false);
      // Test-fire and Save sit in the pending row.
      expect(await page.isVisible(".moments-builder__pending [type=submit]")).toBe(true);
    });

    it("draws a loop with its rounds every few minutes", async () => {
      const page = await open(1280, "doors_open");
      expect(await page.isChecked('input[name="rounds_mode"][value="every"]')).toBe(true);
      expect(await page.isVisible(".moments-rounds__every")).toBe(true);
      expect(await page.isVisible(".moments-rounds__offsets")).toBe(false);
    });
  },
);
