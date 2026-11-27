/**
 * While the hero shows a QR, only the hub QR leaves its turn, and only where it takes turns
 * (#787 D14, contracts/screen.md): the `always` split's part of nothing but the QR keeps it.
 */
import { describe, expect, it } from "vitest";
import { joinedShown, turnShown } from "../player/src/turns.js";
import type { Choice } from "../player/src/turns.js";
import type { Region, ScreenState } from "../player/src/state.js";

const hubUrl = "https://demo.example/notify/";
const hub = {
  widget: "qr",
  dwell_seconds: 45,
  view: { url: hubUrl, label: "", image_url: "data:hub", qr: null, stale: false, empty: false },
};
const other = { ...hub, view: { ...hub.view, url: "https://demo.example/other/" } };
const wifi = {
  widget: "wifi",
  dwell_seconds: 45,
  view: { wifi: [{ ssid: "A", password: "b" }], qr: null, stale: false, empty: false },
};
const region = (id: string, role: string | null, widgets: unknown[]): Region =>
  ({
    id,
    role,
    area: { x: 0, y: 0, w: 1, h: 1 },
    layer: 0,
    rotation: "sequence",
    order: widgets.map((_, i) => i),
    cycle_started_at: "2026-03-14T18:00:00Z",
    idle: "none",
    idle_view: null,
    widgets,
    claim: null,
  }) as unknown as Region;
const state = { tenant: { time_zone: "UTC" } } as unknown as ScreenState;
const now = Date.parse("2026-03-14T18:00:10Z");
const heroChoice = {
  key: "claim:j",
  type: "moment",
  template: null,
  view: { qr: null, join: { image_url: "data:j" }, stale: false, empty: false },
} as unknown as Choice;

/** The type the rail box shows at its first turn, the hero showing a QR. */
function railShows(rail: Region, at: number): string | undefined {
  const hero = region("hero", "hero", [wifi]);
  const regions = [hero, rail];
  const choices = [heroChoice, turnShown(rail, at, state, now) ?? null];
  const shown = joinedShown(regions, choices, state, now)[1];
  return typeof shown === "object" && shown !== null ? shown.type : undefined;
}

describe("one QR at a time", () => {
  it("skips the hub QR's turn where it takes turns, to the next item", () => {
    expect(railShows(region("rail", "rail", [wifi, hub]), 1)).toBe("wifi");
  });

  it("keeps the fixed hub QR of an `always` part that holds nothing else", () => {
    expect(railShows(region("venue_rail-2", "rail", [hub]), 0)).toBe("qr");
  });

  it("leaves another qr widget alone", () => {
    expect(railShows(region("rail", "rail", [wifi, other]), 1)).toBe("qr");
  });
});
