/**
 * Which layout a zone draws and the role of each region (contracts/screen.md, Layouts and
 * regions). Layouts are theming data in the theme.schema.json `layout` shape; the two built-ins
 * are used while the theme has none of that id.
 */

export interface Area {
  column: number;
  row: number;
  columns: number;
  rows: number;
}

export type Props = Record<string, string | number | boolean>;

export interface WidgetEntry {
  widget: string;
  template?: string;
  embed?: string;
  props?: Props;
}

export interface LayoutRegion {
  id: string;
  area: Area;
  layer?: number;
  rotate_seconds?: number;
  widgets: WidgetEntry[];
}

export interface Layout {
  id: string;
  name: string;
  aspect: string;
  grid: { columns: number; rows: number };
  regions: LayoutRegion[];
}

const at = (column: number, row: number, columns: number, rows: number): Area => ({
  column,
  row,
  columns,
  rows,
});
const w = (...types: string[]): WidgetEntry[] => types.map((widget) => ({ widget }));

// The venue rail carries the hub QR through `venue_info`; `checkin_qr` is left to the zones that
// want it, because check-in is never mandatory (0027) and a built-in would put it on every screen.
const VENUE_RAIL: WidgetEntry[] = [
  { widget: "venue_info", props: { qr: "auto" } },
  { widget: "food_status" },
];
const HERO = w("playlist", "hot_game", "bracket", "photo");
const RAIL = w("agenda_now", "countdown");

export const BUILT_IN_LAYOUTS: readonly Layout[] = [
  {
    id: "pulse",
    name: "Pulse",
    aspect: "16:9",
    grid: { columns: 12, rows: 12 },
    regions: [
      { id: "header", area: at(1, 1, 12, 1), widgets: w("logo", "clock") },
      { id: "hero", area: at(1, 2, 8, 10), widgets: HERO },
      { id: "rail", area: at(9, 2, 4, 6), widgets: RAIL },
      { id: "venue_rail", area: at(9, 8, 4, 4), widgets: VENUE_RAIL },
      { id: "ticker", area: at(1, 12, 12, 1), layer: 1, widgets: w("ticker") },
    ],
  },
  {
    id: "pulse_portrait",
    name: "Pulse portrait",
    aspect: "9:16",
    grid: { columns: 6, rows: 16 },
    regions: [
      { id: "header", area: at(1, 1, 6, 2), widgets: w("logo", "clock") },
      { id: "hero", area: at(1, 3, 6, 7), widgets: HERO },
      { id: "rail", area: at(1, 10, 6, 6), widgets: RAIL },
      { id: "ticker", area: at(1, 16, 6, 1), widgets: w("ticker") },
    ],
  },
];

/**
 * One rule (plan L6): the schedule window's layout, then the zone's, each looked up in the theme
 * first (a theme layout with a built-in id replaces it) and then the built-ins; an id neither has
 * is skipped, and with none left the orientation's built-in, so a theme change or a stale window
 * never leaves a blank screen.
 */
export function chooseLayout(opts: {
  windowLayoutId: string | null;
  zoneLayoutId: string | null;
  themeLayouts: readonly Layout[];
  portrait: boolean;
}): Layout {
  const find = (id: string | null): Layout | undefined =>
    id === null
      ? undefined
      : (opts.themeLayouts.find((l) => l.id === id) ?? BUILT_IN_LAYOUTS.find((l) => l.id === id));
  const fallback = opts.portrait ? "pulse_portrait" : "pulse";
  return find(opts.windowLayoutId) ?? find(opts.zoneLayoutId) ?? (find(fallback) as Layout);
}

export const ROLES = [
  "full",
  "hero",
  "rail",
  "venue_rail",
  "ticker",
  "header",
  "backdrop",
  "overlay",
] as const;
export type Role = (typeof ROLES)[number];

const ALIASES: Record<string, Role> = { main: "hero", side: "rail" };
// Only the synthetic regions hold these two, so a theme can never make a region a takeover target.
const SYNTHETIC_ONLY = new Set<string>(["full", "overlay"]);

function asRole(value: unknown): Role | null {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
    ? (value as Role)
    : null;
}

/** The zone's setting, then the id itself, then the aliases; `full` and `overlay` never. */
export function roleOf(regionId: string, zoneSetting: unknown): Role | null {
  const role = asRole(zoneSetting) ?? asRole(regionId) ?? ALIASES[regionId] ?? null;
  return role === null || SYNTHETIC_ONLY.has(role) ? null : role;
}

/** Theme layouts as theming serves them; anything not in the layout shape is dropped. */
export function themeLayouts(value: unknown): Layout[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (l): l is Layout =>
      typeof l === "object" &&
      l !== null &&
      typeof (l as Layout).id === "string" &&
      typeof (l as Layout).grid === "object" &&
      Array.isArray((l as Layout).regions),
  );
}
