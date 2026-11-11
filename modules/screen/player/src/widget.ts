/**
 * One widget on the screen: its stable classes (contracts/theming.md, Stable classes and custom
 * properties) around its template drawn from the view-model, and the parts that tick on the device
 * between pushes: the clock's fields and the time left to a `<time datetime>`.
 */
import { templateFor } from "./templates.js";
import { renderTree } from "./tree.js";

export type View = Record<string, unknown>;

export function drawWidget(
  type: string,
  template: string | null,
  view: View,
  themeTemplates: unknown,
): HTMLElement {
  const el = document.createElement("div");
  el.className = `canccu-widget canccu-widget--${type}`;
  if (view.empty === true) el.classList.add("canccu-is-empty");
  if (view.stale === true) el.classList.add("canccu-is-stale");
  el.append(...renderTree(templateFor(type, template, themeTemplates), view));
  return el;
}

function format(ms: number, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(ms);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(ms);
  }
}

/** The clock's view-model at `nowMs`, as the server builds it (src/compose/widgets.ts). */
export function liveView(type: string, view: View, nowMs: number, timeZone: string): View {
  if (type !== "clock") return view;
  return {
    ...view,
    iso: new Date(nowMs).toISOString(),
    time: format(nowMs, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    date: format(nowMs, timeZone, { weekday: "short", day: "numeric", month: "short" }),
  };
}

const two = (n: number): string => String(n).padStart(2, "0");

/** `00:47:18`: hours run past 24 rather than turn into days, so the text stays one shape. */
export function countdownText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/**
 * A `<time datetime>` that a template leaves empty shows the time left to it, counted here: a
 * view-model carries only the target (`countdown.target_at`), and the device keeps counting, also
 * offline. One that holds text is the template's own and is left alone.
 */
export function fillCountdowns(root: ParentNode, nowMs: number): void {
  for (const el of root.querySelectorAll<HTMLTimeElement>("time[datetime]")) {
    if (el.textContent !== "" && el.dataset.canccuCountdown === undefined) continue;
    const target = Date.parse(el.getAttribute("datetime") ?? "");
    if (Number.isNaN(target)) continue;
    el.dataset.canccuCountdown = "";
    el.textContent = countdownText(target - nowMs);
  }
}
