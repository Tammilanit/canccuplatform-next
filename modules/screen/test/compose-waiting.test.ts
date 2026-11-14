// Boxes waiting for their source (contracts/screen.md, Box sizes and hidden boxes; #416): a box of
// statistics only leaves the composed state while they are all empty, and the hero fills its cells
// as for a showcase when that pauses no box still drawn; else they go to the box beside it by runs.
import { describe, expect, it } from "vitest";
import { buildRegions } from "../src/compose/build.js";
import type { BuildInput, RegionView, ZoneSetup } from "../src/compose/build.js";
import type { Area, Layout, LayoutRegion } from "../src/compose/layouts.js";
import { handedOver, isWaiting } from "../src/compose/waiting.js";
import type { ZoneFacts } from "../src/compose/widgets.js";

const facts: ZoneFacts = {
  now: new Date("2026-03-14T18:42:00Z"),
  timeZone: "UTC",
  origin: "https://demo.example",
  eventName: "Demo Event",
  logoUrl: "https://demo.example/logo.svg",
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
const areas = (regions: RegionView[]) => Object.fromEntries(regions.map((r) => [r.id, r.area]));
const box = (id: string, area: Area, layer?: number): LayoutRegion => ({
  id,
  area,
  widgets: [],
  ...(layer === undefined ? {} : { layer }),
});

describe("a box waiting for its source", () => {
  it("is a box of only stats and now_playing, all empty, whose idle is logo", () => {
    const stats = { widget: "stats", empty: true };
    const playing = { widget: "now_playing", empty: true };
    const empty = (w: { empty: boolean }) => w.empty;
    expect(isWaiting([stats, playing], "logo", empty)).toBe(true);
    expect(isWaiting([stats, { widget: "stats", empty: false }], "logo", empty)).toBe(false);
    expect(isWaiting([stats, { widget: "clock", empty: true }], "logo", empty)).toBe(false);
    expect(isWaiting([], "logo", empty)).toBe(false);
    for (const idle of ["blank", "next", "collapse"]) {
      expect(isWaiting([stats], idle, empty)).toBe(false);
    }
    // Another type's view is never built for the check.
    const asked: string[] = [];
    const seen = (w: { widget: string; empty: boolean }) => (asked.push(w.widget), w.empty);
    isWaiting([stats, { widget: "qr", empty: false }], "logo", seen);
    expect(asked).toEqual([]);
  });

  it("leaves Dashboard's statistics out, and the hero fills their cells: 8×10 by the rail's 4×10", () => {
    expect(areas(build())).toEqual({
      header: at(1, 1, 6, 1),
      "header-2": at(7, 1, 6, 1),
      hero: at(1, 2, 8, 10),
      rail: at(9, 2, 4, 10),
      ticker: at(1, 12, 12, 1),
    });
  });

  it("grows the hero as for a showcase while Right now is drawn (the demo before the bot's data)", () => {
    // A 12×5 hero strip lost its label and time, and Right now spread one number over 8×5 (v8 rule 5).
    expect(areas(build({ regions: { right_now: { idle: "blank" } } }))).toMatchObject({
      hero: at(1, 2, 8, 10),
      right_now: at(9, 2, 4, 5),
      rail: at(9, 7, 4, 5),
    });
  });

  it("hands over by runs when the hero's growth would pause a box still drawn", () => {
    const blank = { idle: "blank" };
    const regions = build({ regions: { online: blank, voice: blank, top_games: blank } });
    expect(areas(regions)).toMatchObject({
      hero: at(1, 2, 4, 5),
      top_games: at(1, 7, 8, 5),
      rail: at(9, 7, 4, 5),
    });
    expect(regions.some((r) => r.id === "right_now")).toBe(false);
  });

  it("counts a zone's unset idle, logo and an unknown value the same", () => {
    const plain = areas(build());
    const logo = { idle: "logo" };
    expect(areas(build({ regions: { online: logo, voice: logo } }))).toEqual(plain);
    expect(areas(build({ regions: { online: { idle: "sparkle" } } }))).toEqual(plain);
  });

  it("stays drawn with idle blank, next or collapse, beside the hero filling the others", () => {
    for (const idle of ["blank", "next", "collapse"]) {
      const regions = build({ regions: { voice: { idle } } });
      expect(areas(regions), idle).toMatchObject({
        hero: at(1, 2, 8, 10),
        voice: at(9, 2, 4, 5),
        rail: at(9, 7, 4, 5),
      });
      expect(regions.find((r) => r.id === "voice")?.idle).toBe(idle);
    }
  });

  it("waits by the zone's widgets, not the layout's", () => {
    const regions = build({ regions: { hero: { widgets: [{ widget: "stats" }] } } });
    expect(regions.some((r) => r.id === "hero")).toBe(false);
    // A zone that gives a statistics box a widget with content keeps it drawn.
    const clock = build({ regions: { online: { widgets: [{ widget: "clock" }] } } });
    expect(areas(clock)).toMatchObject({ hero: at(1, 2, 8, 10), online: at(9, 2, 4, 5) });
  });

  // The hero in the right column has no free columns in the drawn boxes' band, so it does not grow.
  it("finds its runs after the trade: the hero in voice's place takes the cells on its left", () => {
    expect(areas(build({ heroRegion: "voice" }))).toMatchObject({
      hero: at(1, 2, 12, 5),
      rail: at(1, 7, 12, 5),
    });
    expect(build({ heroRegion: "voice" }).some((r) => r.id === "voice")).toBe(false);
  });

  it("gives way to a showcase: the hero grows to 8×10 and the rail alone takes the 4×10", () => {
    expect(areas(build({}, { showcase: "grow" }))).toMatchObject({
      hero: at(1, 2, 8, 10),
      rail: at(9, 2, 4, 10),
    });
  });

  // A showcase decides the hero's size: filling the waiting cells would grow it after all.
  it("hands over its cells while a showcase plays at its size, as the zone says", () => {
    expect(areas(build({}, { showcase: "keep" }))).toMatchObject({
      hero: at(1, 2, 12, 5),
      rail: at(1, 7, 12, 5),
    });
  });

  it("hands over its cells when the hero cannot grow, though a showcase is on", () => {
    const shallow: Layout = {
      id: "shallow",
      name: "Shallow",
      aspect: "16:9",
      grid: { columns: 12, rows: 12 },
      regions: [
        { id: "hero", area: at(1, 1, 6, 12), widgets: [{ widget: "clock" }] },
        { id: "online", area: at(7, 1, 6, 12), widgets: [{ widget: "stats" }] },
      ],
    };
    const regions = build({ layoutId: "shallow" }, { showcase: "grow", themeLayouts: [shallow] });
    expect(areas(regions)).toEqual({ hero: at(1, 1, 12, 12) });
  });
});

describe("the hand-over by runs", () => {
  it("gives a run to the box on its left, else on its right, else to the background", () => {
    const regions = [
      box("a", at(1, 1, 4, 4)),
      box("w1", at(5, 1, 4, 4)),
      box("w2", at(9, 1, 4, 4)),
      box("w3", at(1, 5, 4, 4)),
      box("b", at(5, 5, 8, 4)),
      box("w4", at(1, 9, 12, 4)),
    ];
    const out = handedOver(regions, new Set(["w1", "w2", "w3", "w4"]));
    expect(Object.fromEntries(out.map((r) => [r.id, r.area]))).toEqual({
      a: at(1, 1, 12, 4),
      b: at(1, 5, 12, 4),
    });
  });

  it("does not depend on the regions' order, and a box between two runs takes both", () => {
    const regions = [
      box("w1", at(1, 1, 3, 6)),
      box("mid", at(4, 1, 3, 6)),
      box("w2", at(7, 1, 3, 6)),
      box("w3", at(10, 1, 3, 6)),
    ];
    const ids = new Set(["w1", "w2", "w3"]);
    const forward = handedOver(regions, ids);
    const backward = handedOver([...regions].reverse(), ids);
    expect(forward.map((r) => r.area)).toEqual([at(1, 1, 12, 6)]);
    expect(backward.map((r) => r.area)).toEqual([at(1, 1, 12, 6)]);
  });

  it("joins only boxes over exactly the same rows and of the same layer", () => {
    const regions = [
      box("a", at(1, 1, 4, 6)),
      box("w1", at(5, 1, 4, 6)),
      box("w2", at(9, 1, 4, 5)),
      box("top", at(9, 1, 4, 6), 1),
    ];
    const out = handedOver(regions, new Set(["w1", "w2"]));
    expect(Object.fromEntries(out.map((r) => [r.id, r.area]))).toEqual({
      a: at(1, 1, 8, 6),
      top: at(9, 1, 4, 6),
    });
  });

  it("returns the regions as they are when nothing waits", () => {
    const regions = [box("a", at(1, 1, 12, 12))];
    expect(handedOver(regions, new Set())).toBe(regions);
  });
});
