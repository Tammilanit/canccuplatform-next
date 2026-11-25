/// <reference lib="dom" />
/**
 * The screen as the PO saw it on the demo's main zone (#779), in Chromium: no letter cut by its
 * box at 1080p, 4K, portrait and a small window, in the device's font and in a theme's fonts with
 * deep descenders; the ticker's crawl wrapping without a jump, at the event's speed; and every
 * region keeping its place and size while a theme that lays its widgets out in the flow (the
 * level-up demo theme) turns them. The states are the demo stack's Pulse and Portrait as the
 * server composed them (fixtures/pulse-states.json).
 */
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { collectSamples } from "./stack/readability.mjs";
import { bundle, draw, fontFace, launch, screenPage, themeCss, tick } from "./player-browser.js";
import type { Bundle } from "./player-browser.js";

interface Fixture {
  time: string;
  ticker: Record<string, unknown> | null;
  regions: { id: string; widgets: { widget: string; view: Record<string, unknown> }[] }[];
}

const STATES = JSON.parse(
  await readFile(new URL("fixtures/pulse-states.json", import.meta.url), "utf8"),
) as { landscape: Fixture; portrait: Fixture };
const LONG =
  "Pizza orders close at 20:00 · Lost and found at the info desk · Grand final on stage tonight · Bring your own joystick, jumper and gym bag";

const browser = await launch();
const code: Bundle | undefined = browser === undefined ? undefined : await bundle();
afterAll(async () => {
  await browser?.close();
});

/** A state of the fixture, its ticker line set as `ticker` says. */
function stateOf(kind: "landscape" | "portrait", ticker: Record<string, unknown> = {}): Fixture {
  const s = structuredClone(STATES[kind]);
  s.ticker = { ...(s.ticker ?? {}), ...ticker };
  for (const r of s.regions)
    for (const w of r.widgets) if (w.widget === "ticker") Object.assign(w.view, ticker);
  return s;
}

async function open(size: [number, number], state: Fixture, extraCss = ""): Promise<Page> {
  if (browser === undefined || code === undefined) throw new Error("no browser");
  const page = await screenPage(browser, code, size, Date.parse(state.time), extraCss);
  await draw(page, state);
  // The slots' fade (600 ms) and the ticker's fit, which waits for a tick on the page.
  await page.waitForTimeout(800);
  await tick(page, 0);
  return page;
}

/** The text the CI shots' readability check finds cut by its box (test/stack/readability.mjs). */
async function cut(page: Page): Promise<string[]> {
  const { samples } = await page.evaluate(collectSamples);
  return samples.filter((s) => s.clipped).map((s) => `"${s.text}" at ${s.where}`);
}

/** A theme's fonts with letters that reach below the font's own line box (#779). */
const DEEP_FONTS = Promise.all([
  fontFace("level-up", "exo-2-500.woff2", "t-deep-body"),
  fontFace("level-up", "chakra-petch-700.woff2", "t-deep-display"),
]).then(
  (faces) =>
    faces.join("") +
    ':root{--canccu-font-body:"t-deep-body",system-ui;--canccu-font-heading:"t-deep-display",system-ui;--canccu-font-display:"t-deep-display",system-ui}',
);

const SIZES: ["landscape" | "portrait", [number, number]][] = [
  ["landscape", [1920, 1080]],
  ["landscape", [3840, 2160]],
  ["landscape", [1280, 720]],
  ["portrait", [1080, 1920]],
];

