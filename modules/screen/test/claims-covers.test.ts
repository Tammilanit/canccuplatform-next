/**
 * One place at a time (#787 D7, contracts/screen.md, Moments drive it: claims): while a claim
 * is drawn, the widgets it `covers` leave the zone's other regions, as empty ones do.
 */
import { describe, expect, it } from "vitest";
import type { RegionView } from "../src/compose/build.js";
import { overrideOf, placeClaims } from "../src/compose/claims.js";
import type { Override } from "../src/compose/claims.js";

const widget = (type: string) => ({
  widget: type,
  template: null,
  embed: null,
  dwell_seconds: 45,
  stale_after_seconds: null,
  view: { qr: null, stale: false, empty: false },
});

function region(id: string, role: RegionView["role"], types: string[] = []): RegionView {
  return {
    id,
    role,
    area: { column: 1, row: 1, columns: 1, rows: 1 },
    layer: 0,
    rotation: "sequence",
    order: types.map((_, i) => i),
    indicator: "line",
    cycle_started_at: "2026-01-01T18:00:00.000Z",
    idle: "logo",
    idle_view: null,
    widgets: types.map(widget),
    claim: null,
  } as RegionView;
}

const PULSE = [
  region("hero", "hero", ["countdown", "food_status"]),
  region("rail", "rail", ["agenda_now"]),
  region("venue_rail", "venue_rail", ["qr", "venue_info", "food_status"]),
  region("ticker", "ticker", ["ticker"]),
];

function override(id: string, over: Record<string, unknown> = {}): Override {
  const parsed = overrideOf({
    id,
    kind: "block",
    zones: [],
    rank: 80,
    template: "pizza_placed",
    content: { title: "Pizza order open", seq: 7 },
    starts_at: "2026-01-01T18:00:00Z",
    ends_at: null,
    regions: ["hero", "venue_rail", "ticker"],
    covers: ["food_status"],
    ...over,
  });
  if (parsed === null) throw new Error(`fixture ${id} does not parse`);
  return parsed;
}

const emptied = (regions: RegionView[]) =>
  Object.fromEntries(
    regions.map((r) => [r.id, r.widgets.filter((w) => w.view.empty).map((w) => w.widget)]),
  );

describe("a claim's covers", () => {
  it("reads `covers`, absent as none, and refuses one that is not a list of types", () => {
    expect(override("a").covers).toEqual(["food_status"]);
    expect(override("b", { covers: undefined }).covers).toEqual([]);
    expect(overrideOf({ ...override("c"), covers: "food_status" })).toBeNull();
  });

  it("leaves the covered widgets out of the other regions while the claim holds the hero", () => {
    const placed = placeClaims(PULSE, [override("open")]);
    expect(placed.placed).toEqual([{ override_id: "open", role: "hero" }]);
    expect(emptied(placed.regions)).toEqual({
      hero: [],
      rail: [],
      venue_rail: ["food_status"],
      ticker: [],
    });
    expect(placed.regions.find((r) => r.id === "venue_rail")?.order).toEqual([0, 1]);
  });

  it("leaves them out of the hero's rotation once the claim has stepped down to the food box", () => {
    const down = override("down", { regions: ["venue_rail", "ticker"] });
    const placed = placeClaims(PULSE, [down]);
    expect(placed.placed).toEqual([{ override_id: "down", role: "venue_rail" }]);
    expect(emptied(placed.regions)).toEqual({
      hero: ["food_status"],
      rail: [],
      venue_rail: [],
      ticker: [],
    });
  });
});
