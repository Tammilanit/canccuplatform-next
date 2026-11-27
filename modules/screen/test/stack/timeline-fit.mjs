// The coming hours keep their words apart (#785): no two hour times on the axis touch, and no
// block's label leaves its block, in every theme (player/src/timeline-fit.ts, timeline.css). A
// theme's font changes how wide a time is, so the check runs on the page, as drawn.

/** The indexes of the boxes (left-to-right) that touch the one before them. */
export function touchingNext(boxes, gap = 1) {
  const sorted = [...boxes].sort((a, b) => a.left - b.left);
  return sorted.flatMap((b, i) => (i > 0 && b.left < sorted[i - 1].right + gap ? [i] : []));
}

/** The names of the labels whose text is wider or taller than their block, by a pixel. */
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
 * Run on the page being checked: it looks at the box when the rotation shows it, for a short wait.
 * The hero rotates through other boxes, so a page that never shows it in that time is left to the
 * next theme's and view's run (every one of them calls this) rather than failed.
 */
export async function timelineFits(page) {
  const shown = await page
    .waitForSelector(".canccu-widget--agenda_timeline .canccu-widget__tick", { timeout: 15_000 })
    .catch(() => null);
  if (shown === null) return;
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
    const blocks = [...widget.querySelectorAll(".canccu-widget__block")];
    const spans = [...widget.querySelectorAll(".canccu-widget__span")];
    const pairs = spans.flatMap((span, i) => {
      const block = blocks[i];
      if (block === undefined || getComputedStyle(span).display === "none") return [];
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
      return text.map((t) => ({ name, block: rect(block.getBoundingClientRect()), text: t }));
    });
    return { times, pairs, size };
  });
  if (found === null) return;
  if (found.times.length > 0 && touchingNext(found.times, found.size * 0.3).length > 0)
    throw new Error("the coming hours' times on the axis run into each other");
  const out = outsideBlock(found.pairs);
  if (out.length > 0)
    throw new Error(`the coming hours' label leaves its block: ${out.join(", ")}`);
}
