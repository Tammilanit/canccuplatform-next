/**
 * The hero's rotation marks (#375, mockup 02): a bar through the shown widget's time and a dot per
 * widget, the shown one active (widgets.css draws them).
 */
import { shownAt } from "./rotation.js";
import type { Region } from "./state.js";

function rotationMarks(count: number): HTMLElement {
  const marks = document.createElement("div");
  marks.className = "canccu-rotation";
  const part = (cls: string): HTMLElement => {
    const span = document.createElement("span");
    span.className = cls;
    return span;
  };
  marks.append(part("canccu-rotation__bar"));
  for (let i = 0; i < count; i++) marks.append(part("canccu-rotation__dot"));
  return marks;
}

/**
 * The marks of `region` drawn in `el` at `now`, `current` reused when it fits: only while a hero's
 * rotation shows more than one thing and a widget of it is shown (`widget`; a claim is not), else
 * none. Answers the marks now on the page.
 */
export function syncMarks(
  current: HTMLElement | null,
  el: HTMLElement,
  region: Region,
  widget: boolean,
  zoneKey: string,
  now: number,
): HTMLElement | null {
  const at =
    widget && region.role === "hero" && region.order.length > 1
      ? shownAt(region, zoneKey, now)
      : null;
  if (at === null || at.index === null) {
    current?.remove();
    return null;
  }
  let marks = current;
  if (marks?.childElementCount !== region.order.length + 1) {
    marks?.remove();
    marks = rotationMarks(region.order.length);
    el.append(marks);
  }
  const dwellMs = (region.widgets[at.index]?.dwell_seconds ?? 0) * 1000;
  const progress = dwellMs > 0 ? 1 - (at.until - now) / dwellMs : 0;
  marks.style.setProperty("--canccu-progress", String(Math.round(progress * 1000) / 1000));
  // The dots follow the place order, so a shuffled cycle still lights the widget it shows.
  const plain = [...region.order].sort((x, y) => x - y);
  marks.querySelectorAll(".canccu-rotation__dot").forEach((dot, i) => {
    dot.classList.toggle("canccu-is-active", plain[i] === at.index);
  });
  return marks;
}
