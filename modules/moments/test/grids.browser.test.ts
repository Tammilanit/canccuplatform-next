/// <reference lib="dom" />
/**
 * On air and the storyboard catalogue in Chromium (amendment 3; docs/design/grids/02 and 05): the
 * zones and the storyboard cards fill the width in `.canccu-grid`, the crew band stays above and
 * the panel band below at every width, and a phone reads them in the page's order. The pages are
 * the server's own views at the content widths of a 320 and a 390 px phone and of 1100, 1280 and
 * 1920 px desks.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import { presetOf } from "../src/story/presets.js";
import { pickerView } from "../src/story/picker-view.js";
import type { Story } from "../src/story/model.js";
import { DEFAULT_TIMING } from "../src/story/timing.js";
import { crewStories } from "../src/story/views.js";
import { onAirView } from "../src/views.js";
import type { MomentView } from "../src/views.js";
import { launch } from "./chromium.js";

const browser = await launch();
const file = (url: URL | string) => readFileSync(url, "utf8");
const css = [
  file(createRequire(import.meta.url).resolve("@canccu/ui/ui.css")),
  ...["moments", "organiser", "on-air"].map((n) =>
    file(new URL(`../static/${n}.css`, import.meta.url)),
  ),
].join("\n");

const NOW = new Date("2026-03-14T18:00:00Z");
const ZONES = ["bar", "cafe", "entrance", "lobby", "lounge", "main", "stage", "workshop"];
const EVENT = {
  name: "Demo Event",
  hostname: null,
  time_zone: "UTC",
  starts_at: "2026-03-14T12:00:00Z",
  ends_at: "2026-03-15T18:00:00Z",
};

const moment = (n: number, zone: string): MomentView => ({
  id: `m_${String(n)}`,
  class: "spotlight",
  rank: 50 - n,
  template: "message",
  title: `Pizza is here ${String(n)}`,
  origin: "crew",
  who: "Alex",
  zones: [zone],
  left: [],
  expires_at: "2026-03-14T18:04:12Z",
  starts_at: "2026-03-14T17:59:00Z",
  patience_seconds: 120,
  placements: [{ zone_key: zone, state: "placed", role: "hero" }],
});

const stories = (title?: string) =>
  crewStories({
    stories: [JSON.parse(JSON.stringify(presetOf("starting_soon"))) as Story],
    runs: [],
    items: [],
    now: NOW.getTime(),
    canTake: true,
    back: "on-air",
    timeZone: "UTC",
    settings: DEFAULT_TIMING,
    ...(title === undefined ? {} : { title }),
  });

function onAir(zones: number): Html {
  const keys = ZONES.slice(0, zones);
  return onAirView({
    moments: keys.slice(0, 2).map((z, i) => moment(i, z)),
    zones: keys,
    zoneName: (z) => `${z.charAt(0).toUpperCase()}${z.slice(1)}`,
    now: NOW,
    canTake: true,
    canAnnounce: true,
    canEmergency: true,
    archived: false,
    scenes: html`<p>Main · Peak</p>`,
    stories: stories(),
  });
}

async function open(body: Html, width: number): Promise<Page> {
  if (browser === undefined) throw new Error("the suite runs only with a browser");
  const page = await browser.newPage({
    viewport: { width: Math.max(width, 400) + 40, height: 900 },
  });
  await page.setContent(
    `<!doctype html><html><head><style>${css}</style></head><body class="canccu-page"><main class="canccu-main canccu-main--wide" style="width:${String(width)}px;margin:0;padding:0">${String(body)}</main></body></html>`,
  );
  return page;
}

const box = (page: Page, sel: string) =>
  page.$eval(sel, (e) => {
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, width: r.width };
  });
const columns = (page: Page, sel: string) =>
  page.$eval(sel, (g) => getComputedStyle(g).gridTemplateColumns.split(" ").length);

describe.skipIf(browser === undefined)(
  "the grids of On air and Storyboards in Chromium",
  { timeout: 60_000 },
  () => {
    afterAll(async () => {
      await browser?.close();
    });

    it.each([
      [288, 1],
      [358, 1],
      [944, 3],
      [1584, 5],
    ])(
      "draws On air's zones in %i px of content in %i columns, between the crew and panel bands",
      async (width, cols) => {
        for (const zones of [1, 2, 8]) {
          const page = await open(onAir(zones), width);
          expect(await columns(page, ".moments-onair__zones")).toBe(cols);
          const widths = await page.$$eval(".moments-zone", (z) =>
            z.map((x) => x.getBoundingClientRect().width),
          );
          expect(widths).toHaveLength(zones);
          // One zone keeps its card width: never stretched across the page.
          if (width > 358) for (const w of widths) expect(w).toBeLessThanOrEqual(440);
          const crew = await box(page, ".moments-onair__crew");
          const grid = await box(page, ".moments-onair__zones");
          const stories = await box(page, ".moments-firepanel");
          const scenes = await box(page, ".moments-onair__scenes");
          expect(crew.bottom).toBeLessThanOrEqual(grid.top);
          expect(grid.bottom).toBeLessThanOrEqual(stories.top);
          expect(grid.bottom).toBeLessThanOrEqual(scenes.top);
          if (width <= 358) {
            // A phone: crew actions, the zones, Storyboards, Scenes, one under the other.
            expect(stories.bottom).toBeLessThanOrEqual(scenes.top);
            expect(stories.width).toBe(width);
          } else {
            // Side by side from 2 × 22rem and the gap, each at most 48rem.
            expect(stories.top).toBe(scenes.top);
            expect(stories.width).toBeLessThanOrEqual(768);
          }
          await page.close();
        }
      },
    );

    it("keeps the crew band in one row from 1100 px (764 px of content), the emergency at its right", async () => {
      const page = await open(onAir(2), 764);
      const title = await box(page, ".moments-onair__crew > .canccu-card__title");
      const emergency = await box(page, ".moments-onair__crew .moments-emergency");
      const announce = await box(page, ".moments-onair__buttons > a");
      expect(emergency.top).toBeLessThan(title.bottom);
      expect(announce.top).toBeLessThan(title.bottom);
      expect(emergency.left).toBeGreaterThan(announce.left + announce.width);
      await page.close();
    });

    it("draws the storyboard catalogue in 5 columns at 1,584 px, the Fire band above it, and 1 on a phone", async () => {
      const view = (canTake: boolean) =>
        pickerView({
          stories: [],
          runs: [],
          items: [],
          now: NOW.getTime(),
          ctx: { items: [], now: NOW.getTime(), event: EVENT },
          settings: DEFAULT_TIMING,
          canWrite: true,
          canTake,
          revision: 0,
        });
      for (const [width, cols] of [
        [1584, 5],
        [944, 3],
        [358, 1],
      ] as const) {
        const page = await open(view(true), width);
        const grids = await page.$$eval(".moments-presets", (g) =>
          g.map((x) => getComputedStyle(x).gridTemplateColumns.split(" ").length),
        );
        expect(grids).toEqual([cols, cols]);
        const fire = await box(page, ".moments-firepanel");
        const first = await box(page, ".moments-presets");
        expect(fire.bottom).toBeLessThanOrEqual(first.top);
        expect(fire.width).toBe(width);
        // Every card's Turn on or off sits at its foot: a row's buttons line up.
        const feet = await page.$$eval(".moments-presets:first-of-type .moments-preset", (cards) =>
          cards.map((c) => [
            c.getBoundingClientRect().top,
            c.querySelector(".moments-preset__foot")?.getBoundingClientRect().bottom ?? 0,
          ]),
        );
        const rows = new Map<number, Set<number>>();
        for (const [top, foot] of feet)
          rows.set(
            Math.round(top ?? 0),
            (rows.get(Math.round(top ?? 0)) ?? new Set()).add(Math.round(foot ?? 0)),
          );
        for (const bottoms of rows.values()) expect(bottoms.size).toBe(1);
        await page.close();
      }
    });
  },
);
