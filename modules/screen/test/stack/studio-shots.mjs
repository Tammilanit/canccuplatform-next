// The Screen studio's screenshots (#189, #190, #263, #264, #265, #267; mockups 06–10 and 13), taken after the screens on
// the same demo fixture (fixture.mjs) and theme, so its live views draw the Pulse the screens do.
// Two screens play while they are taken, one landscape and one portrait, each in the browser at
// its own size, so their heartbeats give the device cards an orientation, a size and a state.
import { expect } from "./client.mjs";
import { removeContent, removePlaylist, seedContent, seedPlaylist } from "./content-fixture.mjs";
import { saveZone } from "./fixture.mjs";
import { previewShots } from "./preview-shots.mjs";

const DESK = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
// Devices' Recent panel sits beside the screens from 1440 px, as Settings' last changes.
const WIDE = { width: 1440, height: 900 };

/** Name, path and viewport of each Studio shot; the pair dialog opens from a kiosk QR's fragment. */
export const STUDIO_PAGES = [
  ["screen-live", "/admin/screen/live"],
  ["screen-devices", "/admin/screen/devices"],
  ["screen-zones", "/admin/screen/zones"],
  ["screen-zone-editor", "/admin/screen/zones/main"],
  ["screen-content", "/admin/screen/content"],
  ["screen-ticker", "/admin/screen/ticker"],
  ["screen-pins", "/admin/screen/pins"],
].flatMap(([name, path]) => [
  [name, path, DESK],
  [`${name}-phone`, path, PHONE],
]);
STUDIO_PAGES.push(
  ["screen-pair-phone", "/admin/screen/devices#pair=K7Q49WXP", PHONE],
  ["screen-devices-wide", "/admin/screen/devices", WIDE],
);

/** Taken while the event is frozen for an hour, then unfrozen: the Pins page and the banner. */
export const FROZEN_PAGES = [
  ["screen-pins-frozen", "/admin/screen/pins", DESK],
  ["screen-pins-frozen-phone", "/admin/screen/pins", PHONE],
  ["screen-live-frozen", "/admin/screen/live", DESK],
];

/**
 * The Content page with a playlist in the builder and its push playing (#264, mockup 10), at the
 * mockup's width and on a phone, where the builder and Push now follow the library.
 */
export const PLAYLIST_PAGES = [
  ["screen-content-playlist", "/admin/screen/content", { width: 1920, height: 1100 }],
  ["screen-content-playlist-phone", "/admin/screen/content", PHONE],
];

/** A tap on the shown day's first window opens its details. */
async function openDetails(page) {
  await page
    .locator(".canccu-sched__day:not(.canccu-sched__day--off) .canccu-sched__block")
    .first()
    .click();
  await page.waitForTimeout(300);
}

/** The window editor (#267): a new window from Add window. */
async function openNew(page) {
  await page.locator("[data-window-new]").click();
  await page.locator("#canccu-sched-editor[open]").waitFor();
}

/** The window editor on a window: its details, then Edit window. */
async function openEdit(page) {
  await openDetails(page);
  await page.locator(".canccu-sched__about:popover-open [data-window-edit]").click();
  await page.locator("#canccu-sched-editor[open]").waitFor();
  await page.waitForTimeout(300);
}

/**
 * Zones and layouts' box editor (#405, sheet 10's lower frames), unsaved: the venue card hidden
 * (the rail grows into its space) and the hero two cells narrower, then the preview the real
 * player draws of it; and Dashboard's hero role, picked in the gallery. The tidy edit has the rail
 * take both columns the hero gave up; with one, a column stays empty and the editor says so (#422).
 */
