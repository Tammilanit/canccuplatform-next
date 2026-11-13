/**
 * The box editor's geometry (static/studio-boxes.js; contracts/screen.md, Box sizes and hidden
 * boxes): one cell at a time on the grid, never off it, never over a neighbour.
 */
import { describe, expect, it } from "vitest";
import { boxProblem } from "../src/compose/boxes.js";
import { BUILT_IN_LAYOUTS } from "../src/compose/layouts.js";
import type { Layout } from "../src/compose/layouts.js";
import { drag, hide, resize, show } from "../static/studio-boxes.js";
import type { Area, Box } from "../static/studio-boxes.js";

const layout = (id: string): Layout => BUILT_IN_LAYOUTS.find((l) => l.id === id) as Layout;
const FRAME = new Set(["header", "ticker"]);
const boxesOf = (l: Layout): Box[] =>
  l.regions.map((r) => ({
    id: r.id,
    area: r.area,
    layer: r.layer ?? 0,
    hidden: false,
    frame: FRAME.has(r.id),
  }));
const at = (column: number, row: number, columns: number, rows: number): Area => ({
  column,
  row,
  columns,
  rows,
});
const areaOf = (boxes: Box[] | null, id: string) => boxes?.find((b) => b.id === id)?.area;
const GRID = { columns: 12, rows: 12 };
const PULSE = boxesOf(layout("pulse"));
const LAYOUT_AREAS = Object.fromEntries(PULSE.map((b) => [b.id, b.area]));

/** What Studio would save: the server's check must accept it. */
const saved = (boxes: Box[]): Record<string, Record<string, unknown>> =>
  Object.fromEntries(boxes.map((b) => [b.id, b.hidden ? { hidden: true } : { area: b.area }]));

describe("the box buttons", () => {
  it("make a box narrower or shorter by one cell, never below one", () => {
    expect(areaOf(resize(PULSE, "hero", "narrower", GRID), "hero")).toEqual(at(1, 2, 7, 10));
    expect(areaOf(resize(PULSE, "rail", "shorter", GRID), "rail")).toEqual(at(9, 2, 4, 5));
    const thin = [{ ...PULSE[0], area: at(1, 1, 1, 1) } as Box];
    expect(resize(thin, "header", "narrower", GRID)).toBeNull();
    expect(resize(thin, "header", "shorter", GRID)).toBeNull();
  });

  it("make a box wider or taller to the right or down, else to the left or up", () => {
    const narrow = resize(PULSE, "hero", "narrower", GRID) as Box[];
    expect(areaOf(resize(narrow, "hero", "wider", GRID), "hero")).toEqual(at(1, 2, 8, 10));
    // The rail meets the grid's right edge, so it grows into the column the hero gave up.
    expect(areaOf(resize(narrow, "rail", "wider", GRID), "rail")).toEqual(at(8, 2, 5, 6));
    // The ticker is on a layer of its own, so a box may grow under it; the ticker grows up.
    expect(areaOf(resize(PULSE, "venue_rail", "taller", GRID), "venue_rail")).toEqual(
      at(9, 8, 4, 5),
    );
    expect(areaOf(resize(PULSE, "ticker", "taller", GRID), "ticker")).toEqual(at(1, 11, 12, 2));
  });

  it("do nothing where a neighbour or the grid's edge is in the way", () => {
    expect(resize(PULSE, "hero", "wider", GRID)).toBeNull();
    expect(resize(PULSE, "rail", "taller", GRID)).toBeNull();
    expect(resize(PULSE, "header", "taller", GRID)).toBeNull();
  });
});

describe("the drag handles", () => {
  it("move an edge to a grid line, stopping at the neighbour", () => {
    const narrow = drag(PULSE, "hero", "right", 6, GRID);
    expect(areaOf(narrow, "hero")).toEqual(at(1, 2, 5, 10));
    expect(areaOf(drag(narrow, "rail", "left", 1, GRID), "rail")).toEqual(at(6, 2, 7, 6));
    expect(areaOf(drag(PULSE, "venue_rail", "top", 1, GRID), "venue_rail")).toEqual(at(9, 8, 4, 4));
    expect(areaOf(drag(PULSE, "hero", "bottom", 99, GRID), "hero")).toEqual(at(1, 2, 8, 11));
  });

  it("keep at least one cell", () => {
    expect(areaOf(drag(PULSE, "rail", "bottom", 1, GRID), "rail")).toEqual(at(9, 2, 4, 1));
  });
});

describe("Hide this box", () => {
  it("gives the space to the boxes beside it that cover one whole edge", () => {
    const venue = hide(PULSE, "venue_rail");
    expect(areaOf(venue, "rail")).toEqual(at(9, 2, 4, 10));
    // The rail and the venue rail together cover the hero's right edge, so both grow left.
    const hero = hide(PULSE, "hero");
    expect([areaOf(hero, "rail"), areaOf(hero, "venue_rail")]).toEqual([
      at(1, 2, 12, 6),
      at(1, 8, 12, 4),
    ]);
    for (const boxes of [venue, hero]) expect(boxProblem(layout("pulse"), saved(boxes))).toBeNull();
  });

  it("leaves the space to the background when no edge is covered, or only a frame's", () => {
    const hero = boxesOf(layout("hero"));
    const out = hide(hero, "hero");
    expect(out.find((b) => b.id === "hero")?.hidden).toBe(true);
    expect(areaOf(out, "header")).toEqual(at(1, 1, 12, 1));
    // The Hero layout's slim band is no frame: it is the box below, and takes the space.
    expect(areaOf(out, "rail")).toEqual(at(1, 2, 12, 11));
    const dash = boxesOf(layout("dashboard"));
    const voice = hide(resize(dash, "online", "shorter", GRID) as Box[], "online");
    expect(voice.filter((b) => b.id !== "online")).toEqual(
      (resize(dash, "online", "shorter", GRID) as Box[]).filter((b) => b.id !== "online"),
    );
  });

  it("shows a box again at the layout's area, putting the boxes in its way back", () => {
    const hidden = hide(PULSE, "venue_rail");
    expect(show(hidden, "venue_rail", LAYOUT_AREAS, GRID)).toEqual(PULSE);
    const moved = drag(hidden, "hero", "right", 6, GRID);
    const back = show(moved, "venue_rail", LAYOUT_AREAS, GRID);
    expect(areaOf(back, "rail")).toEqual(at(9, 2, 4, 6));
    expect(areaOf(back, "hero")).toEqual(at(1, 2, 5, 10));
  });
});
