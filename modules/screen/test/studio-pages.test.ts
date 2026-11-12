/**
 * The Screen studio's pages (#189): sign-in and rights per page and per action, the home by the
 * event's state, the pair dialog, the zone editor, the ticker and the page's headers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, SESSIONS, TENANTS, call, context, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("studio pages", () => {
  let h: Harness;
  beforeAll(async () => {
    SESSIONS.zoner = ["screen.zones.write"];
    SESSIONS.viewer = ["screen.devices.read"];
    h = await harness();
  });
  afterAll(async () => {
    Reflect.deleteProperty(SESSIONS, "zoner");
    Reflect.deleteProperty(SESSIONS, "viewer");
    await h.close();
  });

  const page = (url: string, session?: string, host = "alpha.test") =>
    call(h, "GET", url, { host, ...(session ? { session } : {}) });

  it("sends a signed-out browser to sign in, back to the page it asked for", async () => {
    const res = await page("/admin/screen/devices");
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/admin/sign-in?next=%2Fadmin%2Fscreen%2Fdevices");
  });

  it("refuses a page without its right in words, without the right's id", async () => {
    const res = await page("/admin/screen/zones", "crew");
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("the Screen studio");
    expect(res.body).not.toContain("screen.zones.write");
    expect((await page("/admin/screen/", "nobody")).statusCode).toBe(403);
  });

  it("opens on Live while the event runs and on Zones before it, or the first tab one has", async () => {
    expect((await page("/admin/screen/", "admin")).headers.location).toBe("/admin/screen/live");
    expect((await page("/admin/screen/", "admin", "eta.test")).headers.location).toBe(
      "/admin/screen/zones",
    );
    expect((await page("/admin/screen/", "ticker")).headers.location).toBe("/admin/screen/ticker");
    expect((await page("/admin/screen/", "crew", "eta.test")).headers.location).toBe(
      "/admin/screen/live",
    );
  });

  it("shows each tab only to holders of its right", async () => {
    const tabs = (body: string) =>
      [...body.matchAll(/<nav class="canccu-tabs"[^>]*>(.*?)<\/nav>/g)][0]?.[1] ?? "";
    const all = tabs((await page("/admin/screen/live", "admin")).body);
    expect(all).toContain(">Zones<");
    expect(all).toContain(">Ticker<");
    const crew = tabs((await page("/admin/screen/live", "crew")).body);
    expect(crew).toContain(">Devices<");
    expect(crew).not.toContain(">Zones<");
    expect(crew).not.toContain(">Ticker<");
  });

  it("draws Live with every zone as a live view that opens full size", async () => {
    const res = await page("/admin/screen/live", "admin");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-src="/screen/zones/main"');
    expect(res.body).toContain('href="/screen/zones/main"');
    // Pairing looks as it does on Devices, where it is the main action.
    expect(res.body).toContain(
      '<a class="canccu-button canccu-button--primary" href="/admin/screen/devices#pair=">',
    );
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["content-security-policy"]).toContain("frame-src 'self'");
  });

  it("lists devices with health and actions only for those who may act", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Hall left");
    const admin = (await page("/admin/screen/devices", "admin")).body;
    expect(admin).toContain("Hall left");
    expect(admin).toContain(`/api/screen/devices/${id}/commands`);
    expect(admin).toContain('id="canccu-studio-pair"');
    expect(admin).toContain("Clear open codes");
    // Never seen by a heartbeat: not online, and no live view of nothing.
    expect(admin).toContain("Not seen yet");
    expect(admin).toMatch(/\b1 screen · 0 online · 1 offline/);
    expect(admin).toContain(">Assign");
    expect(admin).toContain(">Recent<");
    expect(admin).toContain("Hall left paired");
    const viewer = (await page("/admin/screen/devices", "viewer")).body;
    expect(viewer).toContain("Hall left");
    expect(viewer).not.toContain("/commands");
    expect(viewer).not.toContain('id="canccu-studio-pair"');
  });

  it("draws a screen's card in its own orientation, with its zone, sound and what it shows now", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Café TV");
    const device = { host: "alpha.test", cookies: { canccu_device: token } };
    const assigned = await call(h, "PUT", `/api/screen/devices/${id}/assignment`, {
      host: "alpha.test",
      session: "admin",
      body: { zone_key: "main" },
    });
    expect(assigned.statusCode).toBe(200);
    await call(h, "POST", "/api/screen/device/heartbeat", {
      ...device,
      body: { state_version: 0, bundle_version: "b1", theme_revision: 0, viewport: { width: 1080, height: 1920 } },
    }); // prettier-ignore
    // The state read composes the zone's record, which the card reads for its Now line.
    expect((await call(h, "GET", "/api/screen/device/state", device)).statusCode).toBe(200);
    const body = (await page("/admin/screen/devices", "admin")).body;
    const card = body.slice(body.indexOf(`id="device-${id}"`));
    expect(card).toMatch(/· sound off · portrait 1080×1920</);
    expect(card).toMatch(/<p class="canccu-small">Now: [^<]+<\/p>/);
    expect(card).toContain("canccu-studio-thumb--portrait");
    expect(card).toContain('data-src="/screen/zones/main?orientation=portrait"');
    // Only the zone's name is its link in the zones list; the key, layout and screens are muted.
    const zones = (await page("/admin/screen/zones", "zoner")).body;
    expect(zones).toMatch(/<a href="\/admin\/screen\/zones\/main">[^<·]+<\/a>/);
    expect(zones).toMatch(/<p class="canccu-list__meta">main · [^<]+ · \d+ screens?<\/p>/);
  });

  it("names the event's own start address in the offline steps, never the request's host", async () => {
    // An alias of alpha, and an event that has no hostname yet.
    TENANTS["alias.alpha.test"] = context("alpha");
    TENANTS["bare.test"] = context("bare", { primary_hostname: null });
    try {
      const offline = async (host: string, name: string) => {
        const { token } = await pairDevice(h, host, name);
        await call(h, "POST", "/api/screen/device/heartbeat", {
          host,
          cookies: { canccu_device: token },
          body: { state_version: 3, bundle_version: "b1", theme_revision: 2 },
        });
        h.clock.now += 120_000;
      };
      await offline("alpha.test", "Stage right");
      const alias = (await page("/admin/screen/devices", "admin", "alias.alpha.test")).body;
      expect(alias).toContain("Stage right is offline since");
      expect(alias).toContain("Open the start address again: https://alpha.test/screen/");
      expect(alias).not.toContain("alias.alpha.test/screen/");

      await offline("bare.test", "Bar");
      const bare = (await page("/admin/screen/devices", "admin", "bare.test")).body;
      expect(bare).toContain("Bar is offline since");
      expect(bare).toContain("Open the screen&#39;s start address again.");
      expect(bare).not.toContain("bare.test/screen/");
    } finally {
      Reflect.deleteProperty(TENANTS, "alias.alpha.test");
      Reflect.deleteProperty(TENANTS, "bare.test");
    }
  });

  it("draws the zone editor with the zone read, its layout's regions and a true preview", async () => {
    const res = await page("/admin/screen/zones/main", "zoner");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-region="hero"');
    expect(res.body).toContain('data-region="ticker"');
    expect(res.body).toContain('data-zone="{&quot;key&quot;:&quot;main&quot;');
    expect(res.body).toContain('src="/screen/zones/main"');
    // Regions and widgets in words (mockup 08), the hero open first, the layout's seconds shown.
    expect(res.body).toContain("Venue card");
    expect(res.body).toContain("Now and next → Countdown");
    expect(res.body).toContain('<option value="agenda_now">Now and next</option>');
    expect(res.body).not.toMatch(/>\s*(venue_rail|agenda_now|hot_game)\s*</);
    expect(res.body).toMatch(/data-pick="hero"[^>]*aria-pressed="true"/);
    expect(res.body).toContain('placeholder="15"');
    expect(res.body).toContain("studio-zone.js");
    expect((await page("/admin/screen/zones/nope", "zoner")).statusCode).toBe(404);
    const list = (await page("/admin/screen/zones", "zoner")).body;
    expect(list).toContain('href="/admin/screen/zones/main"');
  });

  it("shows the ticker line with its source and end, and offers Clear only for a person's line", async () => {
    expect((await page("/admin/screen/ticker", "ticker")).body).toContain("Nothing shows now.");
    await call(h, "PUT", "/api/screen/ticker", {
      session: "ticker",
      body: { text: "Pizza orders close at 20", until: null },
    });
    const body = (await page("/admin/screen/ticker", "ticker")).body;
    expect(body).toContain("Showing: Pizza orders close at 20");
    expect(body).toContain("Set in Studio · no end");
    expect(body).toContain('data-url="/api/screen/ticker"');
  });

  it("stays in English when admin cannot say the event's language", async () => {
    h.adminSettings.alpha = { language: "fi" };
    const res = await page("/admin/screen/live", "admin");
    expect(res.body).toContain("What every zone shows now.");
    expect(res.body).toContain('id="canccu-studio-text"');
  });

  it("serves its script and stylesheet, and nothing else under static", async () => {
    const js = await page("/admin/screen/static/studio.js");
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toContain("text/javascript");
    expect((await page("/admin/screen/static/ui.css")).statusCode).toBe(200);
    expect((await page("/admin/screen/static/constructor")).statusCode).toBe(404);
  });
});
