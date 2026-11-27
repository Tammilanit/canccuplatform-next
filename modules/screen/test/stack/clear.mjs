// The clear spaces of the v8 look on the stack shots (#493; test/stack/screens.mjs and
// preview-shots.mjs): what a mark, a band and a box must keep free, and the hero's panel full
// (#520), checked before the shot.
import { foodFits } from "./food.mjs";
import { timelineFits } from "./timeline-fit.mjs";

/** The indexes of the rectangles in `others` that `rect` overlaps by more than a pixel each way. */
export function overlapping(rect, others) {
  const over = (a, b, lo, hi) => Math.min(a[hi], b[hi]) - Math.max(a[lo], b[lo]) > 1;
  return others.flatMap((o, i) =>
    over(rect, o, "left", "right") && over(rect, o, "top", "bottom") ? [i] : [],
  );
}

/** The Preview mark covers nothing the screen draws: in a corner it sat over the header's logo. */
export async function markCoversNothing(page) {
  const { mark, leaves } = await page.evaluate(() => {
    const box = (e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, name: e.className };
    };
    const drawn = [...document.querySelectorAll(".canccu-layout *")].filter(
      // An empty region (the full and overlay layers while nothing claims them) draws nothing.
      (e) =>
        e.childElementCount === 0 &&
        !e.matches(".canccu-region") &&
        getComputedStyle(e).visibility !== "hidden",
    );
    const el = document.querySelector(".canccu-preview-mark");
    return { mark: el === null ? null : box(el), leaves: drawn.map(box) };
  });
  if (mark === null) throw new Error("the screen shows no Preview mark");
  const covered = overlapping(mark, leaves).map((i) => leaves[i]?.name);
  if (covered.length > 0) throw new Error(`the Preview mark covers ${covered.join(", ")}`);
}

