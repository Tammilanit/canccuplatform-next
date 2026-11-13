/**
 * An archived event's Studio is read-only (docs/design/mockups.html, sheets 2 and 8; #439): the
 * pages still show what is there, every action that changes something is absent, not disabled,
 * and one line says why. The API refuses the changes anyway (`event_archived`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Event } from "@canccu/kit";
import { DATABASE_URL, TENANTS, call, context, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

const WHY = "The event is archived, so nothing in the Screen studio can be changed.";

describe.skipIf(!DATABASE_URL)("an archived event's Studio", () => {
  let h: Harness;
  const status = (s: "live" | "archived") => {
    TENANTS["beta.test"] = context("beta", { status: s });
    h.tenants.handleEvent({ source: "tenants", tenant: "beta" } as Event);
  };
  beforeAll(async () => {
    h = await harness();
    // A zone made while the event ran, then the event archived.
    const body = { key: "hall", name: "Hall" };
    await call(h, "POST", "/api/screen/zones", { host: "beta.test", session: "admin", body });
    status("archived");
  });
  afterAll(async () => {
    status("live");
    await h.close();
  });

  const page = async (url: string, host = "beta.test") =>
    (await call(h, "GET", url, { host, session: "admin" })).body;

  it("says why once and offers no change on any tab", async () => {
    const live = await page("/admin/screen/live");
    const devices = await page("/admin/screen/devices");
    const zones = await page("/admin/screen/zones");
    const zone = await page("/admin/screen/zones/hall");
    const ticker = await page("/admin/screen/ticker");
    const content = await page("/admin/screen/content");
    for (const body of [live, devices, zones, zone, ticker, content]) {
      expect(body.split(WHY)).toHaveLength(2);
    }
    expect(live).not.toContain("#pair=");
    expect(devices).not.toContain('id="canccu-studio-pair"');
    expect(zones).not.toContain("data-new-zone");
    expect(zones).toContain('href="/admin/screen/zones/hall"');
    expect(zone).not.toContain("data-save");
    expect(zone).not.toContain('data-call="DELETE"');
    expect(zone).toContain('src="/screen/zones/hall"');
    expect(ticker).not.toContain("data-ticker");
    expect(ticker).toContain('data-live="ticker-now"');
    expect(content).not.toContain('data-call="POST"');
  });

  it("changes nothing for a live event", async () => {
    const zones = await page("/admin/screen/zones", "alpha.test");
    expect(zones).not.toContain(WHY);
    expect(zones).toContain("data-new-zone");
  });
});
