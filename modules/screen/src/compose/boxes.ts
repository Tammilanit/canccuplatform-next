/**
 * A zone's box sizes and hidden boxes (contracts/screen.md, Box sizes and hidden boxes): the
 * per-region `area` and `hidden` settings, which apply only while the zone's screens draw the
 * zone's own layout. Pure, so the save's check and the composed state use one rule.
 */
import type { Area, Layout, LayoutRegion, WidgetEntry } from "./layouts.js";

type Settings = Record<string, Record<string, unknown>>;

const isArea = (value: unknown): value is Area =>
  typeof value === "object" &&
  value !== null &&
  (["column", "row", "columns", "rows"] as const).every((k) =>
    Number.isInteger((value as Record<string, unknown>)[k]),
  );

/** The zone's own area for a region, or undefined for the layout's. */
const ownArea = (settings: Settings, id: string): Area | undefined => {
  const area = settings[id]?.area;
  return isArea(area) ? area : undefined;
};

const isHidden = (settings: Settings, id: string): boolean => settings[id]?.hidden === true;

/** `null` counts as `pulse`, so the settings never follow a portrait or fallback layout. */
export const ownsLayout = (layout: Layout, zoneLayoutId: string | null): boolean =>
  layout.id === (zoneLayoutId ?? "pulse");

const fits = (a: Area, layout: Layout): boolean =>
  a.column >= 1 &&
  a.row >= 1 &&
  a.columns >= 1 &&
  a.rows >= 1 &&
  a.column + a.columns - 1 <= layout.grid.columns &&
  a.row + a.rows - 1 <= layout.grid.rows;

const overlap = (a: Area, b: Area): boolean =>
  a.column < b.column + b.columns &&
  b.column < a.column + a.columns &&
  a.row < b.row + b.rows &&
  b.row < a.row + a.rows;

/**
 * Why the zone's areas do not fit the layout, or null when they do: an area off the grid, or two
 * drawn regions of one layer sharing a cell where either has its own area. Overlaps the layout
 * itself draws (a backdrop under the boxes) stay allowed. Settings for regions the layout lacks
 * are kept for another layout and checked against nothing.
 */
export function boxProblem(layout: Layout, settings: Settings): string | null {
  const drawn = layout.regions.filter((r) => !isHidden(settings, r.id));
  for (const r of layout.regions) {
    const area = ownArea(settings, r.id);
    if (area !== undefined && !fits(area, layout)) {
      return `\`regions.${r.id}.area\` must fit the ${layout.grid.columns} × ${layout.grid.rows} grid of the layout \`${layout.id}\`.`;
    }
  }
  for (const [i, a] of drawn.entries()) {
    for (const b of drawn.slice(i + 1)) {
      const mine = ownArea(settings, a.id);
      const theirs = ownArea(settings, b.id);
      if (mine === undefined && theirs === undefined) continue;
      if ((a.layer ?? 0) !== (b.layer ?? 0)) continue;
      if (overlap(mine ?? a.area, theirs ?? b.area)) {
        return `\`regions.${a.id}\` and \`regions.${b.id}\` must not overlap in the layout \`${layout.id}\`.`;
      }
    }
  }
  return null;
}

/**
 * The layout's regions as the zone draws them: hidden ones left out, and the zone's areas in
 * place of the layout's while they all fit; else every drawn region at the layout's area, so
 * boxes are never drawn on top of each other. Another layout's regions are as the layout has them.
 */
export function placedBoxes(
  layout: Layout,
  zoneLayoutId: string | null,
  settings: Settings,
): readonly LayoutRegion[] {
  if (!ownsLayout(layout, zoneLayoutId)) return layout.regions;
  const drawn = layout.regions.filter((r) => !isHidden(settings, r.id));
  if (boxProblem(layout, settings) !== null) return drawn;
  return drawn.map((r) => {
    const area = ownArea(settings, r.id);
    return area === undefined ? r : { ...r, area };
  });
}

/** The zone's widgets for a box, else the layout's. */
export function boxWidgets(source: LayoutRegion, settings: Settings): WidgetEntry[] {
  const widgets = settings[source.id]?.widgets;
  return Array.isArray(widgets) ? (widgets as WidgetEntry[]) : source.widgets;
}
