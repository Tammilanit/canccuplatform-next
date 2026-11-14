// The six built-in layouts, the hero role and the showcase (contracts/screen.md, Built-in layouts
// and The hero role and the showcase; #401, #404), and `agenda_now`'s `later` (#397).
import { describe, expect, it } from "vitest";
import { buildRegions } from "../src/compose/build.js";
import type { BuildInput, RegionView, ZoneSetup } from "../src/compose/build.js";
import { overrideOf, placeClaims } from "../src/compose/claims.js";
import type { Override } from "../src/compose/claims.js";
import { BUILT_IN_LAYOUTS } from "../src/compose/layouts.js";
import type { Area } from "../src/compose/layouts.js";
import { isShowcase } from "../src/compose/showcase.js";
import { viewOf } from "../src/compose/widgets.js";
import type { AgendaItem, ZoneFacts } from "../src/compose/widgets.js";

const NOW = new Date("2026-03-14T18:42:00Z");

const facts: ZoneFacts = {
  now: NOW,
  timeZone: "UTC",
  origin: "https://demo.example",
  eventName: "Demo Event",
  logoUrl: null,
  agenda: { current: [], next: [] },
  venue: null,
  ticker: { text: null, until: null, source: null },
};

function build(zone: Partial<ZoneSetup> = {}, over: Partial<BuildInput> = {}): RegionView[] {
  return buildRegions({
    zone: { key: "main", layoutId: "dashboard", regions: {}, ...zone },
    windowLayoutId: null,
    themeLayouts: [],
    portrait: false,
    facts,
    ...over,
  }).regions.filter((r) => !r.id.startsWith("_"));
}

/**
 * Dashboard's statistics boxes kept drawn: their source is not on main yet (#389), so with the
 * default idle they would leave the composed state (compose-waiting.test.ts).
 */
const DRAWN = Object.fromEntries(
  ["online", "voice", "top_games", "right_now"].map((id) => [id, { idle: "blank" }]),
);

const at = (column: number, row: number, columns: number, rows: number): Area => ({
  column,
  row,
  columns,
  rows,
});
const areas = (regions: RegionView[]) => Object.fromEntries(regions.map((r) => [r.id, r.area]));
const types = (regions: RegionView[]) =>
  Object.fromEntries(regions.map((r) => [r.id, r.widgets.map((w) => w.widget)]));

