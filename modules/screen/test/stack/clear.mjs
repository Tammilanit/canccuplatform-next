// The clear spaces of the v8 look on the stack shots (#493; test/stack/screens.mjs and
// preview-shots.mjs): what a mark, a band and a box must keep free, and the hero's panel full
// (#520), checked before the shot.

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
  return widest / (panel.bottom - panel.top);
}

/**
 * The hero's shown box leaves no empty band over a quarter of its height. What counts as drawn:
 * text, images and the art bands; a box that only grows (the when-row) does not, and neither does
 * the card's art, which sits behind the whole box.
 */
export async function panelFilled(page) {
  const found = await page.evaluate(() => {
    const hero = '.canccu-region[data-role="hero"] > .canccu-widget';
    const box =
      document.querySelector(`${hero}.canccu-is-claim`) ??
      document.querySelector(`${hero}.canccu-is-active`) ??
      document.querySelector(hero);
    if (box === null) return null;
    const extent = (e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const drawn = [...box.querySelectorAll("*")].filter(
      (e) =>
        e.closest(".canccu-widget__art") === null &&
        getComputedStyle(e).visibility !== "hidden" &&
        (e.matches(".canccu-widget__band") ||
          e.childElementCount === 0 ||
          [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "")),
    );
    return { name: box.className, panel: extent(box), parts: drawn.map(extent) };
  });
  if (found === null) throw new Error("the screen shows no hero box");
  const share = emptiestBand(found.panel, found.parts);
  if (share > 0.25)
    throw new Error(
      `the hero (${found.name}) leaves ${Math.round(share * 100)} % of its height empty in one band`,
    );
}

/** Each view's check, run once it has drawn. */
export const CLEAR_CHECKS = {
  "photo-pop": popKeepsBand,
  "portrait-right-now": rightNowFits,
  "claim-hero": surgingSince,
  "dashboard-showcase": panelFilled,
};
