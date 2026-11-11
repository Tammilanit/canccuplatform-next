/**
 * A zone's composed part, the same for every screen of the zone, and the hub's `NowView` of it
 * (contracts/screen.md, Composed state). A device's own `ScreenState` (its `device` and `sound`)
 * is put together from the stored zone part in src/push/device-state.ts.
 */
import { createHash } from "node:crypto";
import type { SqlClient, TenantContext } from "@canccu/kit";
import type { Db } from "../db.js";
import { loadAgendaItems } from "../content/agenda.js";
import { healthOf } from "../health.js";
import type { Settings } from "../health.js";
import type { Kv } from "../kv.js";
import type { Orientation, ZoneStore } from "../push/store.js";
import { resolveWinner } from "../schedule/winner.js";
import { loadWindows } from "../tick/content.js";
import { tickerNow } from "../ticker/store.js";
import { buildRegions } from "./build.js";
import { displayOf } from "./display.js";
import type { Display } from "./display.js";
import { themeLayouts } from "./layouts.js";
import type { HeaderMode, HubQrMode } from "./parts.js";
import type { Sources, ThemeNow } from "./sources.js";
import type { ZoneFacts } from "./widgets.js";

export interface ComposeDeps {
  db: Db;
  kv: Kv;
  sources: Sources;
  settings: Settings;
  bundleVersion: string;
  /** Each zone's state and change log (src/push/store.ts). */
  zones: ZoneStore;
  now?: () => number;
}

export interface ZoneRow {
  key: string;
  name: string;
  layout_id: string | null;
  regions: Record<string, Record<string, unknown>>;
  header: HeaderMode | null;
  hub_qr: HubQrMode;
  sound: { enabled: boolean; device_id: string | null };
  epoch: string;
}

export const NO_DISPLAY: Display = { motion: "moderate", drift: false };

/** Until theming serves a revision (or the pinned one, #265), the platform defaults. */
export const NO_THEME: ThemeNow = {
  revision: 0,
  tokens_css_url: "/theming/a/tokens.css",
  css_url: null,
  logo_url: null,
  layouts: [],
  templates: [],
};

async function zoneRow(c: SqlClient, key: string): Promise<ZoneRow | null> {
  const { rows } = await c.query(
    "SELECT key, name, layout_id, regions, header, hub_qr, sound, epoch FROM screen_zones WHERE key = $1",
    [key],
  );
  return (rows[0] as ZoneRow | undefined) ?? null;
}

/** The zone a device draws, and whether it only mirrors it (one hop: a mirror of a mirror shows nothing). */
export async function placement(
  c: SqlClient,
  deviceId: string,
): Promise<{ zoneKey: string | null; mirror: boolean }> {
  const { rows } = await c.query(
    `SELECT a.zone_key, a.mirror_device_id, a.mirror_zone_key, t.zone_key AS target_zone
     FROM screen_assignments a LEFT JOIN screen_assignments t ON t.device_id = a.mirror_device_id
     WHERE a.device_id = $1`,
    [deviceId],
  );
  const row = rows[0] as Record<string, string | null> | undefined;
  if (row === undefined) return { zoneKey: null, mirror: false };
  if (row.mirror_zone_key) return { zoneKey: row.mirror_zone_key, mirror: true };
  if (row.mirror_device_id) return { zoneKey: row.target_zone ?? null, mirror: true };
  return { zoneKey: row.zone_key ?? null, mirror: false };
}

async function windowLayoutId(
  c: SqlClient,
  zone: string,
  tz: string,
  at: Date,
): Promise<string | null> {
  const [windows, agendaItems, priorities] = await Promise.all([
    loadWindows(c, zone),
    loadAgendaItems(c),
    c.query("SELECT id, priority FROM screen_playlists"),
  ]);
  const playlistPriorities = new Map(
    priorities.rows.map((r) => [r.id as string, r.priority as number]),
  );
  return (
    resolveWinner({ windows, timeZone: tz, agendaItems, playlistPriorities }, at)?.layoutId ?? null
  );
}

const origin = (ctx: TenantContext, host: string): string =>
  ctx.primary_hostname === null ? `http://${host}` : `https://${ctx.primary_hostname}`;

export interface ZoneComposed {
  /** Fingerprint of the zone's inputs, the same for every screen of the zone (see zoneFingerprint). */
  fingerprint: string;
  zone: ZoneRow;
  theme: ThemeNow;
  eventName: string;
  /** Landscape and portrait screens of a zone differ only in the layout and its regions. */
  views: Record<Orientation, ReturnType<typeof buildRegions>>;
  ticker: ZoneFacts["ticker"] & { appearance: string };
  display: Display;
}

