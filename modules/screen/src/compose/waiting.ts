/**
 * Boxes waiting for their source (contracts/screen.md, Box sizes and hidden boxes): a box of
 * statistics only, all of them empty, with the default idle, leaves the composed state, so a
 * Dashboard waiting for the bot's data (#389) does not repeat the header's logo in four boxes.
 * Its cells go to the hero when it can fill them (build.ts), else to the box beside it, by runs,
 * so the result never depends on the regions' order.
 */
import type { Area, Layout, LayoutRegion } from "./layouts.js";

/** The types whose source is the bot's presence data: the ones a box may wait for. */
const STATISTICS = new Set(["stats", "now_playing", "activity_graph", "voice_rooms"]);

/**
 * A waiting region: its widgets are all statistics and all empty, and its idle is `logo`. An
 * unknown idle draws `logo` (build.ts), so it waits too; `blank`, `next` and `collapse` keep the
 * box drawn, the zone's way to opt out. `isEmpty` is asked only once the types are all
 * statistics, so no other region's views are built twice.
 */
export function isWaiting<W extends { widget: string }>(
  widgets: readonly W[],
  idle: string,
  isEmpty: (widget: W) => boolean,
): boolean {
  return (
    idle === "logo" &&
    widgets.length > 0 &&
    widgets.every((w) => STATISTICS.has(w.widget)) &&
    widgets.every(isEmpty)
  );
}

/**
 * A layout with a box of statistics only, so Studio can say where its statistics come from. Their
 * source is not on main yet (#389), so such a box always waits; the slice that brings it makes
 * Studio's note follow the source.
 */
export const hasStatisticsBoxes = (layout: Layout): boolean =>
  layout.regions.some(
    (r) => r.widgets.length > 0 && r.widgets.every((w) => STATISTICS.has(w.widget)),
  );

const rowsMatch = (a: Area, b: Area): boolean => a.row === b.row && a.rows === b.rows;

interface Run {
  layer: number;
  area: Area;
}

/** Groups of waiting regions of one layer over the same rows that touch side by side. */
function runs(waiting: readonly LayoutRegion[]): Run[] {
  const sorted = [...waiting].sort((a, b) => a.area.column - b.area.column);
  const out: Run[] = [];
  for (const r of sorted) {
    const layer = r.layer ?? 0;
    const run = out.find(
      (o) =>
        o.layer === layer &&
        rowsMatch(o.area, r.area) &&
        o.area.column + o.area.columns === r.area.column,
    );
    if (run === undefined) out.push({ layer, area: { ...r.area } });
    else run.area = { ...run.area, columns: r.area.column + r.area.columns - run.area.column };
  }
  return out;
}

/**
 * The drawn regions with the waiting ones' cells handed over: each run to the drawn region of its
 * layer over exactly its rows that touches it on the left, else on the right, else to nobody (the
 * background). Neighbours are found on the areas as they come in, so a region given two runs (one
 * on each side) takes both.
 */
export function handedOver(
  regions: readonly LayoutRegion[],
  waitingIds: ReadonlySet<string>,
): readonly LayoutRegion[] {
  if (waitingIds.size === 0) return regions;
  const drawn = regions.filter((r) => !waitingIds.has(r.id));
  const grown = new Map<LayoutRegion, Area>();
  for (const { layer, area: run } of runs(regions.filter((r) => waitingIds.has(r.id)))) {
    const sameRows = (r: LayoutRegion): boolean =>
      (r.layer ?? 0) === layer && rowsMatch(r.area, run);
    const taker =
      drawn.find((r) => sameRows(r) && r.area.column + r.area.columns === run.column) ??
      drawn.find((r) => sameRows(r) && r.area.column === run.column + run.columns);
    if (taker === undefined) continue;
    const area = grown.get(taker) ?? taker.area;
    const left = Math.min(area.column, run.column);
    const right = Math.max(area.column + area.columns, run.column + run.columns);
    grown.set(taker, { ...area, column: left, columns: right - left });
  }
  return drawn.map((r) => {
    const area = grown.get(r);
    return area === undefined ? r : { ...r, area };
  });
}
