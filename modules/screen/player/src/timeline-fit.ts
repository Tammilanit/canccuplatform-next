/**
 * The coming hours' axis keeps its times apart (timeline.css): the server sends every hour's
 * time, but how wide a time is depends on the theme's font (a wide pixel face's digits run into
 * each other where a plain one's do not) and on the box, which only the browser knows. So when
 * two neighbours touch, every other hour's time is dropped (its tick stays), and then every third.
 */
const AXIS = ".canccu-widget--agenda_timeline .canccu-widget__axis";
const OFF = "canccu-widget__tick--off";
/** The air left between two times, in em: half a letter's height, so two reads as two. */
const GAP_EM = 0.5;
const STRIDES = [1, 2, 3, 4, 6];

/** Where a tick's text is drawn: its width is 0, so the text runs out of it. */
function textBox(tick: HTMLElement): DOMRect {
  const range = tick.ownerDocument.createRange();
  range.selectNodeContents(tick);
  return range.getBoundingClientRect();
}

function touching(ticks: readonly HTMLElement[]): boolean {
  const gap = GAP_EM * parseFloat(getComputedStyle(ticks[0] as HTMLElement).fontSize);
  const boxes = ticks.filter((t) => !t.classList.contains(OFF)).map(textBox);
  return boxes.some((b, i) => i > 0 && b.left < (boxes[i - 1] as DOMRect).right + gap);
}

export function fitTimelineAxis(root: ParentNode): void {
  for (const axis of root.querySelectorAll<HTMLElement>(AXIS)) {
    const ticks = [...axis.querySelectorAll<HTMLElement>(".canccu-widget__tick")];
    // Not laid out yet: it waits for a tick on the page.
    if (ticks.length < 2 || axis.clientWidth === 0) continue;
    // The first time's width stands for the font: a web font that arrives late changes it.
    const key = `${String(axis.clientWidth)}:${String(Math.round(textBox(ticks[0] as HTMLElement).width))}:${axis.textContent}`;
    if (axis.dataset.fit === key) continue;
    for (const stride of STRIDES) {
      // The last hour always stays: the line's end. Where it lands beside the one before it, the
      // check below finds the two touching and the next stride tries again.
      ticks.forEach((t, i) => t.classList.toggle(OFF, i % stride !== 0 && i !== ticks.length - 1));
      if (!touching(ticks)) break;
    }
    axis.dataset.fit = key;
  }
}
