// @vitest-environment happy-dom
// The slideshow in the hero (#787 D6a, sheet 01): every second run clean; on the others a lower
// third for an open order, food on the way or the next item within 15 minutes, 15 s at a slide
// change, at most twice a run; and the food box leaves the venue rail while it shows food.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lowerThirdAt } from "../src/lower-third.js";
import { Screen } from "../src/screen.js";
import type { Region, ScreenState, WidgetState } from "../src/state.js";
import { screenState } from "./fake.js";

// The epoch's minute 0 of an even two-minute cycle: run 0 (clean) starts here, run 1 at +120 s.
const T0 = Date.parse("2026-03-14T18:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const widget = (type: string, view: Record<string, unknown>, dwell = 60): WidgetState => ({
  widget: type,
  template: null,
  dwell_seconds: dwell,
  view: { qr: null, stale: false, empty: false, ...view },
});
const slide = (startsAt: number) => ({
  kind: "image",
  url: `/api/screen/files/${String(startsAt)}.png`,
  slide_urls: [],
  started_at: iso(startsAt),
  offset_seconds: 0,
  duration_seconds: 10,
  muted: true,
});

function region(id: string, over: Partial<Region> = {}): Region {
  return {
    id,
    role: id,
    area: { column: 1, row: 1, columns: 6, rows: 6 },
    layer: 0,
    rotation: "sequence",
    order: [0],
    cycle_started_at: iso(T0),
    idle: "logo",
    idle_view: null,
    widgets: [],
    claim: null,
    ...over,
  };
}

const hero = (startsAt: number) =>
  region("hero", {
    rotation: "director",
    order: [0, 1],
    widgets: [widget("playlist", { item: slide(startsAt), next_item: null }), widget("ticker", { text: "h" })],
  }); // prettier-ignore
const openOrder = {
  title: "Food",
  orders: [{ state: "open", pizzeria_name: "Demo Pizzeria", status_text: "Open · closes 18:30" }],
  countdown_at: iso(T0 + 30 * 60_000),
  join: { url: "https://demo.example/pizza/orders/po_1", label: "Join the order", image_url: "data:image/svg+xml;base64,AA==" },
}; // prettier-ignore
const venue = (food: Record<string, unknown> | null) =>
  region("venue_rail", {
    order: food === null ? [0] : [0, 1],
    widgets: [
      ...(food === null ? [] : [widget("food_status", food, 5)]),
      widget("venue_info", { wifi: [{ ssid: "Demo", password: null, note: null }] }, 5),
    ],
  });
const rail = (startsAt: number) =>
  region("rail", {
    widgets: [
      widget("agenda_now", {
        items: [
          { name: "Semi-finals", state: "next", starts_at: iso(startsAt), starts_text: "18:12" },
        ],
      }),
    ],
  });

const state = (regions: Region[]): ScreenState =>
  screenState({
    layout: { id: "pulse", aspect: "16:9", grid: { columns: 12, rows: 12 } },
    regions,
    display: { motion: "none", drift: false },
  });

// The hero draws the rotation's own turn: the slideshow's, index 0, in these runs.
const at = (regions: Region[], ms: number, drawn: number | null = 0) =>
  lowerThirdAt(regions[0] as Region, state(regions), ms, drawn);

