/*
 * The box editor's geometry (Screen studio → Zones and layouts; contracts/screen.md, Box sizes and
 * hidden boxes), tested in test/studio-boxes.test.ts. A box is a region on the layout's grid:
 * `{ id, area: { column, row, columns, rows }, layer, hidden, frame }`, 1-based. Every move keeps
 * the server's rule: inside the grid, and no two drawn boxes of a layer share a cell. A move that
 * would break it stops at the neighbour (a drag) or does nothing (a button). Each function
 * returns new boxes and leaves its input alone.
 */

/** Two areas share a cell. */
export function overlaps(a, b) {
  return (
    a.column < b.column + b.columns &&
    b.column < a.column + a.columns &&
    a.row < b.row + b.rows &&
    b.row < a.row + a.rows
  );
}

export const sameArea = (a, b) =>
  !!a &&
  !!b &&
  a.column === b.column &&
  a.row === b.row &&
  a.columns === b.columns &&
  a.rows === b.rows;

/** The area lies inside the grid, at least one cell each way. */
export function fits(area, grid) {
  return (
    area.columns >= 1 &&
    area.rows >= 1 &&
    area.column >= 1 &&
    area.row >= 1 &&
    area.column + area.columns - 1 <= grid.columns &&
    area.row + area.rows - 1 <= grid.rows
  );
}

/** `box` may take `area`: it fits and no other drawn box of its layer is there. */
function free(boxes, box, area, grid) {
  return (
    fits(area, grid) &&
    !boxes.some(
      (o) => o.id !== box.id && !o.hidden && o.layer === box.layer && overlaps(area, o.area),
    )
  );
}

const replaced = (boxes, id, change) => boxes.map((b) => (b.id === id ? { ...b, ...change } : b));

/** The area with one edge moved by `delta` cells (outwards is positive). */
function moved(area, edge, delta) {
  if (edge === "right") return { ...area, columns: area.columns + delta };
  if (edge === "bottom") return { ...area, rows: area.rows + delta };
  if (edge === "left")
    return { ...area, column: area.column - delta, columns: area.columns + delta };
  return { ...area, row: area.row - delta, rows: area.rows + delta };
}

// Each button tries its edges in turn: Wider grows to the right, else to the left.
const STEPS = {
  narrower: [["right", -1]],
  wider: [
    ["right", 1],
    ["left", 1],
  ],
  shorter: [["bottom", -1]],
  taller: [
    ["bottom", 1],
    ["top", 1],
  ],
};

/** Narrower, Wider, Shorter or Taller by one cell, or null when the box cannot. */
export function resize(boxes, id, how, grid) {
  const box = boxes.find((b) => b.id === id);
  if (!box || box.hidden) return null;
  for (const [edge, delta] of STEPS[how] ?? []) {
    const area = moved(box.area, edge, delta);
    if (free(boxes, box, area, grid)) return replaced(boxes, id, { area });
  }
  return null;
}

/**
 * The edge dragged towards grid line `line` (1 is the grid's left or top edge, columns + 1 its
 * right), one cell at a time: it stops at a neighbour, the grid's edge or one cell of size.
 */
export function drag(boxes, id, edge, line, grid) {
  const box = boxes.find((b) => b.id === id);
  if (!box || box.hidden) return boxes;
  const now = {
    left: box.area.column,
    right: box.area.column + box.area.columns,
    top: box.area.row,
    bottom: box.area.row + box.area.rows,
  }[edge];
  const outwards = edge === "left" || edge === "top" ? now - line : line - now;
  const step = Math.sign(outwards);
  let area = box.area;
  for (let i = 0; i < Math.abs(outwards); i++) {
    const next = moved(area, edge, step);
    if (!free(boxes, box, next, grid)) break;
    area = next;
  }
  return replaced(boxes, id, { area });
}

/** The span of `b` along the edge it shares with `h` on `side`, or null when it is not there. */
function along(h, b, side) {
  const [ha, ba] = [h.area, b.area];
  if (side === "left" || side === "right") {
    const touches =
      side === "left" ? ba.column + ba.columns === ha.column : ba.column === ha.column + ha.columns;
    const inside = ba.row >= ha.row && ba.row + ba.rows <= ha.row + ha.rows;
    return touches && inside ? ba.rows : null;
  }
  const touches = side === "top" ? ba.row + ba.rows === ha.row : ba.row === ha.row + ha.rows;
  const inside = ba.column >= ha.column && ba.column + ba.columns <= ha.column + ha.columns;
  return touches && inside ? ba.columns : null;
}

