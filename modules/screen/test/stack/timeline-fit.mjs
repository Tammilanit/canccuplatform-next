// The coming hours keep their words apart (#785): no two hour times on the axis touch, and no
// block's label leaves the room the server gave it, in every theme (player/src/timeline-fit.ts, timeline.css). A
// theme's font changes how wide a time is, so the check runs on the page, as drawn.

/** The indexes of the boxes (left-to-right) that touch the one before them. */
export function touchingNext(boxes, gap = 1) {
  const sorted = [...boxes].sort((a, b) => a.left - b.left);
  return sorted.flatMap((b, i) => (i > 0 && b.left < sorted[i - 1].right + gap ? [i] : []));
}

/** The names of the labels whose text is wider or taller than their room, by a pixel. */
export function outsideBlock(pairs) {
  return pairs.flatMap(({ name, block, text }) =>
    text.left < block.left - 1 ||
    text.right > block.right + 1 ||
    text.top < block.top - 1 ||
    text.bottom > block.bottom + 1
      ? [name]
      : [],
  );
}

/**
 * Run on a page whose hero holds the coming hours (handed.mjs, `withComingHours`), so the line is
 * there at any hour: a page without it fails, since a check that passes without looking proves
 * nothing.
 */
export async function timelineFits(page) {
  // Attached, not visible: a tick is 0 px wide and its time runs out of it (timeline.css), so
  // Playwright never counts it as visible.
  await page
    .waitForSelector(".canccu-widget--agenda_timeline .canccu-widget__tick", { state: "attached" })
    .catch(() => {
      throw new Error("the coming hours never showed: nothing was checked");
    });
  const found = await page.evaluate(() => {
    const widget = document.querySelector(".canccu-widget--agenda_timeline");
    if (widget === null) return null;
    const size = parseFloat(
      getComputedStyle(widget.querySelector(".canccu-widget__tick")).fontSize,
    );
    const rect = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    const times = [...widget.querySelectorAll(".canccu-widget__tick")]
      .filter((t) => getComputedStyle(t).visibility !== "hidden")
      .map((t) => {
        const range = document.createRange();
        range.selectNodeContents(t);
        return rect(range.getBoundingClientRect());
      });
    const spans = [...widget.querySelectorAll(".canccu-widget__span")];
    const pairs = spans.flatMap((span) => {
      // The label's room is its own box (label_col, label_cols), which may run past a short block.
      if (getComputedStyle(span).display === "none") return [];
      // The text as drawn, not the box a clamp or an overflow cuts: a line past the edge shows.
      const text = [...span.querySelectorAll(".canccu-widget__name, .canccu-widget__range")]
        // A part a small box hides draws nothing, and has no place to be inside.
        .filter((e) => getComputedStyle(e).display !== "none")
        .map((e) => {
          const range = document.createRange();
          range.selectNodeContents(e);
          const r = range.getBoundingClientRect();
          // A clamped name keeps its hidden lines out of its own box (overflow: hidden).
          const own = e.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            top: Math.max(r.top, own.top),
            bottom: Math.min(r.bottom, own.bottom),
          };
        });
      const name = span.querySelector(".canccu-widget__name")?.textContent ?? "";
      return text.map((t) => ({ name, block: rect(span.getBoundingClientRect()), text: t }));
    });
    return { times, pairs, size };
  });
  if (found === null) throw new Error("the coming hours left the page before they were checked");
  if (found.times.length > 0 && touchingNext(found.times, found.size * 0.3).length > 0)
    throw new Error("the coming hours' times on the axis run into each other");
  const out = outsideBlock(found.pairs);
  if (out.length > 0) throw new Error(`the coming hours' label leaves its room: ${out.join(", ")}`);
}