describe("the built-in layouts", () => {
  it("offers the six in Studio's order, under the names Studio shows", () => {
    expect(BUILT_IN_LAYOUTS.map((l) => [l.id, l.name])).toEqual([
      ["pulse", "Pulse"],
      ["dashboard", "Dashboard"],
      ["hero", "Hero"],
      ["split", "Split"],
      ["ambient", "Ambient"],
      ["pulse_portrait", "Portrait"],
    ]);
  });

  it("keeps every region inside its grid, with no two boxes of a layer overlapping", () => {
    for (const l of BUILT_IN_LAYOUTS) {
      const cells = new Set<string>();
      for (const r of l.regions) {
        const a = r.area;
        expect(a.column + a.columns - 1, `${l.id}.${r.id}`).toBeLessThanOrEqual(l.grid.columns);
        expect(a.row + a.rows - 1, `${l.id}.${r.id}`).toBeLessThanOrEqual(l.grid.rows);
        for (let c = a.column; c < a.column + a.columns; c++) {
          for (let row = a.row; row < a.row + a.rows; row++) {
            const cell = `${String(r.layer ?? 0)}:${String(c)}:${String(row)}`;
            expect(cells.has(cell), `${l.id}.${r.id} overlaps at ${cell}`).toBe(false);
            cells.add(cell);
          }
        }
      }
    }
  });

  it("draws Dashboard's six boxes as the contract tables them, one the hero", () => {
    const regions = build({ regions: DRAWN });
    expect(areas(regions)).toMatchObject({
      header: at(1, 1, 6, 1),
      "header-2": at(7, 1, 6, 1),
      hero: at(1, 2, 4, 5),
      online: at(5, 2, 4, 5),
      voice: at(9, 2, 4, 5),
      top_games: at(1, 7, 4, 5),
      right_now: at(5, 7, 4, 5),
      rail: at(9, 7, 4, 5),
      ticker: at(1, 12, 12, 1),
    });
    expect(types(regions)).toMatchObject({
      online: ["activity_graph"],
      voice: ["voice_rooms"],
      top_games: ["now_playing"],
      right_now: ["stats"],
      rail: ["agenda_now", "countdown"],
    });
    expect(regions.find((r) => r.id === "hero")?.role).toBe("hero");
    // Boxes whose source is not on main yet (#389) are empty, so they follow their idle rule.
    expect(regions.find((r) => r.id === "online")?.widgets[0]?.view.empty).toBe(true);
    expect(regions.find((r) => r.id === "online")?.idle).toBe("blank");
  });

  it("draws Hero as one panel with a one-line now-and-next band, and no ticker", () => {
    const regions = build({ layoutId: "hero" });
    expect(areas(regions)).toMatchObject({ hero: at(1, 2, 12, 10), rail: at(1, 12, 12, 1) });
    expect(types(regions).rail).toEqual(["agenda_now"]);
    expect(regions.some((r) => r.role === "ticker")).toBe(false);
  });

  it("draws Split's two columns, the venue rail split by the hub QR", () => {
    const regions = build({ layoutId: "split" });
    expect(areas(regions)).toMatchObject({
      hero: at(1, 2, 7, 10),
      rail: at(8, 2, 5, 5),
      venue_rail: at(8, 7, 3, 5),
      "venue_rail-2": at(11, 7, 2, 5),
    });
  });

  it("draws Ambient as the logo, a large clock and the run of show, no boxes or ticker", () => {
    const regions = build({ layoutId: "ambient" });
    expect(types(regions)).toEqual({ header: ["logo"], hero: ["clock"], rail: ["agenda_now"] });
    expect(areas(regions)).toMatchObject({ hero: at(2, 3, 10, 6), rail: at(2, 9, 10, 2) });
  });

  it("stacks the Pulse's boxes in Portrait, the Right now box between the rail and the venue rail", () => {
    const counted = { ...facts, stats: { checked_in: 164 } };
    const regions = build({ layoutId: null }, { portrait: true, facts: counted });
    expect(areas(regions)).toEqual({
      header: at(1, 1, 3, 2),
      "header-2": at(4, 1, 3, 2),
      hero: at(1, 3, 6, 6),
      rail: at(1, 9, 6, 3),
      right_now: at(1, 12, 6, 2),
      venue_rail: at(1, 14, 3, 2),
      "venue_rail-2": at(4, 14, 3, 2),
      ticker: at(1, 16, 6, 1),
    });
    expect(types(regions).right_now).toEqual(["stats"]);
    // With `rotate` the hub QR takes turns in the venue rail instead.
    const rotating = build({ layoutId: null, hubQr: "rotate" }, { portrait: true });
    expect(areas(rotating).venue_rail).toEqual(at(1, 14, 6, 2));
    // With nothing counted yet the Right now box waits; no box beside it takes its rows.
    expect(areas(rotating).right_now).toBeUndefined();
  });

  it("puts Ambient's one line of statistics under its rail", () => {
    const counted = { ...facts, stats: { online: 218, online_trend: "up" } };
    const regions = build({ layoutId: "ambient" }, { facts: counted });
    expect(areas(regions).online).toEqual(at(2, 11, 10, 1));
    expect(types(regions).online).toEqual(["stats"]);
    expect(areas(build({ layoutId: "ambient" })).online).toBeUndefined();
  });
});

describe("the hero role", () => {
  it("trades the hero's area with the region `hero_region` names", () => {
    const regions = build({ heroRegion: "online", regions: DRAWN });
    expect(areas(regions)).toMatchObject({ hero: at(5, 2, 4, 5), online: at(1, 2, 4, 5) });
    // The widgets, settings and role travel with the region, not with the area.
    expect(regions.find((r) => r.id === "hero")?.role).toBe("hero");
    expect(types(regions).online).toEqual(["activity_graph"]);
  });

  it("trades nothing for null, its own id, an unknown id or a header, ticker or backdrop", () => {
    const plain = areas(build());
    for (const heroRegion of [null, "hero", "gone", "header", "ticker"]) {
      expect(areas(build({ heroRegion })), String(heroRegion)).toEqual(plain);
    }
    const backdrop = build({ heroRegion: "online", regions: { online: { role: "backdrop" } } });
    expect(areas(backdrop)).toEqual(plain);
  });
});

