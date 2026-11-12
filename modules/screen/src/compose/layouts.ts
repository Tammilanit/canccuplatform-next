/**
 * Which layout a zone draws and the role of each region (contracts/screen.md, Layouts and
 * regions). Layouts are theming data in the theme.schema.json `layout` shape; the built-ins are
 * used while the theme has none of that id.
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
  /** The theme's default for its header regions (theme.schema.json `layout.header`). */
  header?: "separate" | "shared";
  regions: LayoutRegion[];
}

const at = (column: number, row: number, columns: number, rows: number): Area => ({
  column,
  row,
  columns,
  rows,
});
const w = (...types: string[]): WidgetEntry[] => types.map((widget) => ({ widget }));

// The hub QR is a widget of its own, so it stays on the venue rail when the venue has nothing to
// show or its read fails (one hub QR per screen, plan U4); `checkin_qr` is left to the zones that
// want it, because check-in is never mandatory (0027) and a built-in would put it on every screen.
const VENUE_RAIL: WidgetEntry[] = [
  { widget: "qr", props: { url: "/notify/", label: "The event hub" } },
  { widget: "venue_info" },
  { widget: "food_status" },
];
const HERO = w("playlist", "hot_game", "bracket", "photo");
const RAIL = w("agenda_now", "countdown");

const HEADER = (): LayoutRegion => ({
  id: "header",
  area: at(1, 1, 12, 1),
  widgets: w("logo", "clock"),
});
const TICKER = (): LayoutRegion => ({
  id: "ticker",
  area: at(1, 12, 12, 1),
  layer: 1,
  widgets: w("ticker"),
});
const landscape = (id: string, name: string, regions: LayoutRegion[]): Layout => ({
  id,
  name,
  aspect: "16:9",
  grid: { columns: 12, rows: 12 },
  regions,
});

// The six of contracts/screen.md, Built-in layouts, in the order Studio offers them. Dashboard's
// `stats` and `now_playing` boxes show `empty` until the bot's presence reaches Screen (#389), so
// they follow their idle rule meanwhile.
export const BUILT_IN_LAYOUTS: readonly Layout[] = [
  landscape("pulse", "Pulse", [
    HEADER(),
    { id: "hero", area: at(1, 2, 8, 10), widgets: HERO },
    { id: "rail", area: at(9, 2, 4, 6), widgets: RAIL },
    { id: "venue_rail", area: at(9, 8, 4, 4), widgets: VENUE_RAIL },
    TICKER(),
  ]),
  landscape("dashboard", "Dashboard", [
    HEADER(),
    { id: "hero", area: at(1, 2, 4, 5), widgets: HERO },
    { id: "online", area: at(5, 2, 4, 5), widgets: w("stats") },
    { id: "voice", area: at(9, 2, 4, 5), widgets: w("stats") },
    { id: "top_games", area: at(1, 7, 4, 5), widgets: w("now_playing") },
    { id: "right_now", area: at(5, 7, 4, 5), widgets: w("stats") },
    { id: "rail", area: at(9, 7, 4, 5), widgets: RAIL },
    TICKER(),
  ]),
  landscape("hero", "Hero", [
    HEADER(),
    { id: "hero", area: at(1, 2, 12, 10), widgets: HERO },
    { id: "rail", area: at(1, 12, 12, 1), widgets: w("agenda_now") },
  ]),
  landscape("split", "Split", [
    HEADER(),
    { id: "hero", area: at(1, 2, 7, 10), widgets: HERO },
    { id: "rail", area: at(8, 2, 5, 5), widgets: RAIL },
    { id: "venue_rail", area: at(8, 7, 5, 5), widgets: VENUE_RAIL },
    TICKER(),
  ]),
  landscape("ambient", "Ambient", [
    { id: "header", area: at(1, 1, 12, 1), widgets: w("logo") },
    { id: "hero", area: at(2, 3, 10, 6), widgets: w("clock") },
    { id: "rail", area: at(2, 9, 10, 2), widgets: w("agenda_now") },
  ]),
  {
    id: "pulse_portrait",
    name: "Portrait",
    aspect: "9:16",
    grid: { columns: 6, rows: 16 },
    // The Pulse's boxes stacked (sheet 10): the venue rail fills what was an empty band under the rail.
    regions: [
      { id: "header", area: at(1, 1, 6, 2), widgets: w("logo", "clock") },
      { id: "hero", area: at(1, 3, 6, 6), widgets: HERO },
      { id: "rail", area: at(1, 9, 6, 4), widgets: RAIL },
      { id: "venue_rail", area: at(1, 13, 6, 3), widgets: VENUE_RAIL },
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

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * Theme layouts as theming serves them. Theming validates them against theme.schema.json, but a
 * region without `area` or `widgets` would fail every screen of the zone, so it is dropped here.
 */
export function themeLayouts(value: unknown): Layout[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((l: unknown): Layout[] => {
    if (
      !isObject(l) ||
      typeof l.id !== "string" ||
      !isObject(l.grid) ||
      !Array.isArray(l.regions)
    ) {
      return [];
    }
    const regions = (l.regions as unknown[]).filter(
      (r): r is LayoutRegion =>
        isObject(r) && typeof r.id === "string" && isObject(r.area) && Array.isArray(r.widgets),
    );
    if (regions.length === 0) return [];
    const { header, ...rest } = l as unknown as Layout;
    // An unknown `header` would split or merge by accident; without it the screen's default holds.
    const known = header === "separate" || header === "shared";
    return [{ ...rest, ...(known ? { header } : {}), regions }];
  });
}
