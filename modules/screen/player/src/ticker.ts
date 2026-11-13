/**
 * The built-in ticker never ends in "…" (#442; design sheets 9–11): a line wider than its box
 * crawls, and where the screen has no motion (`none`, or the device's reduced motion) it steps
 * through the text a line at a time instead. A theme's own ticker template draws itself and is
 * left alone: only the built-in line (`canccu-widget__line`) is fitted.
 */
import type { Motion } from "./display.js";

/** How long each line shows when the ticker steps. */
export const STEP_MS = 5000;
/**
 * The crawl's pace, in screen short sides a second: about 86 px a second at 1080p, slow enough to
 * read from across a hall. The same at calm and moderate: the energy levels never change the pace
 * (design guideline, amendment 1).
 */
const CRAWL_PER_SECOND = 0.08;

type Fit = "fits" | "crawl" | "step";

export function fitTickers(root: HTMLElement, motion: Motion, nowMs: number): void {
  const lines = root.querySelectorAll<HTMLElement>(".canccu-widget--ticker .canccu-widget__line");
  for (const line of lines) fit(line, motion, nowMs);
}

function fit(line: HTMLElement, motion: Motion, nowMs: number): void {
  const text = line.dataset.text ?? line.textContent;
  const fitted = line.dataset.fit as Fit | undefined;
  const moving = motion === "none" ? "step" : "crawl";
  // Measured once per text and motion: a redraw with new data brings a fresh line element.
  if (fitted !== undefined && (fitted === "fits" || fitted === moving)) {
    if (fitted === "step") step(line, nowMs);
    return;
  }
  // A line off the page (a new layout's `<main>` before the player mounts it) or not laid out yet
  // measures 0 wide and would pass as fitting for good: it waits unfitted for a tick on the page.
  if (!line.isConnected || line.clientWidth === 0) return;
  line.replaceChildren(text);
  line.style.removeProperty("--canccu-crawl-seconds");
  line.dataset.text = text;
  if (line.scrollWidth <= line.clientWidth) {
    line.dataset.fit = "fits";
    return;
  }
  line.dataset.fit = moving;
  if (moving === "crawl") crawl(line, text);
  else {
    const steps = document.createElement("span");
    steps.className = "canccu-widget__steps";
    steps.textContent = text;
    line.replaceChildren(steps);
    // The line box is one line tall (widgets.css), so the wrapped text's height counts its lines.
    const count = Math.max(1, Math.round(steps.scrollHeight / Math.max(1, line.clientHeight)));
    line.dataset.lines = String(count);
    step(line, nowMs);
  }
}

/** Two runs of the text in a track that slides by one run, so the loop never shows a gap. */
function crawl(line: HTMLElement, text: string): void {
  const track = document.createElement("span");
  track.className = "canccu-widget__crawl";
  for (const copy of [false, true]) {
    const run = document.createElement("span");
    run.className = "canccu-widget__run";
    run.textContent = text;
    if (copy) run.setAttribute("aria-hidden", "true");
    track.append(run);
  }
  line.replaceChildren(track);
  const shortSide = Math.min(window.innerWidth, window.innerHeight) || 1080;
  const seconds = track.scrollWidth / 2 / (shortSide * CRAWL_PER_SECOND);
  line.style.setProperty("--canccu-crawl-seconds", `${String(Math.max(seconds, 1))}s`);
}

/** Shows line `k` of the wrapped text, by the server's clock, so every screen of a zone agrees. */
function step(line: HTMLElement, nowMs: number): void {
  const steps = line.querySelector<HTMLElement>(".canccu-widget__steps");
  const count = Number(line.dataset.lines ?? "1");
  if (steps === null || count < 1) return;
  const k = Math.floor(nowMs / STEP_MS) % count;
  steps.style.transform = `translateY(-${String((k * 100) / count)}%)`;
}