/** Everything of a zone's state that is the same for all its screens, in both orientations. */
export async function composeZone(
  deps: ComposeDeps,
  ctx: TenantContext,
  host: string,
  zoneKey: string,
): Promise<ZoneComposed | null> {
  const at = new Date((deps.now ?? Date.now)());
  const read = await deps.db.tenant(async (c) => {
    const zone = await zoneRow(c, zoneKey);
    if (zone === null) return null;
    return {
      zone,
      windowLayout: await windowLayoutId(c, zone.key, ctx.time_zone, at),
      ticker: await tickerNow(c, ctx.time_zone, at.getTime()),
    };
  });
  if (read === null) return null;
  const [theme, event, agenda, venue] = await Promise.all([
    deps.sources.theme(ctx.tenant_id),
    deps.sources.event(host),
    deps.sources.agendaNow(ctx.tenant_id, zoneKey),
    deps.sources.venueInfo(ctx.tenant_id),
  ]);
  const eventName = event?.name ?? ctx.primary_hostname ?? "";
  const facts: ZoneFacts = {
    now: at,
    timeZone: ctx.time_zone,
    origin: origin(ctx, host),
    eventName,
    logoUrl: theme?.logo_url ?? null,
    agenda,
    venue,
    ticker: read.ticker,
  };
  const build = (portrait: boolean) =>
    buildRegions({
      zone: {
        key: read.zone.key,
        layoutId: read.zone.layout_id,
        regions: read.zone.regions,
        header: read.zone.header,
        hubQr: read.zone.hub_qr,
      },
      windowLayoutId: read.windowLayout,
      themeLayouts: themeLayouts(theme?.layouts),
      portrait,
      facts,
    });
  const setting = deps.settings.get("ticker_appearance", "default");
  const appearance = typeof setting === "string" ? setting : "default";
  const display = displayOf(theme?.tokens, agenda, deps.settings.get("burn_in_drift", false));
  return {
    fingerprint: zoneFingerprint({
      zone: read.zone,
      windowLayoutId: read.windowLayout,
      theme: { revision: theme?.revision ?? 0, layouts: theme?.layouts ?? [] },
      facts,
      tickerAppearance: appearance,
      display,
    }),
    zone: read.zone,
    theme: theme ?? NO_THEME,
    eventName,
    views: { landscape: build(false), portrait: build(true) },
    ticker: { ...read.ticker, appearance },
    display,
  };
}

export interface FingerprintInput {
  zone: ZoneRow;
  windowLayoutId: string | null;
  theme: { revision: number; layouts: unknown[] };
  facts: ZoneFacts;
  tickerAppearance?: string;
  /** Holds the `burn_in_drift` setting, which no other input carries. */
  display?: Display;
}

/**
 * What a zone's screens draw is a function of these inputs, the time and the screen's
 * orientation. Hashing the inputs rather than the output keeps time (the clock, cycles, shuffled
 * orders) and orientation out, so landscape and portrait screens of one zone share one version
 * and only an edit or a source's change moves it.
 */
export function zoneFingerprint(input: FingerprintInput): string {
  const stable = {
    zone: input.zone,
    window: input.windowLayoutId,
    theme: input.theme,
    facts: { ...input.facts, now: null },
    ticker: input.tickerAppearance ?? "default",
    display: input.display ?? NO_DISPLAY,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("base64url");
}

export async function isPortrait(kv: Kv, deviceId: string, nowMs: number): Promise<boolean> {
  const view = (await healthOf(kv, [deviceId], nowMs)).get(deviceId);
  const viewport = view?.viewport as { width: number; height: number } | undefined;
  return viewport !== undefined && viewport.height > viewport.width;
}

export const themeView = (t: ThemeNow): Record<string, unknown> => ({
  revision: t.revision,
  tokens_css_url: t.tokens_css_url,
  css_url: t.css_url,
  logo_url: t.logo_url,
  templates: t.templates,
});

/**
 * The widget types the hub may see (contracts/screen.md, One source, two surfaces). Never
 * `checkin_qr`: its rotating code proves presence at the venue only while it stays on the screen.
 */
export const NOW_TYPES = new Set([
  "clock",
  "agenda_now",
  "countdown",
  "hot_game",
  "bracket",
  "leaderboard",
  "announcement",
  "ticker",
  "food_status",
  "stats",
  "now_playing",
]);

export async function nowView(
  deps: ComposeDeps,
  ctx: TenantContext,
  host: string,
  zoneKey: string,
  member: boolean,
): Promise<Record<string, unknown> | null> {
  const composed = await composeZone(deps, ctx, host, zoneKey);
  if (composed === null) return null;
  const regions = composed.views.landscape.regions.map((r) => {
    const kept = r.widgets.flatMap((w, i) => (NOW_TYPES.has(w.widget) ? [{ w, i }] : []));
    const index = new Map(kept.map(({ i }, n) => [i, n]));
    return {
      ...r,
      order: r.order.flatMap((i) => (index.has(i) ? [index.get(i) as number] : [])),
      widgets: kept.map(({ w }) =>
        // `now_playing` names go to signed-in members only (the bot gives them to no guest).
        w.widget === "now_playing" && !member ? { ...w, view: { ...w.view, names: undefined } } : w,
      ),
    };
  });
  return {
    time: new Date((deps.now ?? Date.now)()).toISOString(),
    zone: { key: composed.zone.key, name: composed.zone.name },
    regions,
    ticker: composed.ticker,
  };
}
