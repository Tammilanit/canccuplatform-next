/**
 * `ScreenState` for one device, and the hub's `NowView` of one zone (contracts/screen.md,
 * Composed state). The zone's part is the same for every screen of the zone; only `device` and
 * `sound` are the device's own.
 */
import { createHash } from "node:crypto";
import { tenantKey } from "@canccu/kit";
import type { SqlClient, TenantContext } from "@canccu/kit";
import type { Db, DeviceRow } from "../db.js";
import { loadAgendaItems } from "../content/agenda.js";
import { healthOf } from "../health.js";
import type { Settings } from "../health.js";
import type { Kv } from "../kv.js";
import { resolveWinner } from "../schedule/winner.js";
import { loadWindows } from "../tick/content.js";
import { tickerNow } from "../ticker/store.js";
import { buildRegions } from "./build.js";
import type { RegionView } from "./build.js";
import { themeLayouts } from "./layouts.js";
import type { Sources, ThemeNow } from "./sources.js";
import type { ZoneFacts } from "./widgets.js";

export interface ComposeDeps {
  db: Db;
  kv: Kv;
  sources: Sources;
  settings: Settings;
  bundleVersion: string;
  now?: () => number;
}

interface ZoneRow {
  key: string;
  name: string;
  layout_id: string | null;
  regions: Record<string, Record<string, unknown>>;
  sound: { enabled: boolean; device_id: string | null };
  epoch: string;
}

/** Until theming serves a revision (or the pinned one, #265), the platform defaults. */
const NO_THEME: ThemeNow = {
  revision: 0,
  tokens_css_url: "/theming/a/tokens.css",
  css_url: null,
  logo_url: null,
  layouts: [],
  templates: [],
};

async function zoneRow(c: SqlClient, key: string): Promise<ZoneRow | null> {
  const { rows } = await c.query(
    "SELECT key, name, layout_id, regions, sound, epoch FROM screen_zones WHERE key = $1",
    [key],
  );
  return (rows[0] as ZoneRow | undefined) ?? null;
}

/** The zone a device draws, and whether it only mirrors it (one hop: a mirror of a mirror shows nothing). */
async function placement(
  c: SqlClient,
  deviceId: string,
): Promise<{ zoneKey: string | null; mirror: boolean }> {
  const { rows } = await c.query(
    `SELECT a.zone_key, a.mirror_device_id, a.mirror_zone_key, t.zone_key AS target_zone
     FROM assignments a LEFT JOIN assignments t ON t.device_id = a.mirror_device_id
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

interface ZoneComposed {
  zone: ZoneRow;
  theme: ThemeNow;
  eventName: string;
  layout: ReturnType<typeof buildRegions>["layout"];
  regions: RegionView[];
  ticker: ZoneFacts["ticker"] & { appearance: string };
}

/** Everything of a zone's state that is the same for all its screens. */
export async function composeZone(
  deps: ComposeDeps,
  ctx: TenantContext,
  host: string,
  zoneKey: string,
  portrait: boolean,
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
    deps.sources.theme(host),
    deps.sources.event(host),
    deps.sources.agendaNow(host, zoneKey),
    deps.sources.venueInfo(host),
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
  const built = buildRegions({
    zone: { key: read.zone.key, layoutId: read.zone.layout_id, regions: read.zone.regions },
    windowLayoutId: read.windowLayout,
    themeLayouts: themeLayouts(theme?.layouts),
    portrait,
    facts,
  });
  const appearance = deps.settings.get("ticker_appearance", "default");
  return {
    zone: read.zone,
    theme: theme ?? NO_THEME,
    eventName,
    ...built,
    ticker: { ...read.ticker, appearance: typeof appearance === "string" ? appearance : "default" },
  };
}

/**
 * `state_version` moves when what a screen draws changes, not when time passes: the clock's
 * view-model and the rotation's cycle are left out of the fingerprint. The push slice (#304)
 * replaces this with its change log, which bumps the version atomically.
 */
async function stateVersion(kv: Kv, key: string, composed: ZoneComposed): Promise<number> {
  const stable = {
    layout: composed.layout.id,
    theme: composed.theme.revision,
    ticker: composed.ticker,
    regions: composed.regions.map((r) => ({
      ...r,
      cycle_started_at: null,
      widgets: r.widgets.map((w) => (w.widget === "clock" ? { ...w, view: null } : w)),
    })),
  };
  const hash = createHash("sha256").update(JSON.stringify(stable)).digest("base64url");
  const kept = await kv.get(key);
  const [version, seen] = kept === null ? [0, ""] : (JSON.parse(kept) as [number, string]);
  if (seen === hash) return version;
  await kv.set(key, JSON.stringify([version + 1, hash]), 7 * 24 * 3600_000);
  return version + 1;
}

async function isPortrait(kv: Kv, deviceId: string, nowMs: number): Promise<boolean> {
  const view = (await healthOf(kv, [deviceId], nowMs)).get(deviceId);
  const viewport = view?.viewport as { width: number; height: number } | undefined;
  return viewport !== undefined && viewport.height > viewport.width;
}

const themeView = (t: ThemeNow): Record<string, unknown> => ({
  revision: t.revision,
  tokens_css_url: t.tokens_css_url,
  css_url: t.css_url,
  logo_url: t.logo_url,
  templates: t.templates,
});

export async function deviceState(
  deps: ComposeDeps,
  ctx: TenantContext,
  host: string,
  device: DeviceRow,
): Promise<Record<string, unknown>> {
  const nowMs = (deps.now ?? Date.now)();
  const where = await deps.db.tenant((c) => placement(c, device.id));
  const composed =
    where.zoneKey === null
      ? null
      : await composeZone(
          deps,
          ctx,
          host,
          where.zoneKey,
          await isPortrait(deps.kv, device.id, nowMs),
        );
  const theme = composed?.theme ?? (await deps.sources.theme(host)) ?? NO_THEME;
  const eventName = composed?.eventName ?? (await deps.sources.event(host))?.name ?? "";
  const version =
    composed === null
      ? 0
      : await stateVersion(
          deps.kv,
          tenantKey("screen", "zone", composed.zone.key, "version"),
          composed,
        );
  const sound = composed?.zone.sound;
  return {
    state_version: version,
    time: new Date(nowMs).toISOString(),
    tenant: { id: ctx.tenant_id, name: eventName, time_zone: ctx.time_zone, status: ctx.status },
    device: { id: device.id, name: device.name, mirror: where.mirror },
    zone:
      composed === null
        ? null
        : { key: composed.zone.key, name: composed.zone.name, epoch: composed.zone.epoch },
    bundle: { version: deps.bundleVersion },
    theme: themeView(theme),
    layout: composed?.layout ?? null,
    regions: composed?.regions ?? [],
    unplaced: [],
    hidden: [],
    ticker: composed?.ticker ?? { text: null, until: null, source: null },
    // Only the zone's sound device plays sound; a mirror never does (contracts/screen.md, Zones).
    sound: {
      enabled: !where.mirror && sound?.enabled === true && sound.device_id === device.id,
      // Kept for Moments (step 4): the heartbeat's claims_sounded are dropped until then.
      sounded_claims: [],
    },
    prefetch: [],
    offline: { marker_after_seconds: 10 },
  };
}

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
  const composed = await composeZone(deps, ctx, host, zoneKey, false);
  if (composed === null) return null;
  const regions = composed.regions.map((r) => {
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
