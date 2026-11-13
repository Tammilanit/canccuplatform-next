// A zone's box sizes and hidden boxes (contracts/screen.md, Box sizes and hidden boxes; #405).
import { describe, expect, it } from "vitest";
import { boxProblem, placedBoxes } from "../src/compose/boxes.js";
import { buildRegions } from "../src/compose/build.js";
import type { BuildInput, RegionView, ZoneSetup } from "../src/compose/build.js";
import { overrideOf, placeClaims } from "../src/compose/claims.js";
import { BUILT_IN_LAYOUTS } from "../src/compose/layouts.js";
import type { Area, Layout } from "../src/compose/layouts.js";
import type { ZoneFacts } from "../src/compose/widgets.js";

const facts: ZoneFacts = {
  now: new Date("2026-03-14T18:42:00Z"),
  timeZone: "UTC",
  origin: "https://demo.example",
  eventName: "Demo Event",
  logoUrl: null,
  agenda: { current: [], next: [] },
  venue: null,
  ticker: { text: null, until: null, source: null },
};

const at = (column: number, row: number, columns: number, rows: number): Area => ({
  column,
  row,
  columns,
  rows,
});
const layout = (id: string): Layout => BUILT_IN_LAYOUTS.find((l) => l.id === id) as Layout;

function build(zone: Partial<ZoneSetup> = {}, over: Partial<BuildInput> = {}): RegionView[] {
  return buildRegions({
    zone: { key: "main", layoutId: null, regions: {}, hubQr: "rotate", ...zone },
    windowLayoutId: null,
    themeLayouts: [],
    portrait: false,
    facts,
    ...over,
  }).regions.filter((r) => !r.id.startsWith("_"));
}
const areas = (regions: RegionView[]) => Object.fromEntries(regions.map((r) => [r.id, r.area]));

// The Pulse with its venue rail hidden and the rail grown into its space, as Studio saves it.
const GROWN = { venue_rail: { hidden: true }, rail: { area: at(9, 2, 4, 10) } };

describe("boxProblem", () => {
  it("accepts areas inside the grid that share no cell with a drawn box of their layer", () => {
    expect(boxProblem(layout("pulse"), GROWN)).toBeNull();
    expect(boxProblem(layout("pulse"), { hero: { area: at(1, 2, 6, 10) } })).toBeNull();
    // The ticker is on layer 1, so a box under it on layer 0 does not overlap it.
    expect(boxProblem(layout("pulse"), { hero: { area: at(1, 2, 8, 11) } })).toBeNull();
  });

  it("refuses an area off the grid", () => {
    for (const area of [at(12, 2, 2, 1), at(1, 12, 1, 2), at(13, 1, 1, 1)]) {
      expect(boxProblem(layout("pulse"), { hero: { area } }), JSON.stringify(area)).toMatch(
        /must fit the 12 × 12 grid/,
      );
    }
    expect(boxProblem(layout("pulse_portrait"), { hero: { area: at(1, 3, 7, 6) } })).toMatch(
      /6 × 16/,
    );
  });

  it("refuses an area that shares a cell with another drawn box of its layer", () => {
    expect(boxProblem(layout("pulse"), { rail: { area: at(9, 2, 4, 10) } })).toMatch(
      /`regions.rail` and `regions.venue_rail` must not overlap/,
    );
    expect(boxProblem(layout("pulse"), { hero: { area: at(1, 2, 9, 10) } })).toMatch(/overlap/);
  });

  it("checks nothing for regions the layout lacks, and allows the layout's own overlaps", () => {
    expect(boxProblem(layout("pulse"), { online: { area: at(1, 1, 12, 12) } })).toBeNull();
    const backdrop: Layout = {
      ...layout("hero"),
      regions: [...layout("hero").regions, { id: "glow", area: at(1, 1, 12, 12), widgets: [] }],
    };
    expect(boxProblem(backdrop, { rail: { idle: "next" } })).toBeNull();
    expect(boxProblem(backdrop, { rail: { area: at(1, 12, 6, 1) } })).toMatch(/overlap/);
  });
});

