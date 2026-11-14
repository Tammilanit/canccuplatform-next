// The Director's and the choreographer's frame strips (#447; contracts/screen.md, The Director;
// design guideline sheet 13), handed to the main zone's Pulse as screens.mjs hands its other
// views: the hero's features in turn with the thin line, a surge jumping the queue with the ring,
// and two boxes that would turn together pushed three seconds apart.
import { picture, TILES } from "./handed.mjs";

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const feature = (widget, view, dwell) => ({
  widget,
  template: null,
  embed: null,
  dwell_seconds: dwell,
  stale_after_seconds: null,
  view: { qr: null, stale: false, empty: false, ...view },
});

/** "Today in numbers" as the server composes it at wind-down, with a day of sample counts. */
const TODAY = {
  title: "Today in numbers",
  day_text: "Saturday",
  online_peak: { count: 231, at: "2026-03-14T23:30:00Z", time_text: "01:30" },
  photos: 38,
  points: [40, 62, 88, 120, 150, 171, 160, 198, 231, 212].map((value, i) => ({
    time_text: `${String(10 + i).padStart(2, "0")}:00`,
    value,
    level: Math.round((10 * value) / 231),
  })),
};

/** Each strip: its view, its frames, and the gap before each frame after the first. */
export const DIRECTOR_STRIPS = [
  { view: "director-line", frames: 3 },
  { view: "director-ring", frames: 2 },
  { view: "choreographer", frames: 3 },
];

export const stripNames = (name, frames) =>
  Array.from({ length: frames }, (_, i) => `${name}-f${i + 1}`);

/** The hero's features: tonight's highlight (the demo's next item), the photo wall, the day. */
function features(s, dwell, since) {
  const hero = s.regions.find((r) => r.role === "hero");
  const next = hero?.idle_view?.view;
  if (next === undefined) throw new Error("the demo zone's hero has no next item to highlight");
  return {
    highlight: feature("countdown", { ...next, chip: null, highlight: true }, dwell),
    photo: feature("photo", { ...TILES[0], featured: false, featured_until: null, tiles: TILES }, dwell),
    today: feature("today_numbers", TODAY, dwell),
    surge: feature("hot_game", { game: { id: "g_1", name: "Demo Game", cover_url: picture("#7c3aed", "#0ea5e9") }, players: 14, since }, dwell),
  }; // prettier-ignore
}

/**
 * The state each strip hands the page. The surge started 15 s before the strip, once: the page
 * polls the state again while it has no stream, and each answer must say the same.
 */
export function withDirector(view) {
  const since = ago(15_000);
  return (s) => {
    const f = features(s, 6, since);
    const hero =
      view === "director-line"
        ? { widgets: [f.highlight, f.photo, f.today], indicator: "line" }
        : view === "director-ring"
          ? { widgets: [f.highlight, f.photo, f.surge], indicator: "ring" }
          : // No highlight: the rail would give a countdown of the same item its run of show.
            { widgets: [f.photo, f.today], indicator: "line" };
    return {
      ...s,
      regions: s.regions.map((r) => {
        if (r.role === "hero")
          return { ...r, ...hero, rotation: "director", order: hero.widgets.map((_, i) => i) };
        // Both turn every 6 s, so the choreographer has two changes to space.
        if (r.role === "rail" && view === "choreographer")
          return { ...r, widgets: r.widgets.map((w) => ({ ...w, dwell_seconds: 6 })) };
        return r;
      }),
    };
  };
}

/** Wait until `offsetMs` past the next whole multiple of `periodS` seconds of the clock. */
async function untilTurn(page, periodS, offsetMs) {
  const period = periodS * 1000;
  const wait = (period - (Date.now() % period) + offsetMs) % period;
  await page.waitForTimeout(wait);
}

/**
 * The strip's frames. `director-line`: one frame in each 6 s turn, 2 s in, so each feature shows
 * with its line part filled. `director-ring`: the surge holds the hero, its ring 5 s fuller in the
 * second frame. `choreographer`: just before both turn, after the hero turned, after the rail did.
 */
export async function directorStrip(page, view, shoot) {
  const frame = (n) => shoot(`f${n}`);
  if (view === "director-ring") {
    await page.waitForSelector(".canccu-region--hero .canccu-widget--hot_game.canccu-is-active");
    await page.waitForSelector(".canccu-rotation--ring");
    await page.waitForTimeout(1000);
    await frame(1);
    await page.waitForTimeout(5000);
    return frame(2);
  }
  if (view === "director-line") {
    await page.waitForSelector(".canccu-region--hero .canccu-rotation__bar");
    await untilTurn(page, 6, 2000);
    for (const n of [1, 2, 3]) {
      await frame(n);
      if (n < 3) await page.waitForTimeout(6000);
    }
    return;
  }
  await untilTurn(page, 6, 5000);
  await frame(1);
  await untilTurn(page, 6, 1500);
  await frame(2);
  await page.waitForTimeout(2800);
  await frame(3);
}
