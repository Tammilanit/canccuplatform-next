/**
 * The composed state's regions (contracts/screen.md, The Pulse options and Composed state): a
 * pure function of the zone, the layout and what the sources said, so every screen of a zone
 * gets the same answer and the rules are tested without a stack.
 */
import { chooseLayout, roleOf } from "./layouts.js";
import type { Area, Layout, LayoutRegion, Props, Role, WidgetEntry } from "./layouts.js";
import { partsOf } from "./parts.js";
import type { HeaderMode, HubQrMode, Part } from "./parts.js";
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
}

export interface BuildInput {
  zone: ZoneSetup;
  windowLayoutId: string | null;
  themeLayouts: readonly Layout[];
  portrait: boolean;
  facts: ZoneFacts;
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
  claim: null;
}

const DEFAULT_DWELL_S = 15;
const IDLES: readonly Idle[] = ["logo", "blank", "collapse", "next"];

const clampDwell = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value)
    ? Math.min(3600, Math.max(5, value))
    : undefined;

/** mulberry32 over a string hash: small, and the same in every container and every reload. */
function seeded(seed: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(order: number[], seed: string): number[] {
  const out = [...order];
  const random = seeded(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as number, out[i] as number];
  }
  return out;
}

/** A region as the zone sets it, drawn whole or as its parts. */
function regionsOf(source: LayoutRegion, layout: Layout, input: BuildInput): RegionView[] {
  const setting = input.zone.regions[source.id] ?? {};
  const entries = Array.isArray(setting.widgets)
    ? (setting.widgets as WidgetEntry[])
    : source.widgets;
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
  const idle = IDLES.includes(setting.idle as Idle) ? (setting.idle as Idle) : "logo";
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
  const regions = layout.regions.flatMap((r) => regionsOf(r, layout, input));
  return {
    layout,
    regions: [
      ...regions,
      synthetic("_full", layout, input.facts.now),
      synthetic("_overlay", layout, input.facts.now),
    ],
  };
}
