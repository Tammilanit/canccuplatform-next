/**
 * The composed state's regions (contracts/screen.md, The Pulse options and Composed state): a
 * pure function of the zone, the layout and what the sources said, so every screen of a zone
 * gets the same answer and the rules are tested without a stack.
 */
import { boxWidgets, placedBoxes } from "./boxes.js";
import type { Claim } from "./claims.js";
import { directorOrder, jumpAt } from "./director.js";
import { chooseLayout, roleOf } from "./layouts.js";
import type { Area, Layout, LayoutRegion, Props, Role } from "./layouts.js";
import { partsOf } from "./parts.js";
import { shuffled } from "./seeded.js";
import type { HeaderMode, HubQrMode, Part } from "./parts.js";
import { grown, traded } from "./showcase.js";
import { handedOver, isWaiting } from "./waiting.js";
import { countdownFields, viewOf } from "./widgets.js";
import type { View, ZoneFacts } from "./widgets.js";

export interface ZoneSetup {
  key: string;
  layoutId: string | null;
  regions: Record<string, Record<string, unknown>>;
  /** Absent or null: the layout's `header`, else `separate`. */
  header?: HeaderMode | null;
  /** Absent: `always`. */
  hubQr?: HubQrMode;
  /** Absent or null: the hero stays in the hero region. */
  heroRegion?: string | null;
}

export interface BuildInput {
  zone: ZoneSetup;
  windowLayoutId: string | null;
  themeLayouts: readonly Layout[];
  portrait: boolean;
  facts: ZoneFacts;
  /**
   * A showcase plays in the hero (src/compose/showcase.ts, the caller decides): `grow`, the zone
   * lets it grow; `keep`, it plays at its size. Absent: nothing is showcased.
   */
  showcase?: "grow" | "keep";
}

export interface WidgetView {
  widget: string;
  template: string | null;
  embed: string | null;
  dwell_seconds: number;
  stale_after_seconds: number | null;
  view: View;
}

export type Idle = "logo" | "blank" | "collapse" | "next";
export type Rotation = "sequence" | "shuffle" | "director";
export type Indicator = "line" | "ring" | "off";

export interface RegionView {
  id: string;
  role: Role | null;
  area: Area;
  layer: number;
  rotation: Rotation;
  order: number[];
  cycle_started_at: string;
  /** How the screen shows the hero's turn (The Director). */
  indicator: Indicator;
  idle: Idle;
  idle_view: { widget: "countdown"; view: View } | null;
  widgets: WidgetView[];
  /** Placed afterwards, from the zone's active overrides (claims.ts). */
  claim: Claim | null;
}

export const DEFAULT_DWELL_S = 15;
const IDLES: readonly Idle[] = ["logo", "blank", "collapse", "next"];
const ROTATIONS: readonly Rotation[] = ["sequence", "shuffle", "director"];
const INDICATORS: readonly Indicator[] = ["line", "ring", "off"];

const clampDwell = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value)
    ? Math.min(3600, Math.max(5, value))
    : undefined;

/**
 * The widget a region shows at `nowMs`, or null when none takes part. A state's `order` is only
 * its own cycle's: later cycles follow the epoch, and a shuffle reshuffles each cycle with the
 * seed `region()` uses, as the player does between pushes (player/src/rotation.ts). The Director
 * plays a jump first, over the rotation running on underneath.
 */
export function shownAt(
  region: Pick<RegionView, "id" | "rotation" | "order"> & {
    widgets: readonly Pick<WidgetView, "widget" | "dwell_seconds" | "view">[];
  },
  zoneKey: string,
  nowMs: number,
): WidgetView | null {
  const jump = region.rotation === "director" ? jumpAt(region.widgets, region.order, nowMs) : null;
  if (jump !== null) return (region.widgets[jump.index] as WidgetView | undefined) ?? null;
  const dwellMs = (i: number): number => (region.widgets[i]?.dwell_seconds ?? 0) * 1000;
  // A shuffled order is a permutation of the plain one, which lists the widgets in place order.
  const plain =
    region.rotation === "shuffle" ? [...region.order].sort((a, b) => a - b) : region.order;
  const cycleMs = plain.reduce((sum, i) => sum + dwellMs(i), 0);
  if (cycleMs <= 0) return null;
  const cycle = Math.floor(nowMs / cycleMs);
  const order =
    region.rotation === "shuffle" ? shuffled(plain, `${zoneKey}:${region.id}:${cycle}`) : plain;
  let end = cycle * cycleMs;
  for (const i of order) {
    end += dwellMs(i);
    if (nowMs < end) return (region.widgets[i] as WidgetView | undefined) ?? null;
  }
  return null;
}