/** A popped photo and its credit stop above the hero's rotation marks (change 6's clear band). */
async function popKeepsBand(page) {
  const rects = await page.evaluate(() =>
    [".canccu-widget__pop", ".canccu-region--hero .canccu-rotation"].map((s) => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return r === undefined
        ? null
        : { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  const [pop, marks] = rects;
  if (pop === null || marks === null) throw new Error("the photo pop shows no pop or no marks");
  if (overlapping(marks, [pop]).length > 0)
    throw new Error("the photo pop's credit runs into the rotation marks");
}

/** Portrait's Right now holds its numbers inside its padding: its title off the box's edge. */
async function rightNowFits(page) {
  const fit = await page.evaluate(() => {
    const box = document.querySelector(".canccu-region--right_now > .canccu-widget--stats");
    const title = box?.querySelector(".canccu-widget__kicker");
    if (box == null || title == null) return null;
    const pad = parseFloat(getComputedStyle(box).paddingTop);
    const gap = title.getBoundingClientRect().top - box.getBoundingClientRect().top;
    return { over: box.scrollHeight - box.clientHeight, gap, pad };
  });
  if (fit === null) throw new Error("portrait shows no Right now with its title");
  if (fit.over > 1 || fit.gap < fit.pad - 1)
    throw new Error(
      `Right now overflows its box by ${fit.over} px; its title sits ${fit.gap} px in`,
    );
}

/** The hot game says since when it surges (sheet 15). */
async function surgingSince(page) {
  const text = await page.evaluate(
    () => document.querySelector(".canccu-widget--hot_game .canccu-widget__since")?.textContent,
  );
  if (!/^surging since \d\d:\d\d$/.test(text ?? ""))
    throw new Error(`the hot game says ${JSON.stringify(text)}, not since when it surges`);
}

/**
 * The tallest stretch of `panel` that none of `parts` covers, as a share of the panel's height
 * (v8 rule 5: no empty band over a quarter of the large panel, #520).
 */
export function emptiestBand(panel, parts) {
  const height = panel.bottom - panel.top;
  // Negated, so NaN fails too: a share of NaN would pass every bound.
  if (!(height > 0)) throw new Error(`the panel has no height (${height} px)`);
  const spans = parts
    .map((p) => [Math.max(panel.top, p.top), Math.min(panel.bottom, p.bottom)])
    .filter(([top, bottom]) => bottom > top)
    .sort((a, b) => a[0] - b[0]);
  let reached = panel.top;
  let widest = 0;
  for (const [top, bottom] of spans) {
    widest = Math.max(widest, top - reached);
    reached = Math.max(reached, bottom);
  }
  widest = Math.max(widest, panel.bottom - reached);
  return widest / height;
}

/**
 * How far down a band is drawn under its `mask-image`, as a share of its height: to the middle of
 * its fade, where the mask is half opaque (stage.css: opaque to 55 %, gone at the foot). Below
 * that it is more faded than drawn; for a linear fade it is also the band's mean opacity. Only the
 * fully opaque part would count a glow the screen visibly carries further as empty. None of a band
 * whose mask this cannot read, so a fade never passes as filled.
 */
export function drawnShare(mask) {
  if (mask === "" || mask === "none") return 1;
  const fade =
    /^linear-gradient\((?:180deg, |to bottom, )?rgb\(0, 0, 0\) ([\d.]+)%, (?:transparent|rgba\(0, 0, 0, 0\))(?: ([\d.]+)%)?\)$/.exec(
      mask,
    );
  if (fade === null) return 0;
  const [opaque, gone] = [Number(fade[1]), Number(fade[2] ?? 100)];
  return (opaque + gone) / 2 / 100;
}

/**
 * What of the hero's box counts as drawn, from the page's facts on each element: text, images
 * and the art bands, the theme band only down to the middle of its fade (drawnShare). A box that
 * only grows (the when-row) does not count, nor the card's art behind the whole box, nor the
 * motion layers (`canccu-fx-layer`), which sweep over all of it.
 */
export function drawnParts(elements) {
  return elements.flatMap((e) => {
    if (e.inArt || e.inFx || e.hidden) return [];
    const band = e.classes.includes("canccu-widget__band");
    if (!band && !e.leaf && !e.text) return [];
    if (!e.classes.includes("canccu-widget__band--theme")) return [e.extent];
    const { top, bottom } = e.extent;
    return [{ ...e.extent, bottom: top + (bottom - top) * drawnShare(e.mask) }];
  });
}

/**
 * The names of `texts` not drawn whole: running out of `box`, or clamped inside it. A clamp hides
 * a line or more; less than half a letter over is the glyphs' own overhang at a tight line height.
 */
export function cutText(box, texts) {
  return texts
    .filter(
      ({ extent: r, scrollHeight, clientHeight, fontSize }) =>
        r.top < box.top - 1 ||
        r.bottom > box.bottom + 1 ||
        r.left < box.left - 1 ||
        r.right > box.right + 1 ||
        scrollHeight > clientHeight + fontSize / 2,
    )
    .map((t) => t.name);
}

/** The hero's shown box, the first of these found: a claim, else what its rotation shows. */
const HERO = '.canccu-region[data-role="hero"] > .canccu-widget';
const HERO_BOX = [`${HERO}.canccu-is-claim`, `${HERO}.canccu-is-active`, HERO];

/** The hero's shown box leaves no empty band over a quarter of its height (drawnParts). */
export async function panelFilled(page) {
  const found = await page.evaluate((heroBox) => {
    const box = heroBox.map((s) => document.querySelector(s)).find((e) => e !== null);
    if (box === undefined) return null;
    const extent = (e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const elements = [...box.querySelectorAll("*")].map((e) => ({
      extent: extent(e),
      classes: [...e.classList],
      inArt: e.closest(".canccu-widget__art") !== null,
      inFx: e.closest(".canccu-fx-layer") !== null,
      hidden: getComputedStyle(e).visibility === "hidden",
      leaf: e.childElementCount === 0,
      text: [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== ""),
      mask: getComputedStyle(e).maskImage,
    }));
    return { name: box.className, panel: extent(box), elements };
  }, HERO_BOX);
  if (found === null) throw new Error("the screen shows no hero box");
  const share = emptiestBand(found.panel, drawnParts(found.elements));
  if (share > 0.25)
    throw new Error(
      `the hero (${found.name}) leaves ${Math.round(share * 100)} % of its height empty in one band`,
    );
}

/** The hero's claim's title and body as drawn, and the screen's unit (screen.css, `--canccu-u`). */
async function heroTexts(page) {
  const found = await page.evaluate((heroBox) => {
    const box = heroBox.map((s) => document.querySelector(s)).find((e) => e !== null);
    if (box === undefined) return null;
    const extent = (e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const texts = ["title", "body"].flatMap((name) => {
      const e = box.querySelector(`.canccu-widget__${name}`);
      if (e === null) return [];
      const { scrollHeight, clientHeight } = e;
      const fontSize = parseFloat(getComputedStyle(e).fontSize);
      return [{ name, extent: extent(e), scrollHeight, clientHeight, fontSize }];
    });
    const unit = parseFloat(getComputedStyle(box).getPropertyValue("--canccu-u"));
    return { box: extent(box), texts, unit };
  }, HERO_BOX);
  if (found === null || found.texts.length < 2)
    throw new Error("the hero shows no announcement with a title and a body");
  return found;
}

/** The hero's claim shows its title and body whole, as a showcase that does not grow must. */
export async function showcaseWhole(page) {
  const found = await heroTexts(page);
  const cut = cutText(found.box, found.texts);
  if (cut.length > 0) throw new Error(`the small showcase cuts its ${cut.join(" and ")}`);
}

/**
 * A showcase in a large hero takes the large type (stage.css: a title of 9.3 units), its title
 * and body whole: Portrait's hero and Ambient's wide, low one too (#546).
 */
async function showcaseLarge(page) {
  const found = await heroTexts(page);
  const title = found.texts.find((t) => t.name === "title");
  if (title.fontSize < 9 * found.unit)
    throw new Error(
      `the showcase's title is ${title.fontSize} px, not the large type (${9.3 * found.unit} px)`,
    );
  const cut = cutText(found.box, found.texts);
  if (cut.length > 0) throw new Error(`the large showcase cuts its ${cut.join(" and ")}`);
}

/**
 * The venue card writes the Wi-Fi name and its password each on one line, never broken inside a
 * word (at a hyphen), so guests type what the screen says (#546). The card may wait for its turn.
 */
export async function venueOnOneLine(page) {
  await page.waitForSelector(".canccu-widget--venue_info .canccu-widget__name", {
    timeout: 30_000,
  });
  const broken = await page.evaluate(() =>
    ["name", "password"].filter((part) => {
      const e = document.querySelector(`.canccu-widget--venue_info .canccu-widget__${part}`);
      if (e === null) return false;
      const range = document.createRange();
      range.selectNodeContents(e);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1;
    }),
  );
  if (broken.length > 0)
    throw new Error(`the venue card breaks its Wi-Fi ${broken.join(" and ")} across lines`);
}

/** Each view's check, run once it has drawn. */
export const CLEAR_CHECKS = {
  "claim-food-long": foodFits,
  "claim-food-on-the-way-long": foodFits,
  "photo-pop": popKeepsBand,
  "portrait-right-now": rightNowFits,
  "claim-hero": surgingSince,
  dashboard: timelineFits,
  "dashboard-showcase": panelFilled,
  "dashboard-showcase-small": showcaseWhole,
  "portrait-showcase": showcaseLarge,
  "ambient-showcase": showcaseLarge,
};