/**
 * The box hidden, its space given to the boxes beside it whose edges together cover one whole
 * edge of it (left, right, top, then bottom), else left to the background. A frame box (header,
 * ticker, backdrop) never grows into it.
 */
export function hide(boxes, id) {
  const h = boxes.find((b) => b.id === id);
  if (!h || h.hidden) return boxes;
  let out = replaced(boxes, id, { hidden: true });
  for (const side of ["left", "right", "top", "bottom"]) {
    const beside = boxes.filter(
      (b) =>
        b.id !== id && !b.hidden && !b.frame && b.layer === h.layer && along(h, b, side) !== null,
    );
    const span = side === "left" || side === "right" ? h.area.rows : h.area.columns;
    if (beside.length === 0 || beside.reduce((n, b) => n + along(h, b, side), 0) !== span) continue;
    for (const b of beside) {
      const grown =
        side === "left" || side === "right"
          ? {
              column: Math.min(b.area.column, h.area.column),
              columns: b.area.columns + h.area.columns,
            }
          : { row: Math.min(b.area.row, h.area.row), rows: b.area.rows + h.area.rows };
      out = replaced(out, b.id, { area: { ...b.area, ...grown } });
    }
    return out;
  }
  return out;
}

/**
 * The box drawn again at the layout's area; boxes now in its way go back to the layout's areas
 * too. Null when that still leaves an overlap (a box of another zone setting holds the space).
 */
export function show(boxes, id, layoutAreas, grid) {
  const box = boxes.find((b) => b.id === id);
  if (!box || !box.hidden) return boxes;
  const area = layoutAreas[id];
  let out = replaced(boxes, id, { hidden: false, area });
  for (const b of out) {
    if (b.id !== id && !b.hidden && b.layer === box.layer && overlaps(area, b.area)) {
      out = replaced(out, b.id, { area: layoutAreas[b.id] });
    }
  }
  // As the server checks: overlaps the layout itself draws (a backdrop) are allowed.
  const own = (b) => !sameArea(b.area, layoutAreas[b.id]);
  const drawn = out.filter((b) => !b.hidden);
  const clash = drawn.some(
    (a, i) =>
      !fits(a.area, grid) ||
      drawn
        .slice(i + 1)
        .some((b) => (own(a) || own(b)) && a.layer === b.layer && overlaps(a.area, b.area)),
  );
  return clash ? null : out;
}

const inside = (a, column, row) =>
  column >= a.column && column < a.column + a.columns && row >= a.row && row < a.row + a.rows;

// The edge of a box that meets a gap on each side of it, and the box's edge line there.
const SIDES = [
  ["right", (g) => g.column, (a) => a.column + a.columns],
  ["left", (g) => g.column + g.columns, (a) => a.column],
  ["bottom", (g) => g.row, (a) => a.row + a.rows],
  ["top", (g) => g.row + g.rows, (a) => a.row],
];
const across = (edge) => edge === "left" || edge === "right";
/** The gap's size away from the box's edge: columns beside it, rows above or below it. */
const depth = (gap, edge) => (across(edge) ? gap.columns : gap.rows);

const OPPOSITE = { right: "left", left: "right", bottom: "top", top: "bottom" };

/**
 * The space an edit left empty (#422): cells the layout's own areas cover and no drawn box does,
 * as rectangles, row by row. Space the layout itself leaves (Ambient's margins) is no gap. Each
 * names the box beside it whose edge would grow into it: one that covers it whole first, else
 * one that covers part of it, else a frame or a box that cannot grow, then `fills` is false; and
 * the other boxes beside it. A rectangle no one box can fill whole is split at the edges of the
 * boxes beside it, so each part is named by, and filled from, its own box (#486).
 */
export function gaps(boxes, grid) {
  const drawn = boxes.filter((b) => !b.hidden && b.area);
  const wanted = boxes.map((b) => b.layoutArea).filter(Boolean);
  const open = (c, r) =>
    wanted.some((a) => inside(a, c, r)) && !drawn.some((b) => inside(b.area, c, r));
  const taken = new Set();
  const empty = (c, r) => !taken.has(`${c},${r}`) && open(c, r);
  const out = [];
  for (let row = 1; row <= grid.rows; row++) {
    for (let column = 1; column <= grid.columns; column++) {
      if (!empty(column, row)) continue;
      let columns = 1;
      while (column + columns <= grid.columns && empty(column + columns, row)) columns++;
      let rows = 1;
      const rowFree = (r) =>
        Array.from({ length: columns }, (_, i) => column + i).every((c) => empty(c, r));
      while (row + rows <= grid.rows && rowFree(row + rows)) rows++;
      for (let r = row; r < row + rows; r++)
        for (let c = column; c < column + columns; c++) taken.add(`${c},${r}`);
      out.push(...named({ boxes: drawn, all: boxes, grid, open }, { column, row, columns, rows }));
    }
  }
  return out;
}

