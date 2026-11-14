/**
 * The hero's rotation marks (#375, mockup 02) and the Director's turn indicator (sheet 13, Q22):
 * as a thin line, a bar through the shown widget's time and a dot per widget, the shown one
 * active; as a ring, a ring filling over that time; or nothing (widgets.css draws them). A queue
 * jump's turn fills over the jump's own time.
 */
import { shownAt } from "./rotation.js";
import type { Region } from "./state.js";

function rotationMarks(count: number, ring: boolean): HTMLElement {
  const marks = document.createElement("div");
  marks.className = ring ? "canccu-rotation canccu-rotation--ring" : "canccu-rotation";
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
    widget && region.role === "hero" && region.order.length > 1 && region.indicator !== "off"
      ? shownAt(region, zoneKey, now)
      : null;
  if (at === null || at.index === null) {
    current?.remove();
    return null;
  }
  let marks = current;
  const ring = region.indicator === "ring";
  if (
    marks?.childElementCount !== region.order.length + 1 ||
    marks.classList.contains("canccu-rotation--ring") !== ring
  ) {
    marks?.remove();
    marks = rotationMarks(region.order.length, ring);
    el.append(marks);
  }
  const dwellMs = (region.widgets[at.index]?.dwell_seconds ?? 0) * 1000;
  const turnMs = at.from === undefined ? dwellMs : at.until - at.from;
  const progress = turnMs > 0 ? 1 - (at.until - now) / turnMs : 0;
  marks.style.setProperty("--canccu-progress", String(Math.round(progress * 1000) / 1000));
  // The dots follow the place order, so a shuffled cycle still lights the widget it shows.
  const plain = [...region.order].sort((x, y) => x - y);
  marks.querySelectorAll(".canccu-rotation__dot").forEach((dot, i) => {
    dot.classList.toggle("canccu-is-active", plain[i] === at.index);
  });
  return marks;
}