const idleOf = (setting: Record<string, unknown>): Idle =>
  IDLES.includes(setting.idle as Idle) ? (setting.idle as Idle) : "logo";

/**
 * A box the zone, as set, leaves waiting while its statistics are empty, as they all are until
 * their source comes (#389): Studio's gallery note follows this, not the layout alone.
 */
export function waitsWhileEmpty(
  source: LayoutRegion,
  regions: BuildInput["zone"]["regions"],
): boolean {
  const setting = regions[source.id] ?? {};
  return (
    setting.hidden !== true && isWaiting(boxWidgets(source, regions), idleOf(setting), () => true)
  );
}

/** A box of statistics still waiting for its source (waiting.ts). */
function waits(source: LayoutRegion, input: BuildInput): boolean {
  return isWaiting(
    boxWidgets(source, input.zone.regions),
    idleOf(input.zone.regions[source.id] ?? {}),
    (e) => viewOf(e.widget, e.props ?? {}, input.facts, e.embed ?? null).empty,
  );
}

/** A region as the zone sets it, drawn whole or as its parts. */
function regionsOf(source: LayoutRegion, layout: Layout, input: BuildInput): RegionView[] {
  const setting = input.zone.regions[source.id] ?? {};
  const entries = boxWidgets(source, input.zone.regions);
  const role = roleOf(source.id, setting.role);
  const modes = {
    header: input.zone.header ?? layout.header ?? "separate",
    hubQr: input.zone.hubQr ?? "always",
  };
  const ids = new Set(layout.regions.map((r) => r.id));
  return partsOf(source, entries, role, modes, ids).map((part) =>
    region(part, source, setting, part.hubQr ? null : role, input),
  );
}

function region(
  part: Part,
  source: LayoutRegion,
  setting: Record<string, unknown>,
  role: Role | null,
  input: BuildInput,
): RegionView {
  const entries = part.entries;
  const zoneDwell = clampDwell(setting.dwell_seconds);
  const widgets = entries.map((entry): WidgetView => {
    const props: Props = entry.props ?? {};
    return {
      widget: entry.widget,
      template: entry.template ?? null,
      embed: entry.embed ?? null,
      dwell_seconds:
        clampDwell(props.dwell_seconds) ??
        zoneDwell ??
        clampDwell(source.rotate_seconds) ??
        DEFAULT_DWELL_S,
      stale_after_seconds: null,
      view: viewOf(entry.widget, props, input.facts, entry.embed ?? null),
    };
  });
  const skipEmpty = setting.skip_empty !== false;
  const sequence = widgets.flatMap((w, i) => (skipEmpty && w.view.empty ? [] : [i]));
  // Cycles are anchored on the epoch, not on a save or a boot, so all screens of a zone show the
  // same widget at the same moment, also after a reload and offline.
  const cycleMs =
    sequence.reduce((sum, i) => sum + (widgets[i] as WidgetView).dwell_seconds, 0) * 1000;
  const nowMs = input.facts.now.getTime();
  const cycle = cycleMs === 0 ? 0 : Math.floor(nowMs / cycleMs);
  // The hero's features are the Director's to pick (sheet 13), unless the zone says otherwise.
  const rotation =
    ROTATIONS.find((r) => r === setting.rotation) ?? (role === "hero" ? "director" : "sequence");
  const idle = idleOf(setting);
  const next = idle === "next" ? countdownFields(input.facts) : null;
  return {
    id: part.id,
    role,
    area: part.area,
    layer: source.layer ?? 0,
    rotation,
    order:
      rotation === "shuffle"
        ? shuffled(sequence, `${input.zone.key}:${part.id}:${cycle}`)
        : rotation === "director"
          ? directorOrder(widgets, sequence)
          : sequence,
    cycle_started_at: new Date(cycle * cycleMs).toISOString(),
    indicator: INDICATORS.find((i) => i === setting.indicator) ?? "line",
    idle,
    idle_view:
      next === null
        ? null
        : { widget: "countdown", view: { ...next, qr: null, stale: false, empty: false } },
    widgets,
    claim: null,
  };
}

