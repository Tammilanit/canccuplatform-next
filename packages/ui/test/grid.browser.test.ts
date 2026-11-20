/// <reference lib="dom" />
/**
 * `.canccu-grid` and `.canccu-band` in Chromium (amendment 3, docs/design/grids/01-rule.svg): the
 * columns each size takes at the content widths of a 320 and 390 px phone and of 1280, 1920 and
 * 2560 px desks, rows that end level with their actions at the foot, and the band's limits.
 */
import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { launch } from "./chromium.js";

const browser = await launch();
const css = readFileSync(new URL("../ui.css", import.meta.url), "utf8");

async function render(body: string): Promise<Page> {
  if (browser === undefined) throw new Error("the suite runs only with a browser");
  const page = await browser.newPage({ viewport: { width: 2200, height: 900 } });
  await page.setContent(
    `<!doctype html><html><head><style>${css}</style></head><body class="canccu-page">${body}</body></html>`,
  );
  return page;
}

const items = (n: number, cls = "canccu-card") =>
  Array.from({ length: n }, (_, i) => `<li class="${cls}">Item ${String(i + 1)}</li>`).join("");

/** The column tracks the grid draws, each in px. */
const tracks = (page: Page, sel: string) =>
  page.$eval(sel, (g) => getComputedStyle(g).gridTemplateColumns.split(" ").map(parseFloat));

describe.skipIf(browser === undefined)(
  ".canccu-grid and .canccu-band in Chromium",
  { timeout: 30_000 },
  () => {
    afterAll(async () => {
      await browser?.close();
    });

    it.each([
      // content width, card, small, tile (amendment 3's table; 288 px is a 320 px phone)
      [288, 1, 1, 2],
      [358, 1, 2, 3],
      [944, 3, 5, 7],
      [1584, 5, 9, 13],
      [1920, 6, 11, 16],
    ])(
      "at %i px of content: %i card, %i small and %i tile columns",
      async (width, card, small, tile) => {
        const box = (mod: string) =>
          `<div style="width:${String(width)}px"><ul class="canccu-grid canccu-grid${mod}" id="g${mod}">${items(1)}</ul></div>`;
        const page = await render(box("") + box("--small") + box("--tile"));
        expect((await tracks(page, "#g")).length).toBe(card);
        expect((await tracks(page, "#g--small")).length).toBe(small);
        expect((await tracks(page, "#g--tile")).length).toBe(tile);
        await page.close();
      },
    );

    it("keeps one or two items at their card width: the empty tracks stay", async () => {
      const page = await render(
        `<div style="width:1584px"><ul class="canccu-grid">${items(2)}</ul></div>`,
      );
      const widths = await page.$$eval(".canccu-grid > li", (li) =>
        li.map((l) => l.getBoundingClientRect().width),
      );
      expect(widths).toHaveLength(2);
      for (const w of widths) expect(w).toBeLessThanOrEqual(440);
      await page.close();
    });

    it("lets a card shrink in a box narrower than its minimum", async () => {
      const page = await render(
        `<div style="width:240px"><ul class="canccu-grid">${items(2)}</ul></div>`,
      );
      const right = await page.$eval(".canccu-grid > li", (l) => l.getBoundingClientRect().right);
      expect(right).toBeLessThanOrEqual(248);
      await page.close();
    });

    it("ends a row level, with each card's foot at its bottom so the buttons line up", async () => {
      const card = (lines: number, i: number) =>
        `<li class="canccu-card" id="c${String(i)}">${"<p>line</p>".repeat(lines)}<div class="canccu-cluster canccu-card__foot"><button>Go</button></div></li>`;
      const page = await render(
        `<div style="width:944px"><ul class="canccu-grid">${card(1, 1)}${card(6, 2)}${card(3, 3)}</ul></div>`,
      );
      const feet = await page.$$eval(".canccu-card__foot button", (b) =>
        b.map((x) => x.getBoundingClientRect().bottom),
      );
      const heights = await page.$$eval(".canccu-grid > li", (l) =>
        l.map((x) => x.getBoundingClientRect().height),
      );
      expect(new Set(heights).size).toBe(1);
      expect(new Set(feet.map((f) => Math.round(f))).size).toBe(1);
      await page.close();
    });

    it("draws the count tiles as small items: four keep their width, two by two on a phone", async () => {
      const stats = (w: number) =>
        `<div style="width:${String(w)}px"><div class="canccu-stats" id="s${String(w)}">${items(4, "canccu-card canccu-stat")}</div></div>`;
      const page = await render(stats(944) + stats(358));
      expect((await tracks(page, "#s944")).length).toBe(5);
      expect((await tracks(page, "#s358")).length).toBe(2);
      await page.close();
    });

    it("stops a lone band panel at 48rem", async () => {
      const page = await render(
        `<div style="width:1584px"><div class="canccu-band"><section class="canccu-card">One</section></div></div>`,
      );
      expect(await page.$eval(".canccu-band > *", (p) => p.getBoundingClientRect().width)).toBe(
        768,
      );
      await page.close();
    });

    it("puts two panels in one row from 2 × 22rem and the gap (45rem), one under the other below it", async () => {
      const band = (w: number) =>
        `<div style="width:${String(w)}px" id="b${String(w)}"><div class="canccu-band"><section class="canccu-card">A</section><section class="canccu-card">B<br>taller</section></div></div>`;
      const page = await render(band(720) + band(719) + band(358));
      const tops = (w: number) =>
        page.$$eval(`#b${String(w)} .canccu-band > *`, (p) =>
          p.map((x) => x.getBoundingClientRect().top),
        );
      const [a720, b720] = await tops(720);
      expect(a720).toBe(b720);
      const [a719, b719] = await tops(719);
      expect(b719).toBeGreaterThan(a719 ?? 0);
      const heights = await page.$$eval("#b720 .canccu-band > *", (p) =>
        p.map((x) => x.getBoundingClientRect().height),
      );
      expect(heights[0]).toBe(heights[1]);
      const phone = await page.$$eval("#b358 .canccu-band > *", (p) =>
        p.map((x) => x.getBoundingClientRect().width),
      );
      expect(phone).toEqual([358, 358]);
      await page.close();
    });
  },
);
