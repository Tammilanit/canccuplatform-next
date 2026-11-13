/**
 * The box editor's geometry (static/studio-boxes.js; contracts/screen.md, Box sizes and hidden
 * boxes): one cell at a time on the grid, never off it, never over a neighbour; and the space an
 * edit leaves empty, in words, and filled by the box beside it (#422).
 */
import { describe, expect, it } from "vitest";
import { boxProblem } from "../src/compose/boxes.js";
import { BUILT_IN_LAYOUTS } from "../src/compose/layouts.js";
import type { Layout } from "../src/compose/layouts.js";
import { drag, fill, gaps, gapWords, hide, resize, show } from "../static/studio-boxes.js";
import type { Area, Box } from "../static/studio-boxes.js";

const layout = (id: string): Layout => BUILT_IN_LAYOUTS.find((l) => l.id === id) as Layout;
const FRAME = new Set(["header", "ticker"]);
const boxesOf = (l: Layout): Box[] =>
  l.regions.map((r) => ({
    id: r.id,
    area: r.area,
    layoutArea: r.area,
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

describe("the empty space an edit leaves", () => {
  it("is none in any built-in layout as drawn, Ambient's margins included", () => {
    for (const l of BUILT_IN_LAYOUTS) expect(gaps(boxesOf(l), l.grid)).toEqual([]);
  });

  it("is the column between Hero and the rail, said as Hero's right, and Hero fills it", () => {
    // #418's shot: the venue card hidden, Hero two cells narrower, the rail one cell wider.
    let boxes = hide(PULSE, "venue_rail");
    for (const how of ["narrower", "narrower"] as const)
      boxes = resize(boxes, "hero", how, GRID) as Box[];
    boxes = resize(boxes, "rail", "wider", GRID) as Box[];
    const found = gaps(boxes, GRID);
    expect(found).toEqual([{ area: at(7, 2, 1, 10), box: "hero", edge: "right", fills: true }]);
    expect(gapWords(found[0])).toEqual({ key: "gap.right.one", count: 1 });
    const filled = fill(boxes, found[0]) as Box[];
    expect(areaOf(filled, "hero")).toEqual(at(1, 2, 7, 10));
    expect(areaOf(filled, "rail")).toEqual(at(8, 2, 5, 10));
    expect(gaps(filled, GRID)).toEqual([]);
    expect(boxProblem(layout("pulse"), saved(filled))).toBeNull();
  });

  it("counts columns or rows by the side it is on", () => {
    const narrow = drag(PULSE, "hero", "right", 7, GRID);
    const [wide] = gaps(narrow, GRID);
    expect(wide).toMatchObject({ area: at(7, 2, 2, 10), box: "hero", edge: "right" });
    expect(gapWords(wide)).toEqual({ key: "gap.right", count: 2 });
    const short = resize(PULSE, "hero", "shorter", GRID) as Box[];
    const [below] = gaps(short, GRID);
    expect(below).toMatchObject({ area: at(1, 11, 8, 1), box: "hero", edge: "bottom" });
    expect(gapWords(below)).toEqual({ key: "gap.below.one", count: 1 });
    expect(areaOf(fill(short, below), "hero")).toEqual(at(1, 2, 8, 10));
  });

  it("is filled as far as a box beside can grow, the rest left for the next", () => {
    const box = (id: string, area: Area): Box => ({
      id,
      area,
      layoutArea: area,
      layer: 0,
      hidden: false,
      frame: false,
    });
    const split = [
      box("a", at(1, 1, 6, 5)),
      box("c", at(1, 6, 6, 7)),
      { ...box("b", at(8, 1, 5, 12)), layoutArea: at(7, 1, 6, 12) },
    ];
    // b's own edge covers the whole stripe, so it is the one that fills it.
    expect(gaps(split, GRID)).toEqual([
      { area: at(7, 1, 1, 12), box: "b", edge: "left", fills: true },
    ]);
    const parts = [
      box("a", at(1, 1, 6, 5)),
      box("c", at(1, 6, 6, 7)),
      { ...box("d", at(8, 1, 5, 5)), layoutArea: at(7, 1, 6, 5) },
      { ...box("e", at(8, 6, 5, 7)), layoutArea: at(7, 6, 6, 7) },
    ];
    const [first] = gaps(parts, GRID);
    expect(first).toEqual({ area: at(7, 1, 1, 12), box: "a", edge: "right", fills: true });
    const once = fill(parts, first) as Box[];
    expect(areaOf(once, "a")).toEqual(at(1, 1, 7, 5));
    expect(gaps(once, GRID)).toEqual([
      { area: at(7, 6, 1, 7), box: "c", edge: "right", fills: true },
    ]);
  });

  it("names a frame beside it but never grows one, and counts cells beside nothing", () => {
    const hero = boxesOf(layout("pulse")).map((b) =>
      b.id === "header" || b.id === "ticker" ? b : { ...b, hidden: true },
    );
    const [band] = gaps(hero, GRID);
    expect(band).toEqual({ area: at(1, 2, 12, 10), box: "header", edge: "bottom", fills: false });
    expect(gapWords(band)).toEqual({ key: "gap.below", count: 10 });
    expect(fill(hero, band)).toBeNull();
    const alone = [{ ...PULSE[1], hidden: true }];
    const [all] = gaps(alone, GRID);
    expect(all).toEqual({ area: at(1, 2, 8, 10), box: null, edge: null, fills: false });
    expect(gapWords(all)).toEqual({ key: "gap.cells", count: 80 });
  });
});
