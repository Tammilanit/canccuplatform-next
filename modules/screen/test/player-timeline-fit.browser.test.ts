/// <reference lib="dom" />
/**
 * The coming hours' axis drops times that would touch (player/src/timeline-fit.ts), in Chromium,
 * where the widths are real: the stride it picks keeps the first and last hour, drops evenly, and
 * leaves no two shown times touching; a line with room keeps every time.
 */
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { touchingNext } from "./stack/timeline-fit.mjs";
import { bundle, draw, launch, screenPage, tick } from "./player-browser.js";

const STATES = JSON.parse(
  await readFile(new URL("fixtures/pulse-states.json", import.meta.url), "utf8"),
) as {
  landscape: {
    time: string;
    regions: { id: string; area: unknown; order: number[]; rotation: string; widgets: unknown[] }[];
  };
};

const browser = await launch();
const code = browser === undefined ? undefined : await bundle();
afterAll(async () => {
  await browser?.close();
});

/** A line of `hours` hours with an hour's time at each end of every hour, and one item to draw. */
function view(hours: number, nowMs: number) {
  const iso = (ms: number) => new Date(ms).toISOString();
  const from = Math.floor(nowMs / 3_600_000) * 3_600_000;
  return {
    title: "The coming hours",
    subtitle: `The next ${String(hours)} hours`,
    from: iso(from),
    to: iso(from + hours * 3_600_000),
    now: iso(nowMs),
    from_text: "00:00",
    to_text: "00:00",
    hours,
    span_seconds: hours * 3600,
    ticks: Array.from({ length: hours + 1 }, (_, h) => ({
      text: `${String(h % 24).padStart(2, "0")}:00`,
    })),
    items: [
      {
        name: "Dinner",
        kind: "other",
        starts_at: iso(from),
        ends_at: iso(from + 3_600_000),
        place: "Main stage",
        starts_text: "18:00",
        range_text: "18:00–19:00",
        col: 1,
        cols: 6,
        row: 1,
        label_col: 1,
        label_cols: 12,
        align: "start",
      },
    ],
    marks: [],
  };
}

async function axisOf(hours: number) {
  if (browser === undefined || code === undefined) throw new Error("no browser");
  const state = structuredClone(STATES.landscape);
  const hero = state.regions.find((r) => r.id === "hero");
  if (hero === undefined) throw new Error("the fixture has no hero");
  hero.area = { column: 1, row: 2, columns: 8, rows: 10 };
  hero.rotation = "director";
  hero.order = [0];
  hero.widgets = [
    {
      widget: "agenda_timeline",
      template: null,
      embed: null,
      dwell_seconds: 45,
      stale_after_seconds: null,
      view: { qr: null, stale: false, empty: false, ...view(hours, Date.parse(state.time)) },
    },
  ];
  const page = await screenPage(browser, code, [1920, 1080], Date.parse(state.time), "");
  await draw(page, state);
  await page.waitForTimeout(500);
  await tick(page, 0);
  const ticks = await page.$$eval(".canccu-widget--agenda_timeline .canccu-widget__tick", (els) =>
    els.map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return {
        off: el.classList.contains("canccu-widget__tick--off"),
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      };
    }),
  );
  await page.close();
  return ticks;
}

describe.skipIf(browser === undefined)("the coming hours' axis stride", { timeout: 60_000 }, () => {
  it("keeps every hour's time where there is room", async () => {
    expect((await axisOf(3)).map((t) => t.off)).toEqual([false, false, false, false]);
  });

  it("drops times evenly from a crowded line, keeps both ends, and leaves none touching", async () => {
    const ticks = await axisOf(24);
    const off = ticks.map((t) => t.off);
    expect(off.some(Boolean)).toBe(true);
    expect(off[0]).toBe(false);
    expect(off[off.length - 1]).toBe(false);
    // The stride is the first shown index after 0; every other shown one but the last follows it.
    const stride = off.findIndex((o, i) => i > 0 && !o);
    expect(stride).toBeGreaterThan(1);
    expect(off.slice(0, -1)).toEqual(off.slice(0, -1).map((_, i) => i % stride !== 0));
    expect(touchingNext(ticks.filter((t) => !t.off))).toEqual([]);
  });
});
