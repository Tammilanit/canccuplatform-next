// @vitest-environment happy-dom
/**
 * The built-in ticker never ends in "…" (#442): a line wider than its box crawls, and with no
 * motion it steps through the text a line at a time. happy-dom lays nothing out, so each test sets
 * the sizes the browser would measure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { STEP_MS, fitTickers } from "../src/ticker.js";
import { Player } from "../src/player.js";
import { Screen } from "../src/screen.js";
import { FakeApi, fakeNav, json, screenState } from "./fake.js";

const TEXT = "Pizza orders close at 20:00 · Lost and found at the info desk";

function one(root: ParentNode, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`no ${selector}`);
  return el;
}

/**
 * A ticker widget as the built-in template draws it, on the page, its line `width` px wide holding
 * `needed` px.
 */
function ticker(width: number, needed: number, lineHeight = 40, wrapped = 40): HTMLElement {
  const root = document.createElement("main");
  document.body.append(root);
  root.innerHTML =
    '<section class="canccu-region"><div class="canccu-widget canccu-widget--ticker">' +
    '<p class="canccu-widget__label">Info</p><p class="canccu-widget__line"></p></div></section>';
  const line = one(root, ".canccu-widget__line");
  line.textContent = TEXT;
  Object.defineProperty(line, "clientWidth", { get: () => width });
  Object.defineProperty(line, "scrollWidth", { get: () => needed });
  Object.defineProperty(line, "clientHeight", { get: () => lineHeight });
  const steps = HTMLElement.prototype;
  Object.defineProperty(steps, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("canccu-widget__steps") ? wrapped : 0;
    },
  });
  return root;
}
const lineOf = (root: HTMLElement) => one(root, ".canccu-widget__line");

/**
 * Every built-in ticker line measures `width` px wide holding `needed` px, but only on the page:
 * off it a browser lays nothing out and measures 0, as here.
 */
function layOutLines(width: number, needed: number): void {
  const size = (px: number) => ({
    configurable: true,
    get(this: HTMLElement) {
      return this.isConnected && this.classList.contains("canccu-widget__line") ? px : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", size(width));
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", size(needed));
}

const LONG_TICKER = {
  id: "ticker",
  role: "ticker",
  area: { column: 1, row: 12, columns: 12, rows: 1 },
  layer: 1,
  rotation: "sequence",
  order: [0],
  cycle_started_at: new Date(0).toISOString(),
  idle: "logo",
  idle_view: null,
  widgets: [
    {
      widget: "ticker",
      template: null,
      dwell_seconds: 5,
      view: { text: TEXT, qr: null, stale: false, empty: false },
    },
  ],
  claim: null,
};

afterEach(() => {
  document.body.replaceChildren();
  const prototype = HTMLElement.prototype as {
    scrollHeight?: number;
    scrollWidth?: number;
    clientWidth?: number;
  };
  delete prototype.scrollHeight;
  delete prototype.scrollWidth;
  delete prototype.clientWidth;
});

describe("the ticker's line", () => {
  it("stays as it is when it fits", () => {
    const root = ticker(1600, 900);
    fitTickers(root, "moderate", 0);
    expect(lineOf(root).dataset.fit).toBe("fits");
    expect(lineOf(root).textContent).toBe(TEXT);
  });

  it("crawls when it is wider than its box, the copy hidden from screen readers", () => {
    const root = ticker(1600, 2400);
    fitTickers(root, "moderate", 0);
    const line = lineOf(root);
    expect(line.dataset.fit).toBe("crawl");
    const runs = [...line.querySelectorAll(".canccu-widget__run")];
    expect(runs.map((r) => r.textContent)).toEqual([TEXT, TEXT]);
    expect(runs[0]?.getAttribute("aria-hidden")).toBeNull();
    expect(runs[1]?.getAttribute("aria-hidden")).toBe("true");
  });

  it("crawls at the same pace at calm as at moderate (the pace never changes)", () => {
    const calm = ticker(1600, 2400);
    const moderate = ticker(1600, 2400);
    fitTickers(calm, "calm", 0);
    fitTickers(moderate, "moderate", 0);
    expect(lineOf(calm).dataset.fit).toBe("crawl");
    expect(lineOf(calm).style.getPropertyValue("--canccu-crawl-seconds")).toBe(
      lineOf(moderate).style.getPropertyValue("--canccu-crawl-seconds"),
    );
  });

  it("steps through the text a line at a time with no motion, and starts over", () => {
    const root = ticker(1600, 2400, 40, 120);
    fitTickers(root, "none", 0);
    const line = lineOf(root);
    expect(line.dataset.fit).toBe("step");
    const steps = one(line, ".canccu-widget__steps");
    expect(steps.textContent).toBe(TEXT);
    expect(steps.style.transform).toBe("translateY(-0%)");
    fitTickers(root, "none", STEP_MS);
    expect(steps.style.transform).toBe(`translateY(-${String(100 / 3)}%)`);
    fitTickers(root, "none", 2 * STEP_MS);
    expect(steps.style.transform).toBe(`translateY(-${String(200 / 3)}%)`);
    fitTickers(root, "none", 3 * STEP_MS);
    expect(steps.style.transform).toBe("translateY(-0%)");
  });

  it("switches from crawling to stepping when the motion drops to none", () => {
    const root = ticker(1600, 2400, 40, 80);
    fitTickers(root, "moderate", 0);
    fitTickers(root, "none", 0);
    const line = lineOf(root);
    expect(line.dataset.fit).toBe("step");
    expect(line.querySelectorAll(".canccu-widget__run")).toHaveLength(0);
  });

  it("waits off the page: a line not laid out is measured once it is on the page", () => {
    layOutLines(1600, 2400);
    const root = document.createElement("main");
    root.innerHTML =
      '<div class="canccu-widget canccu-widget--ticker"><p class="canccu-widget__line"></p></div>';
    lineOf(root).textContent = TEXT;
    fitTickers(root, "moderate", 0);
    expect(lineOf(root).dataset.fit).toBeUndefined();
    document.body.append(root);
    fitTickers(root, "moderate", 1000);
    expect(lineOf(root).dataset.fit).toBe("crawl");
  });

  it("is fitted by the screen on its first tick on the page", () => {
    layOutLines(1600, 5000);
    const screen = new Screen({ serverNow: () => 0, reducedMotion: () => false });
    const root = screen.draw(
      screenState({
        layout: { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } },
        display: { motion: "moderate", drift: false },
        regions: [LONG_TICKER],
      }),
    );
    // A new layout's <main> is drawn before the player mounts it: nothing to measure yet.
    expect(lineOf(root).dataset.fit).toBeUndefined();
    document.body.append(root);
    screen.tick();
    expect(lineOf(root).dataset.fit).toBe("crawl");
  });

  it("crawls as soon as the player shows a zone, not a second later", async () => {
    vi.useFakeTimers({ now: 0 });
    try {
      layOutLines(1600, 5000);
      const state = screenState({
        layout: { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } },
        display: { motion: "moderate", drift: false },
        regions: [LONG_TICKER],
      });
      const api = new FakeApi().on("GET /api/screen/device/state", () => json(200, state));
      const player = new Player({
        fetch: api.fetch,
        nav: fakeNav(""),
        root: document.body,
        bundle: "1.0.0",
      });
      await player.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(lineOf(document.body).dataset.fit).toBe("crawl");
    } finally {
      vi.useRealTimers();
    }
  });
});
