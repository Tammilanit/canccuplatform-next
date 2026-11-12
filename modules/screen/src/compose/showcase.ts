/**
 * The hero role and the showcase (contracts/screen.md, The hero role and the showcase): a zone may
 * move the hero to another region (`hero_region`, a trade of areas), and the hero grows while it
 * shows a showcase (`grow_for_showcase`). Both change only the regions' areas, before parts split
 * them, so the composed state's `layout` stays as the theme or the built-in has it.
 */
import { roleOf } from "./layouts.js";
import type { Area, LayoutRegion, Role } from "./layouts.js";
import type { RegionView } from "./build.js";

type Settings = Record<string, Record<string, unknown>>;

// The frame of the screen: never the hero's place, and never moved for it. A full-grid backdrop
// under the boxes would otherwise make the band the whole screen.
const FRAME = new Set<Role | null>(["header", "ticker", "backdrop"]);

const roleIn = (r: LayoutRegion, settings: Settings): Role | null =>
  roleOf(r.id, settings[r.id]?.role);

/** The hero region: the layout's first region whose role is `hero`. */
const heroOf = (regions: readonly LayoutRegion[], settings: Settings): LayoutRegion | undefined =>
  regions.find((r) => roleIn(r, settings) === "hero");

/** The regions with the hero's area traded for `heroRegion`'s, or as they are when nothing trades. */
export function traded(
  regions: readonly LayoutRegion[],
  settings: Settings,
  heroRegion: string | null,
): readonly LayoutRegion[] {
  const hero = heroOf(regions, settings);
  const other = regions.find((r) => r.id === heroRegion);
  if (hero === undefined || other === undefined || other === hero) return regions;
  if (FRAME.has(roleIn(other, settings))) return regions;
  return regions.map((r) => {
    if (r === hero) return { ...r, area: other.area };
    return r === other ? { ...r, area: hero.area } : r;
  });
}

function bounds(areas: Area[]): Area {
  const column = Math.min(...areas.map((a) => a.column));
  const row = Math.min(...areas.map((a) => a.row));
  const right = Math.max(...areas.map((a) => a.column + a.columns));
  const bottom = Math.max(...areas.map((a) => a.row + a.rows));
  return { column, row, columns: right - column, rows: bottom - row };
}

/**
 * The regions with the hero grown to the band's height and twice its columns, and the other boxes
 * of its layer stacked in the columns it leaves free; as they are when the layout leaves no room.
 */
export function grown(
  regions: readonly LayoutRegion[],
  settings: Settings,
): readonly LayoutRegion[] {
  const hero = heroOf(regions, settings);
  if (hero === undefined) return regions;
  const layer = hero.layer ?? 0;
  const boxes = regions.filter((r) => (r.layer ?? 0) === layer && !FRAME.has(roleIn(r, settings)));
  const others = boxes.filter((r) => r !== hero);
  const band = bounds(boxes.map((r) => r.area));
  const columns = hero.area.columns * 2;
  const free = band.columns - columns;
  if (free <= 0 || band.rows < others.length) return regions;
  const right = (hero.area.column - band.column) * 2 >= band.columns;
  const areas = new Map<LayoutRegion, Area>([
    [
      hero,
      { column: right ? band.column + free : band.column, row: band.row, columns, rows: band.rows },
    ],
  ]);
  const freeColumn = right ? band.column : band.column + columns;
  let row = band.row;
  others.forEach((r, i) => {
    const rows = Math.floor(band.rows / others.length) + (i < band.rows % others.length ? 1 : 0);
    areas.set(r, { column: freeColumn, row, columns: free, rows });
    row += rows;
  });
  return regions.map((r) => {
    const area = areas.get(r);
    return area === undefined ? r : { ...r, area };
  });
}

/**
 * A showcase: a claim placed in the hero region (a hidden one too, since it shows the moment a
 * takeover ends, on the screens' own clock), or a surging game it lists.
 */
export function isShowcase(regions: readonly RegionView[]): boolean {
  const hero = regions.find((r) => r.role === "hero");
  return (
    hero !== undefined &&
    (hero.claim !== null || hero.widgets.some((w) => w.widget === "hot_game" && !w.view.empty))
  );
}
