// What the screen shots wait for and check on the page before each shot (screens.mjs).
import { turnsSettled } from "./dashboard.mjs";

/** The layout of the screen's orientation is on the page (the heartbeat tells the server). */
export async function layout(page, [width, height]) {
  await page.waitForFunction(
    (portrait) => {
      const el = document.querySelector(".canccu-layout");
      const ratio = Number(el?.style.getPropertyValue("--canccu-layout-ratio"));
      return el !== null && ratio > 0 && ratio < 1 === portrait;
    },
    height > width,
    { timeout: 30_000 },
  );
}

/**
 * The rail turns between the run of show and a countdown every 15 s (BUILT_IN_LAYOUTS); the shot
 * waits for the run of show, which mockup 02 draws there, so the hero's countdown is not shown twice.
 */
export async function railShowsAgenda(page) {
  await page.waitForSelector(".canccu-region--rail > .canccu-widget--agenda_now.canccu-is-active", {
    timeout: 40_000,
  });
}

/**
 * The built-in ticker is never cut off (#442): every line that says it fits does, so one measured
 * off the page cannot pass. With `crawls`, where the demo's ticker is wider than its box, the line
 * crawls. A theme's own ticker template draws no built-in line and is left alone.
 */
export async function tickerFitted(page, crawls) {
  const sel = ".canccu-widget--ticker .canccu-widget__line";
  await page.waitForFunction(
    (lines) => [...document.querySelectorAll(lines)].every((el) => el.dataset.fit !== undefined),
    sel,
    { timeout: 10_000 },
  );
  const lines = await page.$$eval(sel, (els) =>
    els.map((el) => ({ fit: el.dataset.fit, cut: el.scrollWidth > el.clientWidth + 1 })),
  );
  if (lines.some((line) => line.fit === "fits" && line.cut))
    throw new Error("the ticker's line is cut off: it was measured as fitting");
  if (crawls && !lines.some((line) => line.fit === "crawl"))
    throw new Error("the demo's long ticker does not crawl");
}

/**
 * An emergency wears its fixed red (claims.css) whatever the layout does to its cards, and in the
 * hero no theme band paints the theme's glows over it (stage.css).
 */
export async function emergencyIsRed(page, region) {
  const sel = `.canccu-region--${region} > .canccu-widget--announcement`;
  await page.waitForSelector(sel, { timeout: 30_000 });
  const { background, band } = await page.$eval(sel, (card) => {
    const theme = card.querySelector(".canccu-widget__band--theme");
    return {
      background: getComputedStyle(card).backgroundColor,
      band: theme === null ? "none" : getComputedStyle(theme).display,
    };
  });
  if (background !== "rgb(185, 28, 28)")
    throw new Error(`the emergency in the ${region} region is ${background}, not its fixed red`);
  if (band !== "none")
    throw new Error(`the emergency in the ${region} region shows the theme's band`);
}

/** The rail shows its idle choice, on both of its turns: never the emptied run of show. */
export async function railShowsIdle(page) {
  await page.waitForSelector(".canccu-region--rail > .canccu-widget--logo.canccu-is-active", {
    timeout: 40_000,
  });
  if ((await page.$(".canccu-region--rail .canccu-widget--agenda_now")) !== null)
    throw new Error("the rail drew its run of show without a row");
  if ((await page.$(".canccu-region--rail .canccu-widget__zone")) !== null)
    throw new Error("the rail's logo names the zone: a second header, not the event's card");
}

/** The pairing code's expiry is the frame's last line, under the instruction (mockup 05, sheet 9). */
export async function expiryLast(page) {
  const [foot, lines] = await Promise.all(
    [".canccu-frame__foot", ".canccu-frame--pairing .canccu-frame__bottom"].map((sel) =>
      page.$eval(sel, (node) => node.getBoundingClientRect().toJSON()),
    ),
  );
  if (foot.top < lines.bottom)
    throw new Error("the pairing frame's expiry sits above its instruction");
}

/** Fonts and images loaded, the entry fade done, and no turn caught mid-crossfade (#535). */
export async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  await turnsSettled(page);
}
