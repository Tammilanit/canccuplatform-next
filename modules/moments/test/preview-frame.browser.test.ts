/// <reference lib="dom" />
/**
 * The player previews of the organiser pages (Priorities, Announcements, Storyboards) in Chromium:
 * the frame draws the player at a screen's size and static/moments.js scales it to its box. Drawn
 * at the box's own few hundred pixels, the theme's fixed gap and safe inset left the player's grid
 * rows no height, so the header and ticker bands held no text (#779). The page is the server's own
 * view; the frame's page only says its size.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_AIR } from "../src/air-settings.js";
import { DEFAULT_ORDER } from "../src/arbiter.js";
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

const ORIGIN = "http://moments.test";

async function open(width: number): Promise<Page> {
  if (browser === undefined) throw new Error("the suite runs only with a browser");
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const body = prioritiesView({
    scope: "",
    order: DEFAULT_ORDER,
    draft: false,
    zones: ["main"],
    zoneName: (z) => z,
    own: [],
    revision: 0,
    air: DEFAULT_AIR,
    preview: { zone: "main", ranks: {}, auto: false },
    rules: [],
    cues: [],
    canWrite: true,
  });
  await page.route(`${ORIGIN}/screen/zones/**`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>player</title>" }),
  );
  await page.route(`${ORIGIN}/moments/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><style>${css}</style></head><body class="canccu-page">${String(body)}<script>${script}</script></body></html>`,
    }),
  );
  await page.goto(`${ORIGIN}/moments/priorities?scope=`);
  return page;
}

describe.skipIf(browser === undefined)(
  "The player previews in Chromium",
  { timeout: 30_000 },
  () => {
    afterAll(async () => {
      await browser?.close();
    });

    for (const width of [1280, 390]) {
      it(`draws the player at 1920 × 1080, scaled to fill its box, at ${String(width)} px`, async () => {
        const page = await open(width);
        const frame = page.frameLocator("iframe[data-preview]");
        await frame.locator("title").waitFor({ state: "attached" });
        const inner = await frame
          .locator(":root")
          .evaluate(() => [window.innerWidth, window.innerHeight]);
        expect(inner).toEqual([1920, 1080]);
        // The scale follows the box: the frame covers it, and nothing of it lies outside.
        await expect
          .poll(async () => {
            const box = await page.locator(".moments-preview__frame").boundingBox();
            const drawn = await page.locator("iframe[data-preview]").boundingBox();
            if (box === null || drawn === null) return null;
            return [
              drawn.x - box.x,
              drawn.y - box.y,
              drawn.width - box.width,
              drawn.height - box.height,
            ].map((d) => Math.round(Math.abs(d)));
          })
          .toEqual([0, 0, 0, 0]);
        await page.context().close();
      });
    }
  },
);
