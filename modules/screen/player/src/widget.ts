/**
 * One widget on the screen: its stable classes (contracts/theming.md, Stable classes and custom
 * properties) around its template drawn from the view-model, and the parts that tick on the device
 * between pushes: the clock's fields and the time left to a `<time datetime>`.
 */
import { embedWidget } from "@canccu/ui";
import type { EmbedOptions } from "@canccu/ui";
import { currentItem, drawMedia } from "./media.js";
import type { MediaOptions } from "./media.js";
import { templateFor } from "./templates.js";
import { renderTree } from "./tree.js";

export type View = Record<string, unknown>;

/**
 * The `embed` widget is theming's, drawn only by the platform's own component (plan L4):
 * `embedWidget()` escapes every value and frames only sandbox paths. Its markup is parsed here
 * because it is the component's, never a theme's template or data (those go through the tree).
 * An embed cannot be trusted to honour reduced motion, so then the frame is left out (ui.css hides
 * it; the screen's stylesheet may not use `!important`, so no theme CSS could be kept from undoing it).
 */
function drawEmbed(view: View, reducedMotion: boolean): HTMLElement {
  const options: EmbedOptions = {};
  if (typeof view.frame_url === "string" && !reducedMotion) options.frameUrl = view.frame_url;
  if (typeof view.logo_url === "string") options.logoUrl = view.logo_url;
  const holder = document.createElement("template");
  holder.innerHTML = embedWidget(options).toString();
  const el = holder.content.firstElementChild;
  return el instanceof HTMLElement ? el : document.createElement("div");
}

export function drawWidget(
  type: string,
  template: string | null,
  view: View,
  themeTemplates: unknown,
  media: MediaOptions = { sound: false, nowMs: Date.now() },
): HTMLElement {
  const el =
    type === "embed"
      ? drawEmbed(view, media.reducedMotion === true)
      : document.createElement("div");
  el.className = `canccu-widget canccu-widget--${type}`;
  if (view.empty === true) el.classList.add("canccu-is-empty");
  if (view.stale === true) el.classList.add("canccu-is-stale");
  if (type === "playlist") {
    const item = currentItem(view, media.nowMs);
    const shown = item === null ? null : drawMedia(item, media);
    if (shown !== null) el.append(shown);
  } else if (type !== "embed") {
    el.append(...renderTree(templateFor(type, template, themeTemplates), view));
  }
  return el;
}

/**
 * What a widget shows, beyond its place in the rotation: a new photo or playlist frame is a new
 * thing, so it fades in; other new data redraws in place.
 */
export function identity(type: string, view: View): string {
  if (type === "photo") return JSON.stringify(view.url);
  if (type === "playlist") {
    const item = view.item as { url?: unknown; started_at?: unknown } | null | undefined;
    return JSON.stringify([item?.url, item?.started_at]);
  }
  return "";
}

function format(ms: number, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(ms);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(ms);
  }
}

/**
 * The view as it stands at `nowMs`: the clock's fields as the server builds them
 * (src/compose/widgets.ts), and the playlist's item, which moves on to `next_item` by itself. The
 * playlist keeps only the item it shows, so the push that later brings that same item redraws
 * nothing and a playing video never restarts.
 */
export function liveView(type: string, view: View, nowMs: number, timeZone: string): View {
  if (type === "playlist") {
    const rest = Object.fromEntries(Object.entries(view).filter(([k]) => k !== "next_item"));
    return { ...rest, item: currentItem(view, nowMs) };
  }
  if (type !== "clock") return view;
  return {
    ...view,
    // To the minute, as the text shows it: else the clock redraws every second for nothing.
    iso: new Date(Math.floor(nowMs / 60_000) * 60_000).toISOString(),
    time: format(nowMs, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    date: format(nowMs, timeZone, { weekday: "short", day: "numeric", month: "short" }),
  };
}

/** Widgets the device keeps current itself, also offline: they never dim (mockup 16). */
const KEPT_ON_DEVICE = new Set(["clock", "countdown", "playlist"]);
/** What makes a `checkin_qr` a live code (src/push/session.ts drops the same for its sample). */
const CODE_FIELDS = ["url", "image_url", "rotates_at", "valid_until", "qr"];

/**
 * A view as the screen may show it now. A check-in code past its `valid_until` (or, without one,
 * its `rotates_at`) checks no one in, so it shows its empty state instead, whatever the link: a
 * screen that heard no new code (offline, or a cold boot from the kept state before the 10 s mark)
 * must not send attendees to scan a dead one. Online the server pushes the next code at every
 * rotation, ahead of that time.
 */
export function shownView(type: string, view: View, nowMs: number): View {
  if (type !== "checkin_qr" || !codeExpired(view, nowMs)) return view;
  const out: View = { ...view, empty: true };
  for (const field of CODE_FIELDS) out[field] = null;
  return out;
}

/**
 * Offline, the widgets whose content the server keeps dim (`canccu-is-stale`); the clock,
 * countdowns and the kept playlist run on at full strength.
 */
export const dimsOffline = (type: string): boolean => !KEPT_ON_DEVICE.has(type);

function codeExpired(view: View, nowMs: number): boolean {
  const until = typeof view.valid_until === "string" ? view.valid_until : view.rotates_at;
  if (typeof until !== "string") return false;
  const ms = Date.parse(until);
  return !Number.isNaN(ms) && nowMs >= ms;
}

/** A template's progress bar (templates.ts, `bar`) and the seconds it spans. */
const BAR_SPAN = /(?:^| )canccu-widget__bar--(\d+)s(?: |$)/;

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
    const target = Date.parse(el.getAttribute("datetime") ?? "");
    if (Number.isNaN(target)) continue;
    const span = BAR_SPAN.exec(el.className)?.[1];
    if (span !== undefined) {
      // Empty before its last `span` seconds, full at its time.
      const progress = Math.min(1, Math.max(0, 1 - (target - nowMs) / (Number(span) * 1000)));
      el.style.setProperty("--canccu-progress", String(Math.round(progress * 1000) / 1000));
      continue;
    }
    if (el.textContent !== "" && el.dataset.canccuCountdown === undefined) continue;
    el.dataset.canccuCountdown = "";
    el.textContent = countdownText(target - nowMs);
  }
}
