/**
 * The composed state as the player keeps it (contracts/screen.md, `ScreenState`), and the push
 * messages that change it in place. Only the fields the player reads are typed; the rest travel
 * along for the renderer.
 */

export interface Region {
  id: string;
  widgets: { widget: string; view: unknown }[];
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
  regions: Region[];
  ticker: unknown;
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
  view?: unknown;
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
    widgets[index] = { ...widget, view: data.view };
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
