/**
 * The Screen studio's pages (#189): sign-in and rights per page and per action, the home by the
 * event's state, the pair dialog, the zone editor, the ticker and the page's headers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, SESSIONS, call, harness, pairDevice } from "./helpers.js";
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
    const viewer = (await page("/admin/screen/devices", "viewer")).body;
    expect(viewer).toContain("Hall left");
    expect(viewer).not.toContain("/commands");
    expect(viewer).not.toContain('id="canccu-studio-pair"');
  });

  it("draws the zone editor with the zone read, its layout's regions and a true preview", async () => {
    const res = await page("/admin/screen/zones/main", "zoner");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-region="hero"');
    expect(res.body).toContain('data-region="ticker"');
    expect(res.body).toContain('data-zone="{&quot;key&quot;:&quot;main&quot;');
    expect(res.body).toContain('src="/screen/zones/main"');
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
