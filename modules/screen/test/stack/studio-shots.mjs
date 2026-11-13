// The Screen studio's screenshots (#189, #190; mockups 06–09 and 13), taken after the screens on
// the same demo fixture (fixture.mjs) and theme, so its live views draw the Pulse the screens do.
// Two screens play while they are taken, one landscape and one portrait, each in the browser at
// its own size, so their heartbeats give the device cards an orientation, a size and a state.
import { expect } from "./client.mjs";
import { saveZone } from "./fixture.mjs";

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
  ["screen-ticker", "/admin/screen/ticker"],
].flatMap(([name, path]) => [
  [name, path, DESK],
  [`${name}-phone`, path, PHONE],
]);
STUDIO_PAGES.push(
  ["screen-pair-phone", "/admin/screen/devices#pair=K7Q49WXP", PHONE],
  ["screen-devices-wide", "/admin/screen/devices", WIDE],
);

/** A tap on the shown day's first window opens its details. */
async function openDetails(page) {
  await page
    .locator(".canccu-sched__day:not(.canccu-sched__day--off) .canccu-sched__block")
    .first()
    .click();
  await page.waitForTimeout(300);
}

/**
 * The Schedule page (#190, mockup 09), last, on windows made for it and removed after it: the
 * zone it opens on, every zone, a phone's one day, and a window's details on tap.
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
];

/**
 * Two playlists, a break playlist and windows to draw: every day in the main zone and the
 * entrance, an evening window that loses to it, and one bound to the first run-of-show item that
 * has an end. Empty playlists are enough: the calendar shows windows, not what they play.
 */
async function scheduleFixture(demo) {
  const made = { playlists: [], windows: [] };
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
  const loop = await playlist({ name: "Welcome loop", type: "regular", priority: 0 });
  const evening = await playlist({ name: "Evening sponsors", type: "regular", priority: 0 });
  const menu = await playlist({ name: "Menu", type: "regular", priority: 0 });
  await playlist({
    name: "Partners loop",
    type: "break",
    priority: 0,
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
  const { items } = expect(await demo.call("GET", "/api/agenda/items"), 200, "the agenda").body;
  const item = items.find((i) => i.ends_at !== null && i.status === "scheduled");
  if (item !== undefined) {
    await window({ zone_key: "main", playlist_id: menu, priority: 50, agenda_item_id: item.id });
  }
  return made;
}

async function removeSchedule(demo, made) {
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
  let made = null;
  try {
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
    made = await scheduleFixture(demo);
    for (const [name, path, viewport, o] of SCHEDULE_PAGES) await shot(name, path, viewport, o);
  } finally {
    if (made !== null) await removeSchedule(demo, made);
    for (const context of contexts) await context.close();
    for (const device of devices) await demo.revoke(device.id);
  }
}
