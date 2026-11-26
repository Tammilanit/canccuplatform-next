/**
 * An announcement's beat (contracts/screen.md, Announcements by level, #780): its entrance, the
 * re-emphasis and the second beat of a full screen that stays alive, and the living details, all
 * counted from the claim's `starts_at` on the server clock, so every screen of a zone is in the
 * same beat and a reload lands in it. Only classes and custom properties are set here; the
 * pictures are announce-motion.css's, at the motion level on `<body>` (motion.ts).
 */
import type { Level } from "./motion.js";
import { chipText } from "./widget.js";

export interface Beat {
  entering: boolean;
  reemphasis: boolean;
  secondBeat: boolean;
}

/** The entrance's 1 s break-in, and the info card's 2 s glow, which outlasts it. */
const ENTER_MS = 2000;
const REEMPHASIS_EVERY_MS = 25_000;
const REEMPHASIS_MS = 1000;
const BEAT_EVERY_MS = 30_000;
const BEAT_FROM_MS = 12_000;
const BEAT_MS = 8000;
/** The most particles, at `party`; `lively` shows the first 14 (announce-motion.css). */
const PARTICLES = 26;

/** Where `nowMs` falls in the beat of a card that started at `startsAtMs`. Pure. */
export function beatAt(startsAtMs: number, nowMs: number): Beat {
  const t = nowMs - startsAtMs;
  // A device whose clock runs a little behind the start still enters, rather than wait unseen.
  if (!(t >= 0)) return { entering: !Number.isNaN(t), reemphasis: false, secondBeat: false };
  return {
    entering: t < ENTER_MS,
    reemphasis: t >= REEMPHASIS_EVERY_MS && t % REEMPHASIS_EVERY_MS < REEMPHASIS_MS,
    secondBeat: t % BEAT_EVERY_MS >= BEAT_FROM_MS && t % BEAT_EVERY_MS < BEAT_FROM_MS + BEAT_MS,
  };
}

/** "Posted just now", "Posted 3 min ago", "Posted 1 h 5 min ago". */
export function postedText(sinceMs: number): string {
  if (sinceMs < 60_000) return "Posted just now";
  const minutes = Math.floor(sinceMs / 60_000);
  if (minutes < 60) return `Posted ${String(minutes)} min ago`;
  return `Posted ${chipText(minutes * 60_000)} ago`;
}

const LEVELS = ["info", "important", "urgent", "emergency"] as const;
const levelIn = (box: HTMLElement): string =>
  LEVELS.find((l) => box.querySelector(`.canccu-widget__level--${l}`) !== null) ?? "info";

const MOVING = ["canccu-ann--entering", "canccu-ann--reemphasis", "canccu-ann--second"];

/**
 * Brings every claimed announcement under `root` to `nowMs`. A redraw in place (an edit, or the
 * minute's new words) keeps the box and its `starts_at`, so nothing restarts: the entrance runs
 * only in its first two seconds, and the endless motion keeps the phase it was given.
 */
export function animateAnnouncements(root: HTMLElement, nowMs: number, level: Level): void {
  let breakIn = false;
  for (const box of root.querySelectorAll<HTMLElement>(
    ".canccu-widget--announcement.canccu-is-claim",
  )) {
    const startsAt = Date.parse(
      box.querySelector(".canccu-widget__posted")?.getAttribute("datetime") ?? "",
    );
    if (Number.isNaN(startsAt)) continue;
    tickDetails(box, startsAt, nowMs);
    const cardLevel = levelIn(box);
    const full = box.closest(".canccu-region--_full") !== null;
    const alive = full && (cardLevel === "info" || cardLevel === "important") && level !== "none";
    box.classList.toggle("canccu-ann--alive", alive);
    if (box.style.getPropertyValue("--canccu-ann-since") === "")
      box.style.setProperty("--canccu-ann-since", `${String((nowMs - startsAt) / 1000)}s`);
    keepParticles(box, alive && level !== "calm", (nowMs - startsAt) / 1000);
    // At `none` nothing moves: no class starts a picture, and the second line stays shown.
    const beat = level === "none" ? null : beatAt(startsAt, nowMs);
    const on = [
      beat?.entering === true,
      alive && beat?.reemphasis === true,
      alive && beat?.secondBeat === true,
    ];
    MOVING.forEach((cls, i) => box.classList.toggle(cls, on[i] === true));
    if (on[0] === true && cardLevel === "important" && level !== "calm") breakIn = true;
  }
  // Important's break-in dims the rest of the screen for its second (announce-motion.css).
  if (breakIn) root.dataset.breakin = "";
  else delete root.dataset.breakin;
}

/** "Posted …" and the time left, as words and as the bar's share, at every motion level. */
function tickDetails(box: HTMLElement, startsAt: number, nowMs: number): void {
  const posted = box.querySelector(".canccu-widget__posted");
  const words = postedText(Math.max(0, nowMs - startsAt));
  if (posted !== null && posted.textContent !== words) posted.textContent = words;
  const left = box.querySelector<HTMLElement>(".canccu-widget__left");
  const ends = Date.parse(left?.getAttribute("datetime") ?? "");
  if (left === null || Number.isNaN(ends)) return;
  const span = ends - startsAt;
  const share = span > 0 ? Math.min(1, Math.max(0, (ends - nowMs) / span)) : 0;
  left.parentElement?.style.setProperty("--canccu-left", String(Math.round(share * 1000) / 1000));
  const text = nowMs >= ends ? "Ending" : `${chipText(ends - nowMs)} left`;
  if (left.textContent !== text) left.textContent = text;
}

/**
 * The soft particles of a living full screen, CSS-drawn (no canvas). Each is given the phase it
 * has at `sinceS`, so ones drawn again after a redraw in place carry on where the others are.
 */
function keepParticles(box: HTMLElement, want: boolean, sinceS: number): void {
  const held = box.querySelector(":scope > .canccu-widget__particles");
  if (!want) {
    held?.remove();
    return;
  }
  if (held !== null) return;
  const layer = document.createElement("div");
  layer.className = "canccu-widget__particles";
  layer.setAttribute("aria-hidden", "true");
  for (let i = 0; i < PARTICLES; i += 1) {
    const p = document.createElement("i");
    p.style.setProperty("--i", String(i));
    p.style.animationDelay = `${String(-(sinceS + i * 1.7))}s`;
    layer.append(p);
  }
  box.prepend(layer);
}
