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
 * The crawl's pace when the state names none (a server before #779): the event's `normal`, in
 * pixels a second of a 1080p screen (contracts/screen.md, Ticker). The PO found 86 px a second
 * slow at the step 5 demo. The energy levels never change it (design guideline, amendment 1).
 */
export const DEFAULT_SPEED = 180;

type Fit = "fits" | "crawl" | "step";

/** The event's pace from the state's ticker, `DEFAULT_SPEED` when it has none. */
export function speedOf(ticker: unknown): number {
  const speed = (ticker as { speed?: unknown } | null)?.speed;
  return typeof speed === "number" && speed > 0 ? speed : DEFAULT_SPEED;
}

export function fitTickers(
  root: HTMLElement,
  motion: Motion,
  nowMs: number,
  speed = DEFAULT_SPEED,
): void {
  const lines = root.querySelectorAll<HTMLElement>(".canccu-widget--ticker .canccu-widget__line");
  for (const line of lines) fit(line, motion, nowMs, speed);
}

function fit(line: HTMLElement, motion: Motion, nowMs: number, speed: number): void {
  const text = line.dataset.text ?? line.textContent;
  const fitted = line.dataset.fit as Fit | undefined;
  const moving = motion === "none" ? "step" : "crawl";
  // Measured once per text and motion: a redraw with new data brings a fresh line element. A new
  // pace only times the crawl again.
  if (fitted !== undefined && (fitted === "fits" || fitted === moving)) {
    if (fitted === "step") step(line, nowMs);
    if (fitted === "crawl" && line.dataset.speed !== String(speed)) time(line, nowMs, speed);
    return;
  }
  // A line off the page (a new layout's `<main>` before the player mounts it) or not laid out yet
  // measures 0 wide and would pass as fitting for good: it waits unfitted for a tick on the page.
  if (!line.isConnected || line.clientWidth === 0) return;
  line.replaceChildren(text);
  line.style.removeProperty("--canccu-crawl-seconds");
  line.style.removeProperty("--canccu-crawl-delay");
  line.dataset.text = text;
  if (line.scrollWidth <= line.clientWidth) {
    line.dataset.fit = "fits";
    return;
  }
  line.dataset.fit = moving;
  if (moving === "crawl") crawl(line, text, nowMs, speed);
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
function crawl(line: HTMLElement, text: string, nowMs: number, speed: number): void {
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
  time(line, nowMs, speed);
}

/**
 * The loop's length at `speed` pixels a second of a 1080p screen, scaled to this screen's short
 * side, and where in the loop the server's clock is: a line drawn again (a redraw, a theme, the
 * page reloaded) goes on from there instead of starting over, and a zone's screens agree.
 */
function time(line: HTMLElement, nowMs: number, speed: number): void {
  const track = line.querySelector<HTMLElement>(".canccu-widget__crawl");
  if (track === null) return;
  const shortSide = Math.min(window.innerWidth, window.innerHeight) || 1080;
  const seconds = Math.max(track.scrollWidth / 2 / ((speed * shortSide) / 1080), 1);
  const into = (nowMs / 1000) % seconds;
  line.dataset.speed = String(speed);
  line.style.setProperty("--canccu-crawl-seconds", `${String(seconds)}s`);
  line.style.setProperty("--canccu-crawl-delay", `${String(-into)}s`);
}

/** Shows line `k` of the wrapped text, by the server's clock, so every screen of a zone agrees. */
function step(line: HTMLElement, nowMs: number): void {
  const steps = line.querySelector<HTMLElement>(".canccu-widget__steps");
  const count = Number(line.dataset.lines ?? "1");
  if (steps === null || count < 1) return;
  const k = Math.floor(nowMs / STEP_MS) % count;
  steps.style.transform = `translateY(-${String((k * 100) / count)}%)`;
}
