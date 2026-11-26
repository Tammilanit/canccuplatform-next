/**
 * The hub QR takes turns (#787 D14, contracts/screen.md, Header and hub QR): `rotate` by default,
 * the venue rail turning with the hero, so the hub QR is on screen at least every 2:15.
 */
import { describe, expect, it } from "vitest";
import { buildRegions } from "../src/compose/build.js";
import type { BuildInput } from "../src/compose/build.js";
import type { ZoneFacts } from "../src/compose/widgets.js";
import { zoneInput } from "../src/zone-input.js";

const facts = (over: Partial<ZoneFacts> = {}): ZoneFacts => ({
  now: new Date("2026-03-14T18:10:00Z"),
  timeZone: "UTC",
  origin: "https://demo.example",
  eventName: "Demo Event",
  logoUrl: null,
  agenda: { current: [], next: [] },
  venue: {
    wifi: [{ ssid: "Demo-Guest", password: "pizza-time", note: null }],
    has_floor_plan: false,
  },
  ticker: { text: null, until: null, source: null },
  ...over,
});
const input = (hubQr: "always" | "rotate", f = facts()): BuildInput =>
  ({
    zone: { key: "main", layoutId: "pulse", regions: {}, hubQr, header: "separate" },
    windowLayoutId: null,
    themeLayouts: [],
    portrait: false,
    facts: f,
  }) as unknown as BuildInput;

const venueRails = (hubQr: "always" | "rotate", f?: ZoneFacts) =>
  buildRegions(input(hubQr, f)).regions.filter((r) => r.id.startsWith("venue_rail"));

describe("the hub QR's turns", () => {
  it("is `rotate` for a zone that does not say, and keeps an `always` it is given", () => {
    const zone = { key: "main", name: "Main hall", layout_id: "pulse", regions: {} };
    expect(zoneInput(zone).hub_qr).toBe("rotate");
    expect(zoneInput({ ...zone, hub_qr: "always" }).hub_qr).toBe("always");
  });

  it("puts the hub QR in the venue rail's turns, 45 s each, on screen once in each cycle", () => {
    const [rail, ...more] = venueRails("rotate");
    expect(more).toEqual([]);
    const shown = (rail?.order ?? []).map((i) => rail?.widgets[i]);
    expect(shown.map((w) => w?.widget)).toContain("qr");
    expect(shown.every((w) => w?.dwell_seconds === 45)).toBe(true);
    // Food, the Wi-Fi and the QR at most: a turn of the QR at least every 2:15.
    expect(shown.reduce((t, w) => t + (w?.dwell_seconds ?? 0), 0)).toBeLessThanOrEqual(135);
  });

  it("keeps the fixed QR card for a zone that chose `always`", () => {
    const parts = venueRails("always");
    expect(parts.length).toBe(2);
    expect(parts.some((p) => p.widgets.length === 1 && p.widgets[0]?.widget === "qr")).toBe(true);
  });
});
