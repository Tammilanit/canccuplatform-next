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
