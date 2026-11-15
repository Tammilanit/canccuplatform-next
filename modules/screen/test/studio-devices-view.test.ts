/**
 * The Devices page's words for an outage and its "Shows" choice (#539): an outage from another day
 * names that day, and a screen that mirrors one without a zone keeps that mirror as its choice.
 */
import { describe, expect, it } from "vitest";
import { devicesView } from "../src/studio/devices-view.js";
import type { SeenDevice } from "../src/studio/help.js";
import { translator } from "../src/studio/messages.js";
import type { ViewContext } from "../src/studio/views.js";

// Sun 15 Nov 2026, 12:00 in Helsinki (UTC+2).
const NOW = Date.parse("2026-11-15T10:00:00Z");
const c: ViewContext = {
  t: translator("en"),
  rights: new Set(["screen.devices.read", "screen.devices.write"]),
  nowMs: NOW,
  timeZone: "Europe/Helsinki",
  startUrl: null,
};
const zones = [{ key: "main", name: "Main", layout_id: null }];

const offline = (id: string, lastSeen: string): SeenDevice => ({
  id,
  name: id,
  zone_key: "main",
  mirror_of: null,
  health: { online: false, last_seen_at: lastSeen },
});
const draw = (devices: SeenDevice[]) => devicesView(c, zones, devices, new Map()).toString();

describe("an offline screen", () => {
  it("says only the time for an outage that began today", () => {
    const page = draw([offline("d_a", "2026-11-15T07:05:00Z")]);
    expect(page).toContain("offline since 09:05");
  });

  it("names the day of an outage that began on another day", () => {
    const page = draw([offline("d_a", "2026-11-14T21:40:00Z")]);
    expect(page).toContain("offline since Sat 14 Nov 23:40");
    expect(page).toContain("is offline since Sat 14 Nov 23:40");
  });
});

describe("the Shows choice", () => {
  it("keeps the screen a device mirrors when that screen has no zone", () => {
    const target: SeenDevice = {
      id: "d_t",
      name: "Lobby",
      zone_key: null,
      mirror_of: { zone_key: "main" },
    };
    const mirror: SeenDevice = {
      id: "d_m",
      name: "Bar",
      zone_key: null,
      mirror_of: { device_id: "d_t" },
    };
    const page = draw([target, mirror]);
    const select = /id="canccu-studio-d_m-shows"[^>]*>(.*?)<\/select>/s.exec(page)?.[1] ?? "";
    expect(select).toMatch(/<option value="device:d_t" selected>[^<]*Lobby[^<]*<\/option>/);
  });
});
