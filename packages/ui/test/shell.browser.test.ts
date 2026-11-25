/// <reference lib="dom" />
/**
 * The organiser shell in Chromium (#731): the header's logo, name and state badge share one
 * centre line at desktop and phone widths, and on a page taller than the window the side menu
 * stays in view with Profile and Sign out at its foot.
 */
import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { html } from "../src/html.js";
import { shellPage, type EventInfo } from "../src/shell.js";
import { launch } from "./chromium.js";

const browser = await launch();
const css = readFileSync(new URL("../ui.css", import.meta.url), "utf8");

const EVENT: EventInfo = {
  name: "Demo Event",
  status: "live",
  timeZone: "UTC",
  startsAt: "2026-03-14T08:00:00Z",
  endsAt: "2026-03-15T16:00:00Z",
  venue: "Demo Venue",
};
const NOW = new Date("2026-03-14T18:42:00Z");
// Every right the menu knows, so the menu is as tall as it gets.
const RIGHTS = new Set(
  (
    JSON.parse(readFileSync(new URL("../src/menu.json", import.meta.url), "utf8")) as {
      groups: { items: { rights: string[] }[] }[];
    }
  ).groups.flatMap((g) => g.items.flatMap((i) => i.rights)),
);
// Theming's logo without a logo: the initials on a square (modules/theming/src/logo.ts).
const LOGO =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><rect width="80" height="80" rx="23" fill="#3b82f6"/><text x="40" y="41" font-size="30" text-anchor="middle" dominant-baseline="central">DE</text></svg>',
  );

async function render(width: number, height: number, rows = 120, event = EVENT): Promise<Page> {
  if (browser === undefined) throw new Error("the suite runs only with a browser");
  const body = html`${Array.from({ length: rows }, (_, i) => html`<p>Row ${String(i + 1)}</p>`)}`;
  const doc = String(
    shellPage({
      title: "Long page",
      description: "d",
      body,
      event,
      now: NOW,
      logoUrl: LOGO,
      session: { userName: "Demo Organiser", rights: RIGHTS },
    }),
  )
    .replace(/<link rel="stylesheet"[^>]*>/, `<style>${css}</style>`)
    .replace(/<script[^>]*><\/script>/, "");
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(doc);
  await page.waitForFunction(() =>
    Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0),
  );
  return page;
}

/**
 * Where the eye reads each part's middle, in px from the window's top: the logo's box, and for a
 * text the middle of its capitals (baseline less half the cap height), since a font's ascent and
 * descent differ and a box centred on its line still draws its letters high or low.
 */
const middles = (page: Page) =>
  page.evaluate(() => {
    const capMiddle = (sel: string): number => {
      const el = document.querySelector(sel);
      const text = Array.from(el?.childNodes ?? []).find(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
      );
      if (!el || !text) return NaN;
      const range = document.createRange();
      range.selectNodeContents(text);
      const cs = getComputedStyle(el);
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return NaN;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = ctx.measureText("H");
      const baseline = range.getBoundingClientRect().top + m.fontBoundingBoxAscent;
      return baseline - m.actualBoundingBoxAscent / 2;
    };
    const logo = document.querySelector(".canccu-header__logo")?.getBoundingClientRect();
    return {
      logo: logo ? logo.top + logo.height / 2 : NaN,
      title: capMiddle(".canccu-header__title"),
      badge: capMiddle(".canccu-header .canccu-badge"),
    };
  });

/** The window scrolled to `y` (clamped), then the menu's, its foot's and the header's boxes. */
async function menuAt(page: Page, y: number) {
  await page.evaluate((top) => {
    window.scrollTo(0, top);
  }, y);
  // A scroll-linked style updates on the next frame.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  return page.evaluate(() => {
    const box = (s: string) => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return { top: r?.top ?? NaN, bottom: r?.bottom ?? NaN };
    };
    const menu = document.querySelector(".canccu-menu");
    return {
      scrolled: window.scrollY,
      header: box(".canccu-header").bottom,
      banner: box(".canccu-banner").bottom,
      menu: box(".canccu-menu"),
      foot: box(".canccu-menu__foot"),
      overflows: menu ? menu.scrollHeight > menu.clientHeight : false,
    };
  });
}

describe.skipIf(browser === undefined)(
  "the organiser shell in Chromium",
  { timeout: 30_000 },
  () => {
    afterAll(async () => {
      await browser?.close();
    });

    it.each([1280, 390])("lines up the logo, the name and the state badge at %i px", async (w) => {
      const page = await render(w, 800);
      const { logo, title, badge } = await middles(page);
      expect(Math.abs(title - logo)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(badge - logo)).toBeLessThanOrEqual(0.5);
      await page.close();
    });

    it.each([
      ["at the top", 0],
      ["part way down", 1500],
      ["scrolled to the bottom", Number.MAX_SAFE_INTEGER],
    ])(
      "fills the window with the menu, its foot in view, on a long page at 1280 px %s",
      async (_, y) => {
        const page = await render(1280, 800);
        const at = await menuAt(page, y);
        if (y > 0) expect(at.scrolled).toBeGreaterThan(1000);
        // Under the header at the top; from the window's top once the header has scrolled away.
        expect(at.menu.top).toBeCloseTo(y === 0 ? at.header : 0, 0);
        expect(at.menu.bottom).toBeCloseTo(800, 0);
        expect(at.foot.bottom).toBeCloseTo(800, 0);
        await page.close();
      },
    );

    it("adds no scroll to a short page: the menu ends at the window's foot", async () => {
      const page = await render(1280, 800, 3);
      const at = await menuAt(page, Number.MAX_SAFE_INTEGER);
      expect(at.scrolled).toBe(0);
      expect(at.foot.bottom).toBeCloseTo(800, 0);
      await page.close();
    });

    it("scrolls the menu on its own when it is taller than the window, the foot pinned", async () => {
      const page = await render(1280, 420);
      for (const y of [0, Number.MAX_SAFE_INTEGER]) {
        const at = await menuAt(page, y);
        expect(at.overflows).toBe(true);
        expect(at.menu.bottom).toBeCloseTo(420, 0);
        expect(at.foot.bottom).toBeCloseTo(420, 0);
      }
      await page.close();
    });

    it("starts the menu under an archived event's banner, its foot still at the window's foot", async () => {
      const page = await render(1280, 800, 120, { ...EVENT, status: "archived" });
      for (const y of [0, Number.MAX_SAFE_INTEGER]) {
        const at = await menuAt(page, y);
        expect(at.menu.top).toBeCloseTo(y === 0 ? at.banner : 0, 0);
        expect(at.foot.bottom).toBeCloseTo(800, 0);
      }
      await page.close();
    });
  },
);
