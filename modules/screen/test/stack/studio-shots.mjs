// The Screen studio's screenshots (#189, #265; mockups 06, 07, 08 and 13), taken after the screens on
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
    for (const context of contexts) await context.close();
    for (const device of devices) await demo.revoke(device.id);
  }
}