/** `_full` and `_overlay` cover the whole grid so a claim always has its place (layers 10, 11). */
function synthetic(id: "_full" | "_overlay", layout: Layout, at: Date): RegionView {
  return {
    id,
    role: id === "_full" ? "full" : "overlay",
    area: { column: 1, row: 1, columns: layout.grid.columns, rows: layout.grid.rows },
    layer: id === "_full" ? 10 : 11,
    rotation: "sequence",
    order: [],
    cycle_started_at: new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString(),
    indicator: "off",
    idle: "blank",
    idle_view: null,
    widgets: [],
    claim: null,
  };
}

const holds = (a: Area, column: number, row: number): boolean =>
  column >= a.column && column < a.column + a.columns && row >= a.row && row < a.row + a.rows;

/** Every cell of `box` lies in a region of its layer, so the growth leaves none of them blank. */
function filledIn(box: LayoutRegion, regions: readonly LayoutRegion[]): boolean {
  const layer = regions.filter((r) => (r.layer ?? 0) === (box.layer ?? 0));
  for (let row = box.area.row; row < box.area.row + box.area.rows; row++) {
    for (let column = box.area.column; column < box.area.column + box.area.columns; column++) {
      if (!layer.some((r) => holds(r.area, column, row))) return false;
    }
  }
  return true;
}

/**
 * The waiting boxes' cells filled by the hero, grown as for a showcase, when that pauses no box
 * still drawn and leaves none of their cells blank (contracts/screen.md, The hero fills first);
 * else null, for the hand-over. A neighbour that took the cells instead stretched a box
 * made for three numbers over two thirds of the screen around one, and squeezed the hero into a
 * strip without its label (v8 rule 5). The hero grows within the drawn boxes' band only, so a
 * waiting box beyond that band would be left blank, not filled: its neighbour takes it then.
 */
function filledByHero(
  kept: readonly LayoutRegion[],
  waiting: readonly LayoutRegion[],
  input: BuildInput,
): readonly LayoutRegion[] | null {
  if (waiting.length === 0) return null;
  const filled = grown(kept, input.zone.regions);
  if (filled === null || filled.length !== kept.length) return null;
  return waiting.every((w) => filledIn(w, filled)) ? filled : null;
}

/**
 * Who takes the room (contracts/screen.md, A showcase goes first): a showcase the zone lets grow
 * grows the hero to the showcase size (sheet 10); one that plays at its size leaves the hero as
 * it is, so the waiting boxes hand over, since giving it their cells would grow it after all; only
 * without a showcase does the hero fill the waiting boxes' cells. Null: the hero keeps its size.
 */
function roomFor(
  kept: readonly LayoutRegion[],
  waiting: readonly LayoutRegion[],
  input: BuildInput,
): readonly LayoutRegion[] | null {
  if (input.showcase === "grow") return grown(kept, input.zone.regions);
  if (input.showcase === "keep") return null;
  return filledByHero(kept, waiting, input);
}

export function buildRegions(input: BuildInput): { layout: Layout; regions: RegionView[] } {
  const layout = chooseLayout({
    windowLayoutId: input.windowLayoutId,
    zoneLayoutId: input.zone.layoutId,
    themeLayouts: input.themeLayouts,
    portrait: input.portrait,
  });
  // The zone's boxes first, then the trade, then the waiting boxes leave, then the hero grows or,
  // when it does not, the waiting boxes' hand-over; parts last (contracts/screen.md, Order).
  const boxes = placedBoxes(layout, input.zone.layoutId, input.zone.regions);
  const swapped = traded(boxes, input.zone.regions, input.zone.heroRegion ?? null);
  const waiting = new Set(swapped.filter((r) => waits(r, input)).map((r) => r.id));
  const kept = swapped.filter((r) => !waiting.has(r.id));
  const growth = roomFor(
    kept,
    swapped.filter((r) => waiting.has(r.id)),
    input,
  );
  const placed = growth ?? handedOver(swapped, waiting);
  const regions = placed.flatMap((r) => regionsOf(r, layout, input));
  return {
    layout,
    regions: [
      ...regions,
      synthetic("_full", layout, input.facts.now),
      synthetic("_overlay", layout, input.facts.now),
    ],
  };
}
