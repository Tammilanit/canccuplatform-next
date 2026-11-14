// The clear spaces of the v8 look on the stack shots (#493; test/stack/screens.mjs and
// preview-shots.mjs): what a mark, a band and a box must keep free, checked before the shot.

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

/** Each view's check, run once it has drawn. */
export const CLEAR_CHECKS = {
  "photo-pop": popKeepsBand,
  "portrait-right-now": rightNowFits,
  "claim-hero": surgingSince,
};
