/**
 * The slideshow in the hero (#787 D6a, sheet 01): information over the slides only when needed,
 * and some runs clean. Runs are numbered by the hero's rotation cycle, anchored on the epoch, so
 * every screen of a zone agrees, also offline: an even run is clean from its first slide to its
 * last. On an odd one a band at the hero's foot may show, 15 s from a slide change, at most twice:
 * at the run's first slide and at the first after its middle. Only an open order, food on the way
 * or the next item within 15 minutes earns it; with nothing to say the run plays clean too.
 */
import { shownAt } from "./rotation.js";
import type { Region, ScreenState } from "./state.js";

export interface LowerThird {
  kind: "food_open" | "food_placed" | "next";
  title: string;
  text: string;
  countdown_at: string | null;
  qr_image_url: string | null;
}

const SHOW_MS = 15_000;
const NEXT_WITHIN_MS = 15 * 60_000;

type View = Record<string, unknown>;
const isObject = (v: unknown): v is View => typeof v === "object" && v !== null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The run's two windows: from its first slide change at or after each anchor, 15 s long. */
function inWindow(item: View, runStart: number, runEnd: number, nowMs: number): boolean {
  const start = Date.parse(str(item.started_at) ?? "");
  const lengthMs = (typeof item.duration_seconds === "number" ? item.duration_seconds : 0) * 1000;
  if (Number.isNaN(start) || nowMs < start || nowMs >= start + SHOW_MS) return false;
  // A slide that started at or after the anchor, and no whole slide before it did: the first
  // change after it, with slides of one length, as a slideshow's are.
  const anchors = [runStart, runStart + (runEnd - runStart) / 2];
  return anchors.some((a) => start >= a && start - a < Math.max(lengthMs, 1));
}

/** A box's view of `type` on the screen, in whichever region lists it. */
const viewOf = (state: ScreenState, type: string, on = false): View | undefined =>
  state.regions
    .flatMap((r) => r.widgets)
    .find((w) => w.widget === type && w.view.empty !== true && !(on && w.enabled === false))?.view;

function food(state: ScreenState): LowerThird | null {
  // A switched-off food item says nothing (#787 D3): no band, so no food box steps aside either.
  const view = viewOf(state, "food_status", true);
  const first = Array.isArray(view?.orders) ? (view.orders[0] as unknown) : undefined;
  if (view === undefined || !isObject(first)) return null;
  const join = isObject(view.join) ? str(view.join.image_url) : null;
  const base = { text: str(first.pizzeria_name) ?? "", countdown_at: str(view.countdown_at) };
  if (first.state === "open")
    return { kind: "food_open", title: "Pizza order open", ...base, qr_image_url: join };
  if (first.state === "placed")
    return { kind: "food_placed", title: "Pizza on the way", ...base, qr_image_url: null };
  return null;
}

function next(state: ScreenState, nowMs: number): LowerThird | null {
  const items = viewOf(state, "agenda_now")?.items;
  const row = (Array.isArray(items) ? (items as unknown[]) : []).find(
    // A delayed next item is still the next thing on (contracts/screen.md, agenda_now).
    // Still ahead: a running item that started late is also "delayed" but is not next.
    (i): i is View =>
      isObject(i) &&
      (i.state === "next" || i.state === "delayed") &&
      Date.parse(str(i.starts_at) ?? "") > nowMs,
  );
  const startsAt = Date.parse(str(row?.starts_at) ?? "");
  if (row === undefined || Number.isNaN(startsAt) || startsAt - nowMs > NEXT_WITHIN_MS) return null;
  return {
    kind: "next",
    title: `Next: ${str(row.name) ?? ""}`,
    text: str(row.starts_text) ?? "",
    countdown_at: str(row.starts_at),
    qr_image_url: null,
  };
}

/**
 * The band the hero shows over its slideshow at `nowMs`, or null. `drawn` is the rotation's turn
 * the hero draws: a turn the choreographer holds or a claim's `next` skips is not the playlist
 * turn the rotation names, and a band over it would say the wrong thing.
 */
export function lowerThirdAt(
  hero: Region,
  state: ScreenState,
  nowMs: number,
  drawn: number | null,
): LowerThird | null {
  if (hero.rotation !== "director" || hero.claim != null) return null;
  const zone = state.zone?.key ?? "";
  const turn = shownAt(hero, zone, nowMs);
  if (turn.index === null || turn.index !== drawn) return null;
  const w = hero.widgets[turn.index];
  if (w?.widget !== "playlist" || !isObject(w.view.item) || !Number.isFinite(turn.until))
    return null;
  const cycleMs = hero.order.reduce((s, i) => s + (hero.widgets[i]?.dwell_seconds ?? 0), 0) * 1000;
  const runStart = turn.until - w.dwell_seconds * 1000;
  if (cycleMs <= 0 || Math.floor(runStart / cycleMs) % 2 === 0) return null;
  if (!inWindow(w.view.item, runStart, turn.until, nowMs)) return null;
  return food(state) ?? next(state, nowMs);
}

const bands = new WeakMap<HTMLElement, { key: string; el: HTMLElement }>();

function bandOf(third: LowerThird): HTMLElement {
  const el = document.createElement("aside");
  el.className = `canccu-lower-third canccu-lower-third--${third.kind}`;
  const title = document.createElement("p");
  title.className = "canccu-lower-third__title";
  title.textContent = third.title;
  const text = document.createElement("p");
  text.className = "canccu-lower-third__text";
  text.textContent = third.text;
  el.append(title, text);
  if (third.countdown_at !== null) {
    // Counted by widget.ts's fillCountdowns, as any empty `<time datetime>` on the screen.
    const time = document.createElement("time");
    time.className = "canccu-lower-third__countdown";
    time.dateTime = third.countdown_at;
    el.append(time);
  }
  if (third.qr_image_url !== null) {
    const img = document.createElement("img");
    img.className = "canccu-lower-third__qr";
    img.src = third.qr_image_url;
    img.alt = "";
    el.append(img);
  }
  return el;
}

/** Draws the hero's band as `third` says, keeping it while it says the same. */
export function syncLowerThird(region: HTMLElement, third: LowerThird | null): void {
  const had = bands.get(region);
  const key = third === null ? "" : JSON.stringify(third);
  // A redraw of the region may have taken the band out with the old widget.
  if (had?.key === key && had.el.isConnected) return;
  had?.el.remove();
  bands.delete(region);
  if (third === null) return;
  const el = bandOf(third);
  region.append(el);
  bands.set(region, { key, el });
}