describe("the showcase", () => {
  it("grows Dashboard's hero to 8×10, keeps the rail and one box beside it and pauses the rest", () => {
    const grown = areas(build({ regions: DRAWN }, { showcase: "grow" }));
    expect(grown).toMatchObject({
      hero: at(1, 2, 8, 10),
      online: at(9, 2, 4, 5),
      rail: at(9, 7, 4, 5),
      header: at(1, 1, 6, 1),
      ticker: at(1, 12, 12, 1),
    });
    for (const id of ["voice", "top_games", "right_now"]) expect(grown).not.toHaveProperty(id);
    // The paused boxes come back at their own areas when the showcase ends.
    expect(areas(build({ regions: DRAWN }))).toMatchObject({
      voice: at(9, 2, 4, 5),
      top_games: at(1, 7, 4, 5),
      right_now: at(5, 7, 4, 5),
    });
  });

  it("keeps the first two boxes in layout order when none is a rail", () => {
    const regions = { ...DRAWN, rail: { role: "venue_rail" } };
    const grown = areas(build({ regions }, { showcase: "grow" }));
    expect(grown).toMatchObject({ online: at(9, 2, 4, 5), voice: at(9, 7, 4, 5) });
    for (const id of ["rail", "top_games", "right_now"]) expect(grown).not.toHaveProperty(id);
  });

  it("grows a hero in the band's right half against its right edge", () => {
    const grown = areas(build({ heroRegion: "voice", regions: DRAWN }, { showcase: "grow" }));
    expect(grown).toMatchObject({
      hero: at(5, 2, 8, 10),
      online: at(1, 2, 4, 5),
      rail: at(1, 7, 4, 5),
    });
  });

  it("grows no other built-in: their heroes leave no column free", () => {
    for (const layoutId of ["pulse", "hero", "split", "ambient"]) {
      expect(areas(build({ layoutId }, { showcase: "grow" })), layoutId).toEqual(
        areas(build({ layoutId })),
      );
    }
    expect(areas(build({ layoutId: null }, { showcase: "grow", portrait: true }))).toEqual(
      areas(build({ layoutId: null }, { portrait: true })),
    );
  });

  it("is a claim placed in the hero region, or a surging game it lists", () => {
    const override = overrideOf({
      id: "ov_1",
      kind: "block",
      zones: [],
      rank: 50,
      source: { module: "moments", event_id: null, ref: null },
      template: "announcement",
      content: { title: "Spotlight", body: "", level: "info" },
      regions: ["hero"],
      starts_at: "2026-03-14T18:40:00Z",
      ends_at: null,
    }) as Override;
    const regions = build();
    expect(isShowcase(regions)).toBe(false);
    expect(isShowcase(placeClaims(regions, [override]).regions)).toBe(true);
    // The claim keeps its place in the grown build: placement follows roles alone.
    const grown = placeClaims(build({}, { showcase: "grow" }), [override]).regions;
    expect(grown.find((r) => r.id === "hero")?.claim?.override_id).toBe("ov_1");
    const surging = regions.map(
      (r) =>
      r.role !== "hero"
        ? r
        : { ...r, widgets: r.widgets.map((w) => (w.widget === "hot_game" ? { ...w, view: { ...w.view, empty: false } } : w)) }, // prettier-ignore
    );
    expect(isShowcase(surging)).toBe(true);
  });
});

describe("agenda_now's later", () => {
  const item = (id: string, starts: string, delay = 0): AgendaItem => ({
    id,
    title: id,
    kind: "talk",
    starts_at: `2026-03-14T${starts}:00Z`,
    ends_at: null,
    delay_minutes: delay,
    location: "Stage",
    visibility: "public",
  });

  it("gives the items after next as rows, `delayed` when they are", () => {
    const agenda = {
      current: [],
      next: [item("semis", "19:30")],
      later: [item("final", "21:15", 10), item("quiz", "22:30")],
    };
    const view = viewOf("agenda_now", {}, { ...facts, agenda });
    const later = view.later as { id: string; state: string; starts_text: string }[];
    expect(later.map((r) => [r.id, r.state, r.starts_text])).toEqual([
      ["final", "delayed", "21:15"],
      ["quiz", "next", "22:30"],
    ]);
  });

  it("is an empty list when nothing comes after next", () => {
    const view = viewOf("agenda_now", {}, { ...facts, agenda: { current: [], next: [item("semis", "19:30")] } }); // prettier-ignore
    expect(view.later).toEqual([]);
  });
});