describe("the lower third over the slideshow", () => {
  it("leaves every second run clean, from its first slide to its last", () => {
    expect(at([hero(T0), venue(openOrder)], T0 + 5_000)).toBeNull();
    expect(at([hero(T0 + 120_000), venue(openOrder)], T0 + 125_000)).toMatchObject({
      kind: "food_open",
    });
  });

  it("shows an open order with its countdown and QR for 15 s from a slide change", () => {
    const third = at([hero(T0 + 120_000), venue(openOrder)], T0 + 121_000);
    expect(third).toEqual({
      kind: "food_open",
      title: "Pizza order open",
      text: "Demo Pizzeria",
      countdown_at: iso(T0 + 30 * 60_000),
      qr_image_url: "data:image/svg+xml;base64,AA==",
    });
    expect(at([hero(T0 + 120_000), venue(openOrder)], T0 + 135_000)).toBeNull();
  });

  it("comes at most twice a run: at the first slide and at the first after its middle", () => {
    const run = (start: number, now: number) => at([hero(start), venue(openOrder)], now);
    expect(run(T0 + 130_000, T0 + 131_000)).toBeNull();
    expect(run(T0 + 150_000, T0 + 151_000)).not.toBeNull();
    expect(run(T0 + 160_000, T0 + 161_000)).toBeNull();
  });

  it("says food on the way with its estimate", () => {
    const placed = { ...openOrder, join: null, countdown_at: iso(T0 + 40 * 60_000), orders: [{ state: "placed", pizzeria_name: "Demo Pizzeria" }] }; // prettier-ignore
    expect(at([hero(T0 + 120_000), venue(placed)], T0 + 121_000)).toEqual({
      kind: "food_placed",
      title: "Pizza on the way",
      text: "Demo Pizzeria",
      countdown_at: iso(T0 + 40 * 60_000),
      qr_image_url: null,
    });
  });

  it("names the next item only when it starts within 15 minutes, and nothing else", () => {
    const soon = at([hero(T0 + 120_000), venue(null), rail(T0 + 12 * 60_000)], T0 + 121_000);
    expect(soon).toEqual({
      kind: "next",
      title: "Next: Semi-finals",
      text: "18:12",
      countdown_at: iso(T0 + 12 * 60_000),
      qr_image_url: null,
    });
    expect(at([hero(T0 + 120_000), venue(null), rail(T0 + 30 * 60_000)], T0 + 121_000)).toBeNull();
  });

  it("names a delayed next item as it names a next one", () => {
    const late = rail(T0 + 12 * 60_000);
    const row = (late.widgets[0]?.view.items as Record<string, unknown>[])[0];
    if (row !== undefined) row.state = "delayed";
    expect(at([hero(T0 + 120_000), venue(null), late], T0 + 121_000)).toMatchObject({
      kind: "next",
      title: "Next: Semi-finals",
    });
  });

  it("says nothing of a switched-off food item", () => {
    const v = venue(openOrder);
    const food = v.widgets[0];
    if (food !== undefined) food.enabled = false;
    expect(at([hero(T0 + 120_000), v], T0 + 121_000)).toBeNull();
    expect(at([hero(T0 + 120_000), v, rail(T0 + 12 * 60_000)], T0 + 121_000)).toMatchObject({
      kind: "next",
    });
  });

  it("lies only over the slideshow's turn the hero draws, not a turn shown in its place", () => {
    expect(at([hero(T0 + 120_000), venue(openOrder)], T0 + 121_000, 1)).toBeNull();
    expect(at([hero(T0 + 120_000), venue(openOrder)], T0 + 121_000, null)).toBeNull();
  });
});

describe("the lower third on the screen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 + 121_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lays a band at the hero's foot and leaves the food box out of the venue rail meanwhile", () => {
    const screen = new Screen({ serverNow: () => Date.now(), reducedMotion: () => false });
    const root = screen.draw(state([hero(T0 + 120_000), venue(openOrder)]));
    const band = root.querySelector(".canccu-region--hero > .canccu-lower-third");
    expect(band?.textContent).toContain("Pizza order open");
    expect(band?.querySelector("img")?.getAttribute("src")).toBe("data:image/svg+xml;base64,AA==");
    const venueShows = root.querySelector(
      ".canccu-region--venue_rail > .canccu-widget.canccu-is-active",
    );
    expect(venueShows?.classList.contains("canccu-widget--venue_info")).toBe(true);
    vi.setSystemTime(T0 + 140_000);
    screen.tick();
    expect(root.querySelector(".canccu-region--hero > .canccu-lower-third")).toBeNull();
  });

  it("lays none when a claim's `next` skips the rest of the slideshow's turn", () => {
    const screen = new Screen({ serverNow: () => Date.now(), reducedMotion: () => false });
    const claimed = hero(T0 + 120_000);
    claimed.claim = {
      override_id: "ov_1",
      hidden: false,
      role: "hero",
      rank: 1,
      template: "announcement",
      content: { title: "Dinner is served", body: "Café", level: "info" },
      steps: null,
      sound: null,
      on_end: "next",
      starts_at: iso(T0 + 60_000),
      ends_at: iso(T0 + 600_000),
      expires_at: null,
    };
    screen.draw(state([claimed, venue(openOrder)]));
    // The state drops the claim mid-turn: the hero shows the turn after the slideshow's.
    const root = screen.draw(state([hero(T0 + 120_000), venue(openOrder)]));
    screen.tick();
    const hero_ = root.querySelector(".canccu-region--hero");
    expect(hero_?.querySelector(".canccu-widget--playlist.canccu-is-active")).toBeNull();
    expect(hero_?.querySelector(".canccu-widget--ticker.canccu-is-active")).not.toBeNull();
    expect(root.querySelector(".canccu-lower-third")).toBeNull();
  });

  it("lays the band again when a redraw took it out of the hero", () => {
    const screen = new Screen({ serverNow: () => Date.now(), reducedMotion: () => false });
    const root = screen.draw(state([hero(T0 + 120_000), venue(openOrder)]));
    root.querySelector(".canccu-lower-third")?.remove();
    screen.tick();
    expect(root.querySelector(".canccu-region--hero > .canccu-lower-third")).not.toBeNull();
  });
});
