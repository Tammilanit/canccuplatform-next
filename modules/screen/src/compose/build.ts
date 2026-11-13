/**
 * The composed state's regions (contracts/screen.md, The Pulse options and Composed state): a
 * pure function of the zone, the layout and what the sources said, so every screen of a zone
 * gets the same answer and the rules are tested without a stack.
 */
import { placedBoxes } from "./boxes.js";
import type { Claim } from "./claims.js";
import { chooseLayout, roleOf } from "./layouts.js";
import type { Area, Layout, LayoutRegion, Props, Role, WidgetEntry } from "./layouts.js";
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
  /** The hero grows for a showcase (src/compose/showcase.ts); the caller decides when. */
  grow?: boolean;
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

export interface RegionView {
  id: string;
  role: Role | null;
  area: Area;
  layer: number;
  rotation: "sequence" | "shuffle";
  order: number[];
  cycle_started_at: string;
  idle: Idle;
  idle_view: { widget: "countdown"; view: View } | null;
  widgets: WidgetView[];
  /** Placed afterwards, from the zone's active overrides (claims.ts). */
  claim: Claim | null;
}

export const DEFAULT_DWELL_S = 15;
const IDLES: readonly Idle[] = ["logo", "blank", "collapse", "next"];

const clampDwell = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value)
    ? Math.min(3600, Math.max(5, value))
    : undefined;

/**
 * The widget a region shows at `nowMs`, or null when none takes part. A state's `order` is only
 * its own cycle's: later cycles follow the epoch, and a shuffle reshuffles each cycle with the
 * seed `region()` uses, as the player does between pushes (player/src/rotation.ts).
 */
export function shownAt(
  region: Pick<RegionView, "id" | "rotation" | "order" | "widgets">,
  zoneKey: string,
  nowMs: number,
): WidgetView | null {
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
    if (nowMs < end) return region.widgets[i] ?? null;
  }
  return null;
}

const idleOf = (setting: Record<string, unknown>): Idle =>
  IDLES.includes(setting.idle as Idle) ? (setting.idle as Idle) : "logo";

/** The zone's widgets for a region, else the layout's. */
const entriesOf = (source: LayoutRegion, input: BuildInput): WidgetEntry[] => {
  const widgets = input.zone.regions[source.id]?.widgets;
  return Array.isArray(widgets) ? (widgets as WidgetEntry[]) : source.widgets;
};

/** A box of statistics still waiting for its source (waiting.ts). */
function waits(source: LayoutRegion, input: BuildInput): boolean {
  return isWaiting(
    entriesOf(source, input),
    idleOf(input.zone.regions[source.id] ?? {}),
    (e) => viewOf(e.widget, e.props ?? {}, input.facts, e.embed ?? null).empty,
  );
}

/** A region as the zone sets it, drawn whole or as its parts. */
function regionsOf(source: LayoutRegion, layout: Layout, input: BuildInput): RegionView[] {
  const setting = input.zone.regions[source.id] ?? {};
  const entries = entriesOf(source, input);
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
  const rotation = setting.rotation === "shuffle" ? "shuffle" : "sequence";
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
        : sequence,
    cycle_started_at: new Date(cycle * cycleMs).toISOString(),
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
    idle: "blank",
    idle_view: null,
    widgets: [],
    claim: null,
  };
}

export function buildRegions(input: BuildInput): { layout: Layout; regions: RegionView[] } {
  const layout = chooseLayout({
    windowLayoutId: input.windowLayoutId,
    zoneLayoutId: input.zone.layoutId,
    themeLayouts: input.themeLayouts,
    portrait: input.portrait,
  });
  // The zone's boxes first, then the trade, then the waiting boxes leave, then the growth or, when
  // the hero does not grow, the waiting boxes' hand-over; parts last (contracts/screen.md, Order).
  const boxes = placedBoxes(layout, input.zone.layoutId, input.zone.regions);
  const swapped = traded(boxes, input.zone.regions, input.zone.heroRegion ?? null);
  const waiting = new Set(swapped.filter((r) => waits(r, input)).map((r) => r.id));
  const kept = swapped.filter((r) => !waiting.has(r.id));
  const growth = input.grow === true ? grown(kept, input.zone.regions) : kept;
  const placed = growth !== kept ? growth : handedOver(swapped, waiting);
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
