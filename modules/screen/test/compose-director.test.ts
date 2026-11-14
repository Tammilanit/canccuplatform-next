import { describe, expect, it } from "vitest";
import { buildRegions, shownAt } from "../src/compose/build.js";
import type { BuildInput, RegionView } from "../src/compose/build.js";
import { directorOrder, jumpAt } from "../src/compose/director.js";
import type { ZoneFacts } from "../src/compose/widgets.js";
import { zoneInput } from "../src/zone-input.js";
import { shownAt as playerShownAt } from "../player/src/rotation.js";

// The Director (contracts/screen.md, The Director; design guideline sheet 13).
const NOW = Date.parse("2026-01-01T12:00:07Z");

function facts(): ZoneFacts {
  return {
    now: new Date(NOW),
    timeZone: "UTC",
    origin: "https://demo.example",
    eventName: "Demo Event",
    logoUrl: null,
    agenda: { current: [], next: [] },
    venue: null,
    ticker: { text: null, until: null, source: null },
  };
}

const input = (regions: Record<string, Record<string, unknown>> = {}): BuildInput => ({
  zone: { key: "main", layoutId: null, regions },
  windowLayoutId: null,
  themeLayouts: [],
  portrait: false,
  facts: facts(),
});

const regionOf = (regions: Record<string, Record<string, unknown>>, id: string): RegionView => {
  const found = buildRegions(input(regions)).regions.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no region ${id}`);
  return found;
};

const feature = (widget: string, view: Record<string, unknown> = {}, dwell = 10) => ({
  widget,
  dwell_seconds: dwell,
  view: { qr: null, stale: false, empty: false, ...view },
});

describe("the Director's settings", () => {
  it("rotates the hero by the Director unless the zone says otherwise; other regions in order", () => {
    expect(regionOf({}, "hero").rotation).toBe("director");
    expect(regionOf({}, "rail").rotation).toBe("sequence");
    expect(regionOf({ hero: { rotation: "sequence" } }, "hero").rotation).toBe("sequence");
    expect(regionOf({ rail: { rotation: "director" } }, "rail").rotation).toBe("director");
  });

  it("shows the turn as a thin line unless the zone picks the ring or none", () => {
    expect(regionOf({}, "hero").indicator).toBe("line");
    expect(regionOf({ hero: { indicator: "ring" } }, "hero").indicator).toBe("ring");
    expect(regionOf({ hero: { indicator: "off" } }, "hero").indicator).toBe("off");
    expect(regionOf({ hero: { indicator: "spin" } }, "hero").indicator).toBe("line");
  });

  it("takes the Director and the indicator as zone settings, and refuses another indicator", () => {
    const zone = (hero: Record<string, unknown>) => ({
      key: "main",
      name: "Main",
      regions: { hero },
    });
    expect(zoneInput(zone({ rotation: "director", indicator: "ring" })).regions.hero).toEqual({
      rotation: "director",
      indicator: "ring",
    });
    expect(() => zoneInput(zone({ indicator: "spin" }))).toThrow(/indicator/);
  });
});

describe("the Director's order", () => {
  it("puts the features in the sheet's order, the rest after them as placed", () => {
    const widgets = [
      "qr",
      "photo",
      "playlist",
      "hot_game",
      "countdown",
      "today_numbers",
      "bracket",
    ];
    const order = directorOrder(
      widgets.map((widget) => ({ widget })),
      [0, 1, 2, 3, 4, 5, 6],
    );
    expect(order.map((i) => widgets[i])).toEqual([
      "bracket",
      "countdown",
      "playlist",
      "photo",
      "hot_game",
      "today_numbers",
      "qr",
    ]);
  });

  it("keeps two entries of one type in their place order and leaves out what does not take part", () => {
    const widgets = [{ widget: "photo" }, { widget: "countdown" }, { widget: "photo" }];
    expect(directorOrder(widgets, [0, 2])).toEqual([0, 2]);
    expect(directorOrder(widgets, [2, 1, 0])).toEqual([1, 0, 2]);
  });
});

describe("queue jumps", () => {
  const since = new Date(NOW - 20_000).toISOString();

  it("gives a surging game the turn for the first minute of its surge", () => {
    const widgets = [feature("playlist"), feature("hot_game", { since })];
    expect(jumpAt(widgets, [0, 1], NOW)).toEqual({ index: 1, until: NOW + 40_000 });
    expect(jumpAt(widgets, [0, 1], NOW + 40_000)).toBeNull();
    expect(jumpAt(widgets, [0, 1], NOW - 30_000)).toBeNull();
  });

  it("gives a new photo the turn while it pops in large", () => {
    const until = new Date(NOW + 6000).toISOString();
    const widgets = [
      feature("playlist"),
      feature("photo", { featured: true, featured_until: until }),
    ];
    expect(jumpAt(widgets, [0, 1], NOW)).toEqual({ index: 1, until: NOW + 6000 });
    const still = [
      feature("playlist"),
      feature("photo", { featured: false, featured_until: null }),
    ];
    expect(jumpAt(still, [0, 1], NOW)).toBeNull();
  });

  it("lets the surge go first when both jump, and never a feature that takes no part", () => {
    const until = new Date(NOW + 6000).toISOString();
    const widgets = [
      feature("photo", { featured: true, featured_until: until }),
      feature("hot_game", { since }),
    ];
    expect(jumpAt(widgets, [0, 1], NOW)?.index).toBe(1);
    expect(jumpAt(widgets, [0], NOW)?.index).toBe(0);
  });

  it("plays the jump, then the rotation where the clock has it, on the server and the screen alike", () => {
    const region = {
      id: "hero",
      rotation: "director" as const,
      order: [0, 1, 2],
      widgets: [feature("countdown"), feature("playlist"), feature("hot_game", { since })],
    };
    expect(shownAt(region, "main", NOW)?.widget).toBe("hot_game");
    expect(playerShownAt(region, "main", NOW)).toEqual({
      index: 2,
      from: NOW - 20_000,
      until: NOW + 40_000,
    });
    for (let t = NOW; t < NOW + 120_000; t += 1000) {
      const server = shownAt(region, "main", t);
      const player = playerShownAt(region, "main", t);
      expect(player.index === null ? null : region.widgets[player.index]).toBe(server);
    }
    // After the minute: the rotation, epoch-anchored as `sequence` is.
    expect(shownAt(region, "main", NOW + 60_000)).toBe(
      shownAt({ ...region, rotation: "sequence" }, "main", NOW + 60_000),
    );
  });
});