/** The boxes beside `area`, each with the edge it meets it on and whether that edge can grow. */
function touching({ boxes, all, grid, open }, area) {
  const out = [];
  for (const [edge, gapLine, boxLine] of SIDES) {
    for (const b of boxes) {
      if (boxLine(b.area) !== gapLine(area)) continue;
      const [start, span, gStart, gSpan] = across(edge)
        ? [b.area.row, b.area.rows, area.row, area.rows]
        : [b.area.column, b.area.columns, area.column, area.columns];
      if (start >= gStart + gSpan || gStart >= start + span) continue;
      const grown = moved(b.area, edge, depth(area, edge));
      // A box longer than the gap would grow past it: only into cells that are empty too, never
      // into the layout's margins or under a box of another layer.
      const fills =
        !b.frame &&
        free(all, b, grown, grid) &&
        cellsOf(grown, b.area).every(([c, r]) => open(c, r));
      const whole = start === gStart && span === gSpan;
      out.push({ box: b.id, edge, frame: b.frame, fills, whole, start, span, gStart, gSpan });
    }
  }
  return out;
}

/** The cells of `grown` that `area` does not cover. */
function cellsOf(grown, area) {
  const out = [];
  for (let r = grown.row; r < grown.row + grown.rows; r++)
    for (let c = grown.column; c < grown.column + grown.columns; c++)
      if (!inside(area, c, r)) out.push([c, r]);
  return out;
}

/** The gap named, or its parts, cut where a box beside it starts or ends. */
function named(scene, area) {
  const beside = touching(scene, area);
  if (!beside.some((t) => t.fills && t.whole)) {
    const cuts = { columns: new Set(), rows: new Set() };
    for (const t of beside) {
      const set = across(t.edge) ? cuts.rows : cuts.columns;
      for (const line of [t.start, t.start + t.span])
        if (line > t.gStart && line < t.gStart + t.gSpan) set.add(line);
    }
    if (cuts.columns.size + cuts.rows.size > 0) {
      const spans = (from, size, at) => {
        const lines = [from, ...[...at].sort((x, y) => x - y), from + size];
        return lines.slice(1).map((end, i) => [lines[i], end - lines[i]]);
      };
      return spans(area.row, area.rows, cuts.rows).flatMap(([row, rows]) =>
        spans(area.column, area.columns, cuts.columns).flatMap(([column, columns]) =>
          named(scene, { column, row, columns, rows }),
        ),
      );
    }
  }
  const pick =
    beside.find((t) => t.fills && t.whole) ??
    beside.find((t) => t.fills) ??
    beside.find((t) => !t.frame) ??
    beside[0];
  // A header or ticker runs along most gaps, and naming it says nothing; it is named only
  // beside another frame (the band left when every box between them is hidden).
  const others = beside
    .filter((t) => t !== pick && (pick.frame || !t.frame))
    .map((t) => ({ box: t.box, edge: t.edge }));
  return [
    pick
      ? { area, box: pick.box, edge: pick.edge, fills: pick.fills, others }
      : { area, box: null, edge: null, fills: false, others },
  ];
}

/** The box beside the gap grown into it ("Fill the gap"), or null when it cannot. */
export function fill(boxes, gap) {
  if (!gap.fills) return null;
  const box = boxes.find((b) => b.id === gap.box);
  return replaced(boxes, gap.box, { area: moved(box.area, gap.edge, depth(gap.area, gap.edge)) });
}

// The Changes line's message by the side of the box the gap is on (studio-layout.js words it).
const WORDS = { right: "gap.right", left: "gap.left", bottom: "gap.below", top: "gap.above" };

/**
 * The gap's message key and count (studio.js's `counted` picks the singular), the box it names,
 * the box on its other side when there is one ("between"), and every other box beside it.
 */
export function gapWords(gap) {
  if (!gap.edge)
    return {
      key: "gap.cells",
      count: gap.area.columns * gap.area.rows,
      box: null,
      other: null,
      also: [],
    };
  const opposite = gap.others.find((o) => o.edge === OPPOSITE[gap.edge]);
  const key = opposite
    ? across(gap.edge)
      ? "gap.between_columns"
      : "gap.between_rows"
    : WORDS[gap.edge];
  return {
    key,
    count: depth(gap.area, gap.edge),
    box: gap.box,
    other: opposite?.box ?? null,
    also: gap.others.filter((o) => o !== opposite).map((o) => o.box),
  };
}
