/// <reference lib="dom" />
/**
 * Priorities in Chromium (#624, mockup 08): static/moments.js moves a class by its handle with a
 * mouse, a finger or the arrow keys, keeps Emergency first and the draft in the form and the
 * address, and the rules' slider says its value in words. The page is the server's own view.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_ORDER } from "../src/arbiter.js";
import type { RuleView } from "../src/rules.js";
import { prioritiesView } from "../src/settings-views.js";
import { launch } from "./chromium.js";

const browser = await launch();
const file = (url: URL | string) => readFileSync(url, "utf8");
const css = [
  file(createRequire(import.meta.url).resolve("@canccu/ui/ui.css")),
  file(new URL("../static/moments.css", import.meta.url)),
  file(new URL("../static/organiser.css", import.meta.url)),
].join("\n");
const script = file(new URL("../static/moments.js", import.meta.url));

const RULE: RuleView = {
  rule_id: "standings",
  on: ["tournament.leaderboard.changed"],
  template: "leaderboard",
  templates: ["leaderboard"],
  enabled: true,
  class: "tournament",
  regions: ["hero", "rail"],
  ttl_seconds: 120,
  zones: [],
  cue: null,
  revision: 0,
};

const ORIGIN = "http://moments.test";

async function open(width: number): Promise<Page> {
  if (browser === undefined) throw new Error("the suite runs only with a browser");
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  const body = prioritiesView({
    scope: "",
    order: DEFAULT_ORDER,
    draft: false,
    zones: ["main"],
    own: [],
    revision: 0,
    preview: null,
    rules: [RULE],
    cues: ["tournament.start"],
    canWrite: true,
  });
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><style>${css}</style></head><body class="canccu-page">${String(body)}<script>${script}</script></body></html>`,
    }),
  );
  await page.goto(`${ORIGIN}/moments/priorities?scope=`);
  return page;
}

const order = (page: Page) =>
  page.$$eval("[data-order] > li", (rows) => rows.map((r) => (r as HTMLElement).dataset.class));
const handle = (page: Page, c: string) => page.locator(`[data-class="${c}"] [data-order-handle]`);

describe.skipIf(browser === undefined)("Priorities in Chromium", { timeout: 30_000 }, () => {
  afterAll(async () => {
    await browser?.close();
  });

  it("moves a class with the arrow keys, says where, and keeps the draft", async () => {
    const page = await open(1280);
    await handle(page, "tournament").focus();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    const now = await order(page);
    expect(now.indexOf("tournament")).toBe(3);
    expect(await page.textContent("[data-order-said]")).toBe("Tournament: 4 of 10");
    expect(await page.inputValue("[data-order-input]")).toBe(now.join(","));
    expect(await page.isVisible("[data-order-unsaved]")).toBe(true);
    expect(new URL(page.url()).searchParams.get("order")).toBe(now.join(","));
    // The focus stays on the handle, so the next press moves it again.
    expect(await page.evaluate(() => document.activeElement?.closest("li")?.dataset.class)).toBe(
      "tournament",
    );
    await handle(page, "stream").focus();
    await page.keyboard.press("ArrowUp");
    expect((await order(page))[0]).toBe("emergency");
  });

  it("drags a class with the mouse, never above Emergency", async () => {
    const page = await open(1280);
    const from = await handle(page, "ticker").boundingBox();
    const top = await page.locator('[data-class="emergency"]').boundingBox();
    if (from === null || top === null) throw new Error("no rows drawn");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, top.y + 2, { steps: 12 });
    await page.mouse.up();
    const now = await order(page);
    expect(now.slice(0, 2)).toEqual(["emergency", "ticker"]);
    expect(await page.inputValue("[data-order-input]")).toBe(now.join(","));
  });

  it("drags a class with a finger on a phone", async () => {
    const page = await open(390);
    const from = await handle(page, "reactions").boundingBox();
    const to = await page.locator('[data-class="announcement"]').boundingBox();
    if (from === null || to === null) throw new Error("no rows drawn");
    const cdp = await page.context().newCDPSession(page);
    const at = (y: number) => [{ x: from.x + from.width / 2, y }];
    const start = from.y + from.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(start) });
    for (let y = start; y > to.y + 2; y -= 20)
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(y) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(to.y + 2) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const now = await order(page);
    expect(now.indexOf("reactions")).toBe(2);
    expect(now.indexOf("announcement")).toBe(3);
  });

  it("says a rule's seconds in words as its slider moves, and fits a phone", async () => {
    const page = await open(390);
    await page.locator('input[name="ttl_seconds"]').fill("90");
    expect(await page.textContent("[data-seconds-out]")).toBe("1 min 30 s");
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(wide).toBeLessThanOrEqual(390);
  });
});
