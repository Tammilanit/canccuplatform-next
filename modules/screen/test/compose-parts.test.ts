// The zone options `header` and `hub_qr` (contracts/screen.md, Header and hub QR): split regions
// are drawn as parts side by side, each a region of its own in the composed state.
import { describe, expect, it } from "vitest";
import { buildRegions } from "../src/compose/build.js";
import type { BuildInput, RegionView, ZoneSetup } from "../src/compose/build.js";
import { themeLayouts } from "../src/compose/layouts.js";
import type { Layout, LayoutRegion } from "../src/compose/layouts.js";
import { zoneFingerprint } from "../src/compose/state.js";
import type { ZoneFacts } from "../src/compose/widgets.js";

const NOW = new Date("2026-01-01T12:00:07Z");

const facts: ZoneFacts = {
  now: NOW,
  timeZone: "Europe/Helsinki",
  origin: "https://demo.example",
  eventName: "Demo Event",
  logoUrl: null,
  agenda: { current: [], next: [] },
  venue: null,
  ticker: { text: null, until: null, source: null },
};

function build(zone: Partial<ZoneSetup> = {}, over: Partial<BuildInput> = {}): RegionView[] {
  return buildRegions({
    zone: { key: "main", layoutId: null, regions: {}, ...zone },
    windowLayoutId: null,
    themeLayouts: [],
    portrait: false,
    facts,
    ...over,
  }).regions;
}

const HUB_QR = { widget: "qr", props: { url: "/notify/", label: "The event hub" } };

/** id, role, area as (column, row, columns, rows), and the widget types, of the layout's regions. */
const shape = (regions: RegionView[]) =>
  regions
    .filter((r) => !r.id.startsWith("_"))
    .map((r) => [
      r.id,
      r.role,
      [r.area.column, r.area.row, r.area.columns, r.area.rows],
      r.widgets.map((w) => w.widget),
    ]);

const stage = (regions: LayoutRegion[], header?: "separate" | "shared"): Layout => ({
  id: "stage",
  name: "Stage",
  aspect: "16:9",
  grid: { columns: 12, rows: 12 },
  regions,
  ...(header === undefined ? {} : { header }),
});
const at = (column: number, columns: number) => ({ column, row: 1, columns, rows: 1 });
const w = (...types: string[]) => types.map((widget) => ({ widget }));

describe("header", () => {
  it("draws the logo and the clock side by side by default (`separate`)", () => {
    expect(shape(build()).slice(0, 2)).toEqual([
      ["header", "header", [1, 1, 6, 1], ["logo"]],
      ["header-2", "header", [7, 1, 6, 1], ["clock"]],
    ]);
    expect(shape(build({ header: "separate" })).slice(0, 2)).toEqual(shape(build()).slice(0, 2));
  });

  it("splits the portrait built-in's header too", () => {
    expect(shape(build({}, { portrait: true })).slice(0, 2)).toEqual([
      ["header", "header", [1, 1, 3, 2], ["logo"]],
      ["header-2", "header", [4, 1, 3, 2], ["clock"]],
    ]);
  });

  it("keeps the old rotating header with `shared`", () => {
    const regions = build({ header: "shared" });
    expect(shape(regions)[0]).toEqual(["header", "header", [1, 1, 12, 1], ["logo", "clock"]]);
    expect(regions.map((r) => r.id)).not.toContain("header-2");
  });

  it("leaves the layout as the built-in has it: only `regions` shows the parts", () => {
    const { layout } = buildRegions({
      zone: { key: "main", layoutId: null, regions: {} },
      windowLayoutId: null,
      themeLayouts: [],
      portrait: false,
      facts,
    });
    expect(layout.regions.map((r) => r.id)).toEqual([
      "header",
      "hero",
      "rail",
      "venue_rail",
      "ticker",
    ]);
  });

  it("takes a theme layout's default until the zone sets its own", () => {
    const layout = stage(
      [{ id: "header", area: at(1, 12), widgets: w("logo", "clock") }],
      "shared",
    );
    const ids = (header?: "separate" | "shared" | null) =>
      build(
        { layoutId: "stage", ...(header === undefined ? {} : { header }) },
        {
          themeLayouts: [layout],
        },
      ).map((r) => r.id);
    expect(ids()).not.toContain("header-2");
    expect(ids(null)).not.toContain("header-2");
    expect(ids("separate")).toContain("header-2");
    expect(themeLayouts([{ ...layout, header: "sideways" }])[0]?.header).toBeUndefined();
    expect(themeLayouts([layout])[0]?.header).toBe("shared");
  });

  it("splits any region whose role is header, in the zone's widget order, one column more on the left", () => {
    const layout = stage([{ id: "top", area: at(1, 5), widgets: w("logo") }]);
    const regions = build(
      {
        layoutId: "stage",
        regions: {
          top: { role: "header", widgets: w("clock", "logo", "countdown"), dwell_seconds: 30 },
        },
      },
      { themeLayouts: [layout] },
    );
    expect(shape(regions)).toEqual([
      ["top", "header", [1, 1, 2, 1], ["clock"]],
      ["top-2", "header", [3, 1, 2, 1], ["logo"]],
      ["top-3", "header", [5, 1, 1, 1], ["countdown"]],
    ]);
    expect(regions.find((r) => r.id === "top-3")?.widgets[0]?.dwell_seconds).toBe(30);
  });

  it("does not split a header with one widget, too few columns, or part ids that clash or are too long", () => {
    const long = `h${"x".repeat(30)}`;
    const cases: Layout[] = [
      stage([{ id: "header", area: at(1, 12), widgets: w("logo") }]),
      stage([{ id: "header", area: at(1, 1), widgets: w("logo", "clock") }]),
      stage([
        { id: "header", area: at(1, 6), widgets: w("logo", "clock") },
        { id: "header-2", area: at(7, 6), widgets: w("countdown") },
      ]),
      stage([{ id: long, area: at(1, 12), widgets: w("logo", "clock") }]),
    ];
    const settings = { [long]: { role: "header" } };
    for (const layout of cases) {
      const regions = build(
        { layoutId: "stage", regions: settings },
        { themeLayouts: [layout] },
      ).filter((r) => !r.id.startsWith("_"));
      expect(regions.map((r) => r.id)).toEqual(layout.regions.map((r) => r.id));
      expect(regions[0]?.widgets).toHaveLength(layout.regions[0]?.widgets.length ?? 0);
    }
  });
});