const editBoxes = (railWider) => async (page) => {
  await page.click('[data-pick="venue_rail"]');
  await page.click('section[data-region="venue_rail"] [data-box-hide]');
  await page.click('[data-pick="hero"]');
  for (let i = 0; i < 2; i++)
    await page.click('section[data-region="hero"] [data-size="narrower"]');
  await page.click('[data-pick="rail"]');
  for (let i = 0; i < railWider; i++)
    await page.click('section[data-region="rail"] [data-size="wider"]');
  await studioReady(page);
};
/** Sheet 16 (#443): the screen name with the header box, the photo wall's settings with the hero's. */
const pickHeader = async (page) => {
  await page.click('[data-pick="header"]');
  await page.selectOption('section[data-region="header"] [name=screen_name]', "always");
  await studioReady(page);
};
const editWall = async (page) => {
  await page.fill('section[data-region="hero"] [name=photo_seconds]', "12");
  await page.selectOption('section[data-region="hero"] [name=photo_order]', "shuffle");
  await studioReady(page);
};
export const LAYOUT_PAGES = [
  ["screen-zone-screen-name", "/admin/screen/zones/main", DESK, { ready: pickHeader }],
  ["screen-zone-photo-wall", "/admin/screen/zones/main", DESK, { ready: editWall }],
  ["screen-zone-boxes", "/admin/screen/zones/main", DESK, { ready: editBoxes(2) }],
  ["screen-zone-boxes-phone", "/admin/screen/zones/main", PHONE, { ready: editBoxes(2) }],
  ["screen-zone-gap", "/admin/screen/zones/main", DESK, { ready: editBoxes(1) }],
  ["screen-zone-gap-phone", "/admin/screen/zones/main", PHONE, { ready: editBoxes(1) }],
  [
    "screen-zone-dashboard",
    "/admin/screen/zones/main?layout=dashboard",
    DESK,
    { ready: studioReady },
  ],
];

/**
 * The main zone saved with Pulse's hero one column narrower: the editor shades that column and
 * warns about it as the page loads, before any edit (#422).
 */
const HERO_SAVED_NARROWER = { column: 1, row: 2, columns: 7, rows: 10 };
async function gapOnLoad(page) {
  await page.locator(".canccu-studio-gap").first().waitFor({ state: "attached", timeout: 5000 });
  await page.locator("[data-fill-gap]").first().waitFor({ timeout: 5000 });
  await studioReady(page);
}

/**
 * "What plays at…" asked about the main hall at 19:20 on the day it offers (today), as mockup 09
 * asks: the welcome loop plays over the evening sponsors, and the menu bound to the evening's
 * dinner has just ended with it, moved by its delay (scheduleFixture).
 */
async function askEvening(page) {
  await page.locator("#canccu-sched-at-zone").selectOption("main");
  await page.locator("#canccu-sched-at-time").fill(EVENING);
  await page.locator("#canccu-sched-at button[type=submit]").click();
  await page.locator("#canccu-sched-at h3").waitFor();
}

/**
 * The Schedule page (#190, #267; mockup 09), last, on windows made for it and removed after it:
 * the zone it opens on, every zone, a phone's one day, a window's details on tap, the window
 * editor for a new window and for one there, and "what plays at…" answered.
 */
export const SCHEDULE_PAGES = [
  ["screen-schedule", "/admin/screen/schedule", WIDE],
  ["screen-schedule-all-zones", "/admin/screen/schedule?zone=all", WIDE],
  ["screen-schedule-phone", "/admin/screen/schedule", PHONE],
  [
    "screen-schedule-details-phone",
    "/admin/screen/schedule",
    PHONE,
    { ready: openDetails, fullPage: false },
  ],
  ["screen-schedule-editor", "/admin/screen/schedule", WIDE, { ready: openNew, fullPage: false }],
  [
    "screen-schedule-editor-phone",
    "/admin/screen/schedule",
    PHONE,
    { ready: openEdit, fullPage: false },
  ],
  ["screen-schedule-at", "/admin/screen/schedule", WIDE, { ready: askEvening }],
  ["screen-schedule-at-phone", "/admin/screen/schedule", PHONE, { ready: askEvening }],
];

/** When "what plays at…" asks: in the evening, while two windows overlap. */
const EVENING = "19:20";

/**
 * Playlists, a break playlist and windows to draw: every day in the main zone and the entrance,
 * an evening window that loses to it, and one bound to the evening's dinner, which ran 15 minutes
 * over (the demo event's zone is UTC, so today's 18:00 is UTC's). The welcome loop and the break
 * play the library's assets, so "what plays at…" can name the item and the next break.
 */