describe("placedBoxes", () => {
  it("applies the areas and leaves the hidden regions out, on the zone's own layout only", () => {
    const placed = placedBoxes(layout("pulse"), null, GROWN);
    expect(placed.map((r) => r.id)).toEqual(["header", "hero", "rail", "ticker"]);
    expect(placed.find((r) => r.id === "rail")?.area).toEqual(at(9, 2, 4, 10));
    expect(placedBoxes(layout("pulse_portrait"), null, GROWN)).toBe(
      layout("pulse_portrait").regions,
    );
    expect(placedBoxes(layout("pulse"), "split", GROWN)).toBe(layout("pulse").regions);
  });

  it("draws every region at the layout's area when the saved areas stop fitting", () => {
    const broken = { ...GROWN, venue_rail: {} };
    const placed = placedBoxes(layout("pulse"), "pulse", broken);
    expect(placed).toEqual(layout("pulse").regions);
    const hiddenToo = { hero: { hidden: true }, rail: { area: at(9, 2, 4, 10) } };
    expect(placedBoxes(layout("pulse"), null, hiddenToo).map((r) => r.area)).toEqual(
      layout("pulse")
        .regions.filter((r) => r.id !== "hero")
        .map((r) => r.area),
    );
  });
});

describe("the composed state", () => {
  it("draws the zone's boxes, before the parts split the header", () => {
    expect(areas(build({ regions: GROWN }))).toEqual({
      header: at(1, 1, 6, 1),
      "header-2": at(7, 1, 6, 1),
      hero: at(1, 2, 8, 10),
      rail: at(9, 2, 4, 10),
      ticker: at(1, 12, 12, 1),
    });
    const wide = build({ regions: { header: { area: at(1, 1, 8, 1) } } });
    expect(areas(wide)).toMatchObject({ header: at(1, 1, 4, 1), "header-2": at(5, 1, 4, 1) });
  });

  it("leaves the boxes to a schedule window's layout and a null zone's portrait", () => {
    const window = build({ regions: GROWN }, { windowLayoutId: "split" });
    expect(areas(window)).toEqual(areas(build({ layoutId: "split" })));
    const portrait = build({ regions: GROWN }, { portrait: true });
    expect(areas(portrait)).toEqual(areas(build({}, { portrait: true })));
  });

  it("makes the first drawn hero region the hero, and trades and grows after the boxes", () => {
    const dashboard = { layoutId: "dashboard", heroRegion: "online" };
    const resized = { voice: { area: at(9, 2, 4, 4) } };
    expect(areas(build({ ...dashboard, regions: resized }))).toMatchObject({
      hero: at(5, 2, 4, 5),
      online: at(1, 2, 4, 5),
      voice: at(9, 2, 4, 4),
    });
    const hidden = build({ layoutId: "dashboard", regions: { hero: { hidden: true } } });
    expect(hidden.some((r) => r.role === "hero")).toBe(false);
    const grown = build(
      { layoutId: "dashboard", regions: { online: { hidden: true } } },
      {
        grow: true,
      },
    );
    expect(areas(grown)).toMatchObject({ hero: at(1, 2, 8, 10), voice: at(9, 2, 4, 3) });
  });

  it("offers a hidden region's role to no claim: the claim takes the next role of its chain", () => {
    const claim = overrideOf({
      id: "ov_1",
      kind: "block",
      zones: [],
      rank: 50,
      regions: ["rail", "hero"],
      source: { module: "moments", event_id: null, ref: null },
      template: "announcement",
      content: { title: "Spotlight", body: "", level: "info" },
      starts_at: "2026-03-14T18:40:00Z",
      ends_at: null,
    });
    if (claim === null) throw new Error("the override is malformed");
    const placed = placeClaims(
      buildRegions({
        zone: { key: "main", layoutId: null, regions: { rail: { hidden: true } } },
        windowLayoutId: null,
        themeLayouts: [],
        portrait: false,
        facts,
      }).regions,
      [claim],
    );
    expect(placed.regions.find((r) => r.claim !== null)?.id).toBe("hero");
  });
});
