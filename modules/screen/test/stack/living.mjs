// A living screen's strips (#787 D1, D5, D6a; sheet 01), handed to the main zone's Pulse as
// director.mjs hands its own: the idle rotation's four items a turn apart, and the slideshow in
// the hero, a run with its lower third and the next one clean. In the default and level-up themes,
// at 1080p and portrait (#787 Q7). The frames stand in for the short video CI cannot capture.
import { turnsSettled } from "./dashboard.mjs";
import { TILES } from "./handed.mjs";

export const LIVING_THEMES = ["default", "level-up"];
export const LIVING_STRIPS = [
  { view: "living-rotation", frames: 4 },
  { view: "living-slideshow", frames: 2 },
];

const TURN_S = 6;
const RUN_S = 12;
const at = (ms) => new Date(ms).toISOString();
const item = (widget, view, dwell) => ({
  widget,
  template: null,
  embed: null,
  dwell_seconds: dwell,
  stale_after_seconds: null,
  view: { qr: null, stale: false, empty: false, ...view },
});

/** The hub QR's code as the server drew it: any QR image the stack made will do for a join QR. */
function qrImage(s) {
  const qr = s.regions.flatMap((r) => r.widgets).find((w) => w.widget === "qr");
  if (qr === undefined) throw new Error("the demo zone shows no QR to borrow");
  return qr.view.image_url;
}

/** An open order closing in 12 minutes, with its join QR, as the food box's view says it. */
function openOrder(s, now) {
  const closes = at(now + 12 * 60_000);
  return {
    title: "Food",
    big_label: "Open · closes",
    big_text: "18:30",
    state: "open",
    pizzeria_name: "Demo Pizzeria",
    orders: [
      { state: "open", seq: 3, pizzeria_name: "Demo Pizzeria", closes_at: closes, status_text: "Open · closes 18:30 · 9 pizzas", join_url: "https://demo.example/pizza/orders/po_1" },
    ],
    countdown_at: closes,
    join: { url: "https://demo.example/pizza/orders/po_1", label: "Join the order", image_url: qrImage(s) },
  }; // prettier-ignore
}

/** The coming hours from the demo's next item, with the order's close marked on the line. */
function timeline(next, now) {
  const from = Math.floor(now / 1_800_000) * 1_800_000;
  const starts = Date.parse(next.target_at);
  const col = (ms) => Math.min(18, Math.max(1, Math.floor((ms - from) / 600_000) + 1));
  return {
    title: "The coming hours",
    from: at(from),
    to: at(from + 3 * 3_600_000),
    now: at(now),
    from_text: "18:00",
    to_text: "21:00",
    items: [
      { name: "Dinner", kind: "food", starts_text: "17:30", place: "Café", col: 1, cols: 4 },
      { name: next.label, kind: next.kind ?? "tournament", starts_text: "19:30", place: "Main stage", col: col(starts), cols: 6 },
    ],
    marks: [{ label: "Pizza order closes", at_text: "18:30", col: 4 }],
  }; // prettier-ignore
}

const STATS = {
  members: 412,
  online: 187,
  in_voice: 46,
  members_trend: "up",
  online_trend: "up",
  in_voice_trend: "flat",
};

/** When the slideshow strip's odd run starts: the band's run, far enough ahead for the page. */
let oddRunAt = 0;

/** The state each strip hands the page; worked out once, as the page may ask again. */
export function withLiving(view) {
  const now = Date.now();
  const cycle = 2 * RUN_S * 1000;
  let k = Math.ceil((now + 20_000) / cycle);
  if (k % 2 === 0) k += 1;
  if (view === "living-slideshow") oddRunAt = k * cycle;
  return (s) => {
    const hero = s.regions.find((r) => r.role === "hero");
    const next = hero?.idle_view?.view;
    if (next === undefined) throw new Error("the demo zone's hero has no next item");
    const food = openOrder(s, now);
    const widgets =
      view === "living-rotation"
        ? [
            item("countdown", { ...next, chip: null }, TURN_S),
            item("agenda_timeline", timeline(next, now), TURN_S),
            item("food_status", food, TURN_S),
            item("stats", STATS, TURN_S),
          ]
        : [
            item("playlist", { item: slide(oddRunAt), next_item: null, run_seconds: RUN_S }, RUN_S),
            item("countdown", { ...next, chip: null }, RUN_S),
          ]; // prettier-ignore
    return {
      ...s,
      regions: s.regions.map((r) => {
        if (r.role === "hero")
          return { ...r, widgets, rotation: "director", order: widgets.map((_, i) => i) };
        // The venue rail's food box has the same order, so one place at a time shows.
        return {
          ...r,
          widgets: r.widgets.map((w) => (w.widget === "food_status" ? { ...w, view: { ...w.view, ...food, empty: false } } : w)),
        }; // prettier-ignore
      }),
    };
  };
}

/**
 * The slide's path on the stack's own origin: the player draws only an own path
 * (player/src/media.ts), so a `data:` slide left the hero bare and the strip still passed.
 */
const SLIDE_PATH = "/api/screen/files/canccu-living-slide.svg";

/**
 * Serves one of the photo tiles at the slide's path, before the page first asks for it. On the
 * context: the player's service worker fetches the screen's files, which a page's route never sees.
 */
export const serveSlide = (page) =>
  page.context().route(`**${SLIDE_PATH}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: Buffer.from(TILES[0].url.slice(TILES[0].url.indexOf(",") + 1), "base64"),
    }),
  );

/** The slide, from the run's start for the whole strip. */
const slide = (startsAt) => ({
  kind: "image",
  url: SLIDE_PATH,
  slide_urls: [],
  started_at: at(startsAt),
  offset_seconds: 0,
  duration_seconds: 600,
  muted: true,
});

async function waitUntil(page, ms) {
  await page.waitForTimeout(Math.max(0, ms - Date.now()));
}

/**
 * The strip's frames. `living-rotation`: one frame in each 6 s turn, 2.5 s in, from the cycle's
 * first. `living-slideshow`: 2.5 s into the odd run, with its band, then 2.5 s into the next run
 * of the slideshow, clean.
 */
export async function livingStrip(page, view, shoot) {
  if (view === "living-rotation") {
    await page.waitForSelector(".canccu-region--hero .canccu-rotation__bar");
    const cycle = 4 * TURN_S * 1000;
    await waitUntil(page, Math.ceil(Date.now() / cycle) * cycle + 2500);
    for (const n of [1, 2, 3, 4]) {
      await turnsSettled(page);
      await shoot(`f${n}`);
      if (n < 4) await page.waitForTimeout(TURN_S * 1000);
    }
    return;
  }
  await waitUntil(page, oddRunAt + 2500);
  // A slide that does not load fails the strip: the band over a bare hero is no shot of D6a.
  await page.waitForSelector(".canccu-region--hero .canccu-widget--playlist img");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".canccu-region--hero .canccu-widget--playlist img")].some(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  await page.waitForSelector(".canccu-region--hero > .canccu-lower-third");
  await shoot("f1");
  await waitUntil(page, oddRunAt + 2 * RUN_S * 1000 + 2500);
  if ((await page.locator(".canccu-lower-third").count()) !== 0)
    throw new Error("living-slideshow: the even run is not clean");
  await shoot("f2");
}