async function scheduleFixture(demo, assets) {
  const made = { playlists: [], windows: [], items: [] };
  const create = async (path, body, what) =>
    expect(await demo.call("POST", path, { body }), 201, what).body.id;
  const playlist = async (body) => {
    const id = await create(
      "/api/screen/playlists",
      { items: [], ...body },
      `playlist ${body.name}`,
    );
    made.playlists.push(id);
    return id;
  };
  const window = async (body) =>
    made.windows.push(await create("/api/screen/schedules", body, "a window"));
  const shown = (ids) => ids.map((asset_id) => ({ asset_id, duration_seconds: 20 }));
  const loop = await playlist({
    name: "Welcome loop",
    type: "regular",
    priority: 0,
    // The trailer, the poster and the deck; the chime is sound only.
    items: shown([assets[0], assets[2], assets[3]]),
  });
  const evening = await playlist({ name: "Evening sponsors", type: "regular", priority: 0 });
  const menu = await playlist({ name: "Menu", type: "regular", priority: 0 });
  await playlist({
    name: "Partners loop",
    type: "break",
    priority: 0,
    items: shown(assets.slice(2, 3)),
    break: {
      period_seconds: 3600,
      break_seconds: 45,
      window_start_minute: 720,
      window_end_minute: 1320,
    },
  });
  const every = [1, 2, 3, 4, 5, 6, 7];
  await window({
    zone_key: "main",
    playlist_id: loop,
    priority: 10,
    days: every,
    start_minute: 480,
    end_minute: 1380,
  });
  await window({
    zone_key: "main",
    playlist_id: evening,
    priority: 5,
    days: every,
    start_minute: 1080,
    end_minute: 120,
  });
  await window({
    zone_key: "entrance",
    playlist_id: loop,
    priority: 10,
    days: every,
    start_minute: 420,
    end_minute: 1440,
  });
  const today = new Date().toISOString().slice(0, 10);
  const dinner = expect(
    await demo.call("POST", "/api/agenda/items", {
      body: {
        title: "Evening dinner",
        kind: "meal",
        starts_at: `${today}T18:00:00Z`,
        ends_at: `${today}T19:00:00Z`,
        location: "Café",
        visibility: "public",
      },
    }),
    201,
    "adding the evening's dinner",
  ).body;
  made.items.push(dinner.id);
  // A late run may find the dinner over; the window and its calendar block still stand.
  const delayed = await demo.call("POST", `/api/agenda/items/${dinner.id}/delay`, {
    body: { revision: dinner.revision, minutes: 15 },
  });
  if (delayed.status !== 200) console.warn(`delaying the dinner answered ${delayed.status}`);
  await window({ zone_key: "main", playlist_id: menu, priority: 50, agenda_item_id: dinner.id });
  return made;
}

async function removeSchedule(demo, made) {
  for (const id of made.items) {
    const { body } = await demo.call("GET", `/api/agenda/items/${id}`).catch(() => ({}));
    if (body?.revision === undefined) continue;
    await demo.call("DELETE", `/api/agenda/items/${id}?revision=${body.revision}`).catch(() => undefined); // prettier-ignore
  }
  for (const id of made.windows)
    await demo.call("DELETE", `/api/screen/schedules/${id}`).catch(() => undefined);
  for (const id of made.playlists)
    await demo.call("DELETE", `/api/screen/playlists/${id}`).catch(() => undefined);
}

// Live views keep their streams open, so there is no network idle: each view the page has loaded
// must draw the run of show, then a second lets the entry motion end. Through the iframe element:
// page.frames() gave the page's own document for an iframe the server drew with `src`.
const drawn = (frame) =>
  frame.locator(".canccu-widget--agenda_now").first().waitFor({ timeout: 30_000 });