describe("hub_qr", () => {
  it("gives the hub QR a fixed place at the venue rail's right edge by default (`always`)", () => {
    const regions = build();
    expect(shape(regions).filter(([id]) => String(id).startsWith("venue_rail"))).toEqual([
      ["venue_rail", "venue_rail", [9, 8, 2, 4], ["venue_info", "food_status"]],
      ["venue_rail-2", null, [11, 8, 2, 4], ["qr"]],
    ]);
    expect(shape(build({ hubQr: "always" }))).toEqual(shape(regions));
    const qr = regions.find((r) => r.id === "venue_rail-2");
    expect(qr?.order).toEqual([0]);
    expect(qr?.widgets[0]?.view).toMatchObject({ url: "https://demo.example/notify/" });
  });

  it("keeps the hub QR in the venue rail's rotation with `rotate`", () => {
    const regions = build({ hubQr: "rotate" });
    expect(shape(regions).filter(([id]) => String(id).startsWith("venue_rail"))).toEqual([
      ["venue_rail", "venue_rail", [9, 8, 4, 4], ["qr", "venue_info", "food_status"]],
    ]);
  });

  it("splits the portrait built-in's venue rail as the Pulse's", () => {
    const portrait = (hubQr: "always" | "rotate") =>
      shape(build({ hubQr }, { portrait: true })).filter(([id]) =>
        String(id).startsWith("venue_rail"),
      );
    expect(portrait("always")).toEqual([
      ["venue_rail", "venue_rail", [1, 14, 3, 2], ["venue_info", "food_status"]],
      ["venue_rail-2", null, [4, 14, 3, 2], ["qr"]],
    ]);
    expect(portrait("rotate")).toEqual([
      ["venue_rail", "venue_rail", [1, 14, 6, 2], ["qr", "venue_info", "food_status"]],
    ]);
  });

  it("gives the hub QR's part the region's settings but no role", () => {
    const regions = build({
      regions: { venue_rail: { rotation: "shuffle", dwell_seconds: 40, idle: "blank" } },
    });
    const qr = regions.find((r) => r.id === "venue_rail-2");
    expect(qr).toMatchObject({ role: null, rotation: "shuffle", idle: "blank" });
    expect(qr?.widgets[0]?.dwell_seconds).toBe(40);
  });

  it("splits only a region that lists the hub QR beside other widgets, and never a header", () => {
    const layout = stage([
      { id: "header", area: at(1, 4), widgets: [{ widget: "logo" }, HUB_QR] },
      { id: "corner", area: at(5, 4), widgets: [HUB_QR] },
      { id: "side", area: at(9, 4), widgets: [{ widget: "qr", props: { url: "/other/" } }] },
    ]);
    const regions = build({ layoutId: "stage", header: "shared" }, { themeLayouts: [layout] });
    expect(shape(regions).map(([id]) => id)).toEqual(["header", "corner", "side"]);
  });

  it("names the hub QR's part only by the hub QR: a header split leaves it with no role", () => {
    const layout = stage([
      { id: "header", area: at(1, 12), widgets: [{ widget: "logo" }, HUB_QR] },
    ]);
    expect(shape(build({ layoutId: "stage" }, { themeLayouts: [layout] }))).toEqual([
      ["header", "header", [1, 1, 6, 1], ["logo"]],
      ["header-2", null, [7, 1, 6, 1], ["qr"]],
    ]);
  });
});

describe("the fingerprint", () => {
  const zone = {
    key: "main",
    name: "Main",
    layout_id: null,
    regions: {},
    header: null,
    hub_qr: "always" as const,
    hero_region: null,
    grow_for_showcase: true,
    sound: { enabled: true, device_id: null },
    epoch: "e1",
  };
  const print = (over: Record<string, unknown>) =>
    zoneFingerprint({
      zone: { ...zone, ...over },
      windowLayoutId: null,
      theme: { revision: 1, layouts: [] },
      facts,
    });

  it("moves with either option, so `state_version` does", () => {
    const base = print({});
    expect(print({ header: "shared" })).not.toBe(base);
    expect(print({ header: "separate" })).not.toBe(base);
    expect(print({ hub_qr: "rotate" })).not.toBe(base);
  });
});
