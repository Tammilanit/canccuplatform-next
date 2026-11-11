/**
 * The composed state as the player keeps it (contracts/screen.md, `ScreenState`), and the push
 * messages that change it in place. Only the fields the player reads are typed; the rest travel
 * along for the renderer.
 */

export interface Area {
  column: number;
  row: number;
  columns: number;
  rows: number;
}

export interface WidgetState {
  widget: string;
  template?: string | null;
  dwell_seconds: number;
  view: Record<string, unknown>;
  [field: string]: unknown;
}

export interface Region {
  id: string;
  role: string | null;
  area: Area;
  layer: number;
  rotation: string;
  /** The widgets that take part in the rotation, in this cycle's order. */
  order: number[];
  cycle_started_at: string;
  idle: string;
  idle_view: { widget: string; view: Record<string, unknown> } | null;
  widgets: WidgetState[];
  /** Drawn by the claims slice (#307). */
  claim: unknown;
  [field: string]: unknown;
}

export interface Layout {
  id: string;
  aspect: string;
  grid: { columns: number; rows: number };
  [field: string]: unknown;
}

export interface ScreenState {
  state_version: number;
  time: string;
  tenant: { id: string; name: string; time_zone: string; status: string };
  device: { id: string; name: string; mirror: boolean };
  zone: { key: string; name: string; epoch: string } | null;
  bundle: { version: string };
  theme: {
    revision: number;
    tokens_css_url: string | null;
    css_url: string | null;
    logo_url: string | null;
    [field: string]: unknown;
  };
  layout?: Layout | null;
  regions: Region[];
  ticker: unknown;
  display?: { motion: string; drift: boolean };
  [field: string]: unknown;
}

export function isState(value: unknown): value is ScreenState {
  const v = value as Partial<ScreenState> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.state_version === "number" &&
    typeof v.tenant === "object" &&
    typeof v.device === "object" &&
    typeof v.theme === "object" &&
    Array.isArray(v.regions)
  );
}

interface Patch {
  state_version?: number;
  region_id?: string;
  index?: number;
  view?: Record<string, unknown>;
  region?: Region;
  ticker?: unknown;
  theme?: ScreenState["theme"];
}

/**
 * The state after one `widget`, `region`, `ticker` or `theme` message, or null when the message
 * does not fit the state (an unknown region or widget): the player then reads the whole state, as
 * the server would have sent it had it known.
 */
export function applyPatch(state: ScreenState, event: string, data: Patch): ScreenState | null {
  const next: ScreenState = { ...state };
  if (typeof data.state_version === "number") next.state_version = data.state_version;
  if (event === "widget") {
    const at = state.regions.findIndex((r) => r.id === data.region_id);
    const region = state.regions[at];
    const index = data.index ?? -1;
    const widget = region?.widgets[index];
    if (region === undefined || widget === undefined) return null;
    const widgets = region.widgets.slice();
    widgets[index] = { ...widget, view: data.view ?? {} };
    next.regions = state.regions.slice();
    next.regions[at] = { ...region, widgets };
    return next;
  }
  if (event === "region") {
    const region = data.region;
    if (region === undefined || typeof region.id !== "string") return null;
    const at = state.regions.findIndex((r) => r.id === region.id);
    if (at === -1) return null;
    next.regions = state.regions.slice();
    next.regions[at] = region;
    return next;
  }
  if (event === "ticker") {
    next.ticker = data.ticker ?? null;
    return next;
  }
  if (event === "theme") {
    if (data.theme === undefined) return null;
    next.theme = data.theme;
    return next;
  }
  return null;
}
