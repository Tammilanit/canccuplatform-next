/**
 * A zone's regions with its claims placed (contracts/screen.md, Moments drive it: claims; The hero
 * role and the showcase): a pure function of the zone, its layout, the sources and the active
 * overrides, so every screen of a zone agrees and the rules are tested without a stack.
 */
import { announceClaim, asideOf } from "./announce.js";
import { buildRegions } from "./build.js";
import type { BuildInput, RegionView } from "./build.js";
import { placeClaims } from "./claims.js";
import type { Override, Placement } from "./claims.js";
import type { Layout } from "./layouts.js";
import { heroShare, isShowcase } from "./showcase.js";
import type { ZoneFacts } from "./widgets.js";

export interface ZoneView extends Placement {
  layout: Layout;
}

/** The layer that draws a kept ticker above `_full` (layer 10) and `_overlay` (11). */
const KEPT_TICKER_LAYER = 12;

/**
 * The zone as built, then built again with the showcase when a claim landed in the hero: a claim's
 * place follows roles alone, so the second build places every claim as the first did. A showcase
 * decides the hero's size; only without one does it fill the waiting boxes.
 */
export function placeZone(
  input: Omit<BuildInput, "showcase">,
  given: readonly Override[],
  grow: boolean,
): ZoneView {
  const overrides = given.map((o) => announceClaim(o, input.facts));
  const mode = grow ? "grow" : "keep";
  const build = (showcase?: "grow" | "keep") =>
    buildRegions({ ...input, ...(showcase === undefined ? {} : { showcase }) });
  // The grow rule measures the hero as a claim in it would make it: grown where the zone lets it
  // grow, else at its size, never the plain build's hero that fills waiting boxes for want of one.
  const share = overrides.some((o) => o.hero_min_share !== null)
    ? (({ layout, regions }) => heroShare(regions, layout.grid))(build(mode))
    : undefined;
  const once = (showcase?: "grow" | "keep"): ZoneView => {
    const { layout, regions } = build(showcase);
    const placed = placeClaims(regions, overrides, share === undefined ? {} : { heroShare: share });
    return { layout, ...placed, regions: finished(placed.regions, layout, overrides, input.facts) };
  };
  const plain = once();
  if (!isShowcase(plain.regions)) return plain;
  return once(mode);
}

/** A placed `full` claim's ticker kept running, and its nearby content (#780). */
function finished(
  regions: RegionView[],
  layout: Layout,
  overrides: readonly Override[],
  facts: ZoneFacts,
): RegionView[] {
  const full = regions.find((r) => r.role === "full" && r.claim !== null);
  const claim = full?.claim;
  if (full === undefined || claim == null) return regions;
  const o = overrides.find((x) => x.id === claim.override_id);
  if (o === undefined) return regions;
  const aside = asideOf(claim, o, facts);
  let out = regions.map((r) =>
    r === full && aside != null ? { ...r, claim: { ...claim, aside } } : r,
  );
  if (o.keep_ticker) out = keptTicker(out, layout);
  return out;
}

/**
 * `_full` gives up a ticker's rows where the ticker runs along the grid's whole top or bottom edge;
 * any other ticker is drawn above it, since `_full` can only shrink to a rectangle.
 */
function keptTicker(regions: RegionView[], layout: Layout): RegionView[] {
  const { columns, rows } = layout.grid;
  const tickers = regions.filter((r) => r.role === "ticker");
  if (tickers.length === 0) return regions;
  const edge = tickers.length === 1 ? tickers[0] : undefined;
  const a = edge?.area;
  const wide = a !== undefined && a.column === 1 && a.columns === columns;
  const top = wide && a.row === 1;
  const bottom = wide && a.row + a.rows - 1 === rows;
  return regions.map((r) => {
    if (r.id === "_full" && a !== undefined && (top || bottom)) {
      const area = top
        ? { column: 1, row: a.rows + 1, columns, rows: rows - a.rows }
        : { column: 1, row: 1, columns, rows: rows - a.rows };
      return { ...r, area };
    }
    if (r.role === "ticker" && !(top || bottom)) return { ...r, layer: KEPT_TICKER_LAYER };
    return r;
  });
}