async function studioReady(page) {
  // A full-page shot of a page taller than the window resizes the window while it captures, and
  // studio.js then lets go of the live views and loads them again: they were blank in the shot.
  // So the window takes the page's height first, and the capture changes nothing.
  const { width, height } = page.viewportSize();
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  if (full > height) await page.setViewportSize({ width, height: full });
  await page
    .locator("[data-zone-preview]")
    .click({ timeout: 1000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
  const views = page.locator(".canccu-studio-thumb iframe[src]");
  const count = await views.count();
  for (let i = 0; i < count; i++) await drawn(views.nth(i).contentFrame());
  await page.waitForTimeout(1500);
}

/** A paired screen playing in its own browser context, at its own size. */
async function play(browser, at, cookieOn, device, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addCookies([cookieOn(device.cookie)]);
  const page = await context.newPage();
  await page.goto(at("/screen/"));
  await page.waitForSelector(".canccu-layout", { timeout: 30_000 });
  return context;
}

/** Until each device's heartbeat has reported its viewport (contracts/screen.md, Device health). */
async function reported(demo, ids) {
  for (let tries = 0; tries < 30; tries++) {
    const { devices } = expect(
      await demo.call("GET", "/api/screen/devices"),
      200,
      "the devices",
    ).body;
    const seen = devices.filter((d) => ids.includes(d.id) && d.health?.viewport);
    if (seen.length === ids.length) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("a playing screen reported no viewport within 30 s");
}

export async function studioShots({ browser, demo, at, cookieOn, shot }) {
  const devices = [];
  const contexts = [];
  let assets = [];
  let made = null;
  let lists = null;
  let savedRegions = null;
  try {
    assets = await seedContent(demo);
    const hall = await demo.pair("Hall left", "main");
    devices.push(hall);
    const entrance = await demo.pair("Entrance", "entrance");
    devices.push(entrance);
    // The hall screen plays the main zone's sound (contracts/screen.md, Zones); revoking it at the
    // end clears the zone's sound device again.
    await saveZone(demo, "main", { sound: { enabled: true, device_id: hall.id } });
    contexts.push(await play(browser, at, cookieOn, hall, { width: 1920, height: 1080 }));
    contexts.push(await play(browser, at, cookieOn, entrance, { width: 1080, height: 1920 }));
    await reported(demo, [hall.id, entrance.id]);
    for (const [name, path, viewport] of STUDIO_PAGES) {
      await shot(name, path, viewport, { ready: studioReady });
    }
    await previewShots({ demo, shot, hall, ready: studioReady });
    lists = await seedPlaylist(demo, assets);
    for (const [name, path, viewport] of PLAYLIST_PAGES) await shot(name, path, viewport);
    await removePlaylist(demo, lists);
    lists = null;
    for (const [name, path, viewport, o] of LAYOUT_PAGES) await shot(name, path, viewport, o);
    const main = expect(
      await demo.call("GET", "/api/screen/zones/main"),
      200,
      "the main zone",
    ).body;
    savedRegions = main.regions ?? {};
    await saveZone(demo, "main", {
      regions: {
        ...savedRegions,
        hero: { ...savedRegions.hero, area: HERO_SAVED_NARROWER },
      },
    });
    await shot("screen-zone-gap-saved", "/admin/screen/zones/main", DESK, { ready: gapOnLoad });
    await saveZone(demo, "main", { regions: savedRegions });
    savedRegions = null;
    made = await scheduleFixture(demo, assets);
    for (const [name, path, viewport, o] of SCHEDULE_PAGES) await shot(name, path, viewport, o);
    const until = new Date(Date.now() + 3600_000).toISOString();
    expect(
      await demo.call("PUT", "/api/screen/pin", { body: { freeze: true, until } }),
      200,
      "the freeze",
    );
    for (const [name, path, viewport] of FROZEN_PAGES) {
      await shot(name, path, viewport, { ready: studioReady });
    }
  } finally {
    await demo.call("PUT", "/api/screen/pin", { body: { freeze: false } }).catch(() => undefined);
    if (savedRegions !== null)
      await saveZone(demo, "main", { regions: savedRegions }).catch(() => undefined);
    if (made !== null) await removeSchedule(demo, made);
    if (lists !== null) await removePlaylist(demo, lists);
    for (const context of contexts) await context.close();
    for (const device of devices) await demo.revoke(device.id);
    await removeContent(demo, assets);
  }
}
