/// <reference lib="dom" />
/**
 * Box transparency (contracts/theming.md, Brand kit: `box_opacity`; plan issue-785 D11), in
 * Chromium, since happy-dom computes no `color-mix()`: a screen's box is its surface colour at the
 * theme's `--canccu-box-opacity`, a plain alpha with no backdrop filter, and opaque without one.
 */
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { bundle, draw, launch, screenPage } from "./player-browser.js";
import type { Bundle } from "./player-browser.js";

const STATES = JSON.parse(
  await readFile(new URL("fixtures/pulse-states.json", import.meta.url), "utf8"),
) as { landscape: { time: string } };

const browser = await launch();
const code: Bundle | undefined = browser === undefined ? undefined : await bundle();
afterAll(async () => {
  await browser?.close();
});

/** The rail's run-of-show box as drawn: its background's alpha and its backdrop filter. */
async function railBox(tokens: string): Promise<{ alpha: number; filter: string }> {
  if (browser === undefined || code === undefined) throw new Error("no browser");
  const state = STATES.landscape;
  const page = await screenPage(browser, code, [1920, 1080], Date.parse(state.time), tokens);
  await draw(page, state);
  const out = await page.evaluate(() => {
    const box = document.querySelector(".canccu-widget--agenda_now");
    if (box === null) throw new Error("no agenda_now box");
    const style = getComputedStyle(box);
    return { background: style.backgroundColor, filter: style.backdropFilter };
  });
  await page.close();
  // `rgba(r, g, b, a)` or `color(srgb r g b / a)`; no alpha is opaque.
  const m = /^rgba\(.*,\s*([0-9.]+)\)$|\/\s*([0-9.]+)\)$/.exec(out.background);
  const alpha = m?.[1] ?? m?.[2];
  return { alpha: alpha === undefined ? 1 : Number(alpha), filter: out.filter };
}

describe.skipIf(browser === undefined)("a screen's boxes", { timeout: 60_000 }, () => {
  it("let the background show through at the theme's box opacity, with no backdrop filter", async () => {
    const box = await railBox(":root{--canccu-color-surface:#204060;--canccu-box-opacity:0.6}");
    expect(box.alpha).toBeCloseTo(0.6, 2);
    expect(box.filter).toBe("none");
  });

  it("stay opaque when the theme's CSS has no box opacity", async () => {
    expect((await railBox(":root{--canccu-color-surface:#204060}")).alpha).toBe(1);
  });
});