describe.skipIf(browser === undefined)("the player in Chromium", { timeout: 60_000 }, () => {
  describe("every letter's ink stays inside the boxes that clip it", () => {
    for (const [kind, size] of SIZES)
      for (const [fonts, css] of [
        ["the device's font", Promise.resolve("")],
        ["a theme's fonts with deep descenders", DEEP_FONTS],
      ] as const)
        it(`${kind} ${size.join("×")}, ${fonts}`, async () => {
          const page = await open(size, stateOf(kind, { text: "gjpqy · Doors open" }), await css);
          expect(await cut(page)).toEqual([]);
          // The rail's and the venue card's next turn: the countdown and the food box.
          await tick(page, 15_000);
          await page.waitForTimeout(800);
          await tick(page, 3_000);
          await page.waitForTimeout(800);
          expect(await cut(page)).toEqual([]);
          await page.close();
        });
  });

  it("finds a descender its box cuts, so the check above is real", async () => {
    const page = await open([1920, 1080], stateOf("landscape"));
    await page.evaluate(() => {
      const p = document.createElement("p");
      p.textContent = "gjpqy";
      p.style.cssText = "margin:0;overflow:hidden;font-size:80px;line-height:0.75";
      document.querySelector(".canccu-region--hero > .canccu-widget")?.append(p);
    });
    expect(await cut(page)).toEqual([expect.stringContaining('"gjpqy"')]);
    await page.close();
  });

  describe("the ticker's crawl", () => {
    /**
     * The crawl paused: its two runs at the loop's start and just before its end, a second in, and
     * where the server's clock put the loop when it was drawn.
     */
    const crawl = (page: Page) =>
      page.evaluate(() => {
        const track = document.querySelector<HTMLElement>(".canccu-widget__crawl");
        const runs = [...document.querySelectorAll<HTMLElement>(".canccu-widget__run")];
        const anim = track?.getAnimations()[0];
        const [first, second] = runs;
        if (track === null || anim === undefined || !first || !second) return null;
        anim.pause();
        const timing = anim.effect?.getComputedTiming();
        const [duration, delay] = [Number(timing?.duration), Number(timing?.delay)];
        /** The first or second run's left edge at `at` ms into the loop. */
        const left = (el: HTMLElement, at: number) => {
          // Within the loop: before 0 a negative delay's crawl is not drawn moved at all.
          anim.currentTime = (((at + delay) % duration) + duration) % duration;
          return el.getBoundingClientRect().left;
        };
        return {
          widths: runs.map((r) => r.getBoundingClientRect().width),
          now: left(first, -delay),
          start: left(first, 0),
          end: left(second, duration - 1),
          second: left(first, 1000),
        };
      });

    it("comes in from the right as it leaves on the left: no gap, no jump at the wrap", async () => {
      const page = await open([1920, 1080], stateOf("landscape", { text: LONG }));
      const c = await crawl(page);
      expect(c).not.toBeNull();
      if (c === null) return;
      expect(c.widths[1]).toBeCloseTo(c.widths[0] ?? NaN, 1);
      // One millisecond before the loop ends, the second run is where the first one began.
      expect(Math.abs(c.end - c.start)).toBeLessThan(1);
      await page.close();
    });

    it("runs at the event's speed, in pixels a second of a 1080p screen", async () => {
      for (const [size, px] of [
        [[1920, 1080], 240],
        [[3840, 2160], 480],
        [[1080, 1920], 240],
      ] as const) {
        const page = await open([...size], stateOf("landscape", { text: LONG, speed: 240 }));
        const c = await crawl(page);
        expect(c === null ? null : c.start - c.second).toBeCloseTo(px, 0);
        await page.close();
      }
    });

    it("by default runs much faster than the 86 px a second the PO found slow", async () => {
      const page = await open([1920, 1080], stateOf("landscape", { text: LONG }));
      const c = await crawl(page);
      expect(c === null ? 0 : c.start - c.second).toBeGreaterThanOrEqual(150);
      await page.close();
    });

    it("is where the server's clock puts it, so a redraw goes on instead of starting over", async () => {
      const at = async (ms: number) => {
        const state = stateOf("landscape", { text: LONG, speed: 240 });
        state.time = new Date(Date.parse(state.time) + ms).toISOString();
        const page = await open([1920, 1080], state);
        const c = await crawl(page);
        await page.close();
        return { left: c?.now ?? NaN, loop: c?.widths[0] ?? NaN };
      };
      // A second later, the line has moved on 240 px, round the loop when it wrapped meanwhile.
      const [before, after] = [await at(0), await at(1000)];
      const moved = (before.left - after.left) % before.loop;
      expect((moved + before.loop) % before.loop).toBeCloseTo(240, 0);
    });
  });

  describe("the regions keep their place and size", () => {
    /**
     * Each region's box, and each widget laid out out of its region's box (a theme may size one
     * inside it: level-up's clock is a pill at its right). Layout boxes, not drawn ones: a theme's
     * own entrance (level-up's widgets rise in) moves a widget for a moment, on purpose.
     */
    const boxes = (page: Page) =>
      page.evaluate(() => {
        const regions: Record<string, string> = {};
        const apart: string[] = [];
        let two = false;
        for (const el of document.querySelectorAll<HTMLElement>(".canccu-region:not([hidden])")) {
          const id = [...el.classList].find((c) => c.startsWith("canccu-region--")) ?? "";
          const b = el.getBoundingClientRect();
          regions[id] = [b.left, b.top, b.width, b.height].map(Math.round).join(",");
          const widgets = [...el.querySelectorAll<HTMLElement>(":scope > .canccu-widget")];
          if (widgets.length > 1) two = true;
          const [width, height] = [el.clientWidth, el.clientHeight];
          for (const w of widgets) {
            const [x, y] = [w.offsetLeft, w.offsetTop];
            const inside =
              w.offsetParent === el &&
              Math.min(x, y) >= 0 &&
              x + w.offsetWidth <= width + 1 &&
              y + w.offsetHeight <= height + 1;
            const at = [x, y, w.offsetWidth, w.offsetHeight].join(",");
            if (!inside)
              apart.push(
                `${id} ${[...w.classList].join(".")}: ${at}, out of 0,0,${String(width)},${String(height)}`,
              );
          }
        }
        return { regions, apart, two };
      });

    it("through a theme that lays its widgets out in the flow, and its turns", async () => {
      const page = await open([1920, 1080], stateOf("landscape"));
      const before = await boxes(page);
      expect(before.apart).toEqual([]);
      await page.addStyleTag({
        content: await themeCss("level-up", ["base.css", "widgets.css", "cards.css"]),
      });
      const seen: string[] = [];
      let crossfades = 0;
      for (let i = 0; i < 60; i++) {
        await tick(page, 500);
        await page.waitForTimeout(60);
        const now = await boxes(page);
        if (now.two) crossfades++;
        seen.push(...now.apart);
        expect(now.regions).toEqual(before.regions);
      }
      expect([...new Set(seen)]).toEqual([]);
      // The rail and the venue card turned while it was watched: the slots were really two.
      expect(crossfades).toBeGreaterThan(0);
      await page.close();
    });

    it("with clear space between the food box and the hub QR", async () => {
      for (const [kind, size] of SIZES) {
        const page = await open(size, stateOf(kind));
        const gap = await page.evaluate(() => {
          const edge = (sel: string, side: "left" | "right") =>
            document.querySelector(sel)?.getBoundingClientRect()[side] ?? NaN;
          const grid = getComputedStyle(document.querySelector("main") as Element);
          return {
            between:
              edge(".canccu-region--venue_rail-2 > .canccu-widget", "left") -
              edge(".canccu-region--venue_rail > .canccu-widget", "right"),
            gap: parseFloat(grid.columnGap),
          };
        });
        expect(gap.between, `${kind} ${size.join("×")}`).toBeGreaterThanOrEqual(gap.gap - 1);
        expect(gap.gap).toBeGreaterThan(0);
        await page.close();
      }
    });
  });
});
