/**
 * A zone's composed part, the same for every screen of the zone, and the hub's `NowView` of it
 * (contracts/screen.md, Composed state). A device's own `ScreenState` (its `device` and `sound`)
 * is put together from the stored zone part in src/push/device-state.ts.
 */
import { createHash } from "node:crypto";
import type { Bus, Logger, SqlClient, TenantContext } from "@canccu/kit";
import type { Db } from "../db.js";
import { loadAgendaItems } from "../content/agenda.js";
import { healthOf } from "../health.js";
import type { Settings } from "../health.js";
import type { Kv } from "../kv.js";
import type { Orientation, ZoneStore } from "../push/store.js";
import { resolveWinner } from "../schedule/winner.js";
import { loadWindows } from "../tick/content.js";
import { tickerNow } from "../ticker/store.js";
import { showsName } from "./zone-reads.js";
import { buildRegions } from "./build.js";
import { stageOf } from "./stage.js";
import type { ArtCache } from "../stage/art.js";
import { themeColors } from "../stage/scrim.js";
import { placeClaims } from "./claims.js";
import type { Override, Placement } from "./claims.js";
import { contentFacts, entriesOf, photoProps } from "./content.js";
import { NO_DISPLAY, displayOf, phaseSource } from "./display.js";
import type { Display } from "./display.js";
import type { MotionLevel } from "./motion.js";
import { themeLayouts } from "./layouts.js";
import type { Layout } from "./layouts.js";
import { loadOverrides } from "./overrides.js";
import { highlightOf } from "./features.js";
import { isShowcase } from "./showcase.js";
import type { HeaderMode, HubQrMode } from "./parts.js";
import { readPin } from "../pins/store.js";
import { themeFor } from "../pins/look.js";
import type { Sources, ThemeNow } from "./sources.js";
import type { ZoneFacts } from "./widgets.js";
import { agendaAt, lookFor } from "../preview/look.js";
import type { DraftUse, PreviewLook } from "../preview/look.js";

export { placement, showsName } from "./zone-reads.js";

export interface ComposeDeps {
  db: Db;
  kv: Kv;
  sources: Sources;
  settings: Settings;
  bundleVersion: string;
  /** Each zone's state and change log (src/push/store.ts). */
  zones: ZoneStore;
  /** The stage's game art (src/stage/art.ts); none in the pure tests. */
  art?: ArtCache;
  /** For `screen.claims.changed`; none in the pure tests. */
  bus?: Pick<Bus, "publish">;
  log?: Logger;
  now?: () => number;
}

export interface ZoneRow {
  key: string;
  name: string;
  layout_id: string | null;
  regions: Record<string, Record<string, unknown>>;
  header: HeaderMode | null;
  hub_qr: HubQrMode;
  /** Absent in a preview stored before the setting: `auto`. */
  screen_name?: "auto" | "always" | "never";
  hero_region: string | null;
  grow_for_showcase: boolean;
  /** Absent in a preview stored before the setting: no pin. */
  motion_level?: MotionLevel | null;
  sound: { enabled: boolean; device_id: string | null };
  epoch: string;
}

/** Until theming serves a revision (the pinned one or the current), the platform defaults. */
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
    `SELECT key, name, layout_id, regions, header, hub_qr, screen_name, hero_region, grow_for_showcase,
       motion_level, sound, epoch
     FROM screen_zones WHERE key = $1`,
    [key],
  );
  return (rows[0] as ZoneRow | undefined) ?? null;
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

/** One orientation's layout, its regions with their claims, and where the claims went. */
export interface ZoneView extends Placement {
  layout: Layout;
}

export interface ZoneComposed {
  /** Fingerprint of the zone's inputs, the same for every screen of the zone (see zoneFingerprint). */
  fingerprint: string;
  zone: ZoneRow;
  /** Whether the header names the zone (`zone.show_name`). */
  showName: boolean;
  theme: ThemeNow;
  /** The pinned bundle version, or null for the platform's. */
  bundle: string | null;
  eventName: string;
  /** Landscape and portrait screens of a zone differ in the layout, its regions and so its claims. */
  views: Record<Orientation, ZoneView>;
  ticker: ZoneFacts["ticker"] & { appearance: string };
  display: Display;
  /** When a content widget next changes by itself (epoch ms), or null. */
  nextChangeAt: number | null;
  /** Whether a preview's draft was drawn (PreviewLook.themeKey); `none` without one. */
  draft: DraftUse;
}

/** The widget types a zone's regions show, in either orientation. */
function typesOf(views: ZoneComposed["views"]): Set<string> {
  const types = new Set<string>();
  for (const view of Object.values(views)) {
    for (const r of view.regions) for (const w of r.widgets) types.add(w.widget);
  }
  return types;
}

/**
 * Everything of a zone's state that is the same for all its screens, in both orientations.
 * `proposed` stands in for the saved zone (a preview), so it composes even a key no zone has yet.
 */
export async function composeZone(
  deps: ComposeDeps,
  ctx: TenantContext,
  host: string,
  zoneKey: string,
  proposed?: ZoneRow,
  /** False for the hub's view, which drops every content widget anyway (NOW_TYPES). */
  withContent = true,
  preview: PreviewLook = {},
): Promise<ZoneComposed | null> {
  const real = new Date((deps.now ?? Date.now)());
  // Claims, pushes, the ticker and the live sources stay as they are now: nobody knows them ahead.
  const at = preview.at == null ? real : new Date(preview.at);
  const read = await deps.db.tenant(async (c) => {
    const zone = proposed ?? (await zoneRow(c, zoneKey));
    if (zone === null) return null;
    return {
      zone,
      windowLayout: await windowLayoutId(c, zone.key, ctx.time_zone, at),
      ticker: await tickerNow(c, ctx.time_zone, real.getTime()),
      claims: await loadOverrides(c, zone.key, real.getTime()),
      pin: await readPin(c),
      showName: await showsName(c, zone),
    };
  });
  if (read === null) return null;
  const [live, event, agenda, venue] = await Promise.all([
    themeFor(deps.sources, ctx.tenant_id, read.pin),
    deps.sources.event(host),
    preview.at == null
      ? deps.sources.agendaNow(ctx.tenant_id, zoneKey)
      : agendaAt(deps.sources, ctx.tenant_id, zoneKey, at.getTime()),
    deps.sources.venueInfo(ctx.tenant_id),
  ]);
  const { theme, draft } = await lookFor(deps.sources, ctx.tenant_id, live, preview.themeKey);
  const eventName = event?.name ?? ctx.primary_hostname ?? "";
  // The phase and the highlight come before the build: the hero's features read them.
  const items = phaseSource((await deps.sources.agendaDay?.(ctx.tenant_id)) ?? null, agenda, zoneKey);
  const { display, motion } = displayOf({
    tokens: theme?.tokens,
    items,
    pin: read.zone.motion_level ?? null,
    settings: deps.settings,
    at: at.getTime(),
  });
  const facts: ZoneFacts = {
    now: at,
    timeZone: ctx.time_zone,
    origin: origin(ctx, host),
    eventName,
    logoUrl: theme?.logo_url ?? null,
    agenda,
    venue,
    ticker: read.ticker,
    embeds: theme?.embeds ?? [],
    phase: motion.phase,
    highlight: highlightOf(items, at.getTime()),
  };
  const build = (portrait: boolean): ZoneView => {
    const once = (grow: boolean): ZoneView => {
      const { layout, regions } = buildRegions({
        zone: {
          key: read.zone.key,
          layoutId: read.zone.layout_id,
          regions: read.zone.regions,
          header: read.zone.header,
          hubQr: read.zone.hub_qr,
          heroRegion: read.zone.hero_region,
        },
        windowLayoutId: read.windowLayout,
        themeLayouts: themeLayouts(theme?.layouts),
        portrait,
        facts,
        grow,
      });
      return { layout, ...placeClaims(regions, read.claims) };
    };
    const plain = once(false);
    // A claim's place follows roles alone, so the grown build places every claim as this one did.
    return read.zone.grow_for_showcase && isShowcase(plain.regions) ? once(true) : plain;
  };
  let views = { landscape: build(false), portrait: build(true) };
  // The content widgets' sources are read only for a zone that shows them, so their changes
  // (every frame, photo and code) never move another zone's version. The hub's view keeps only
  // `stats` of them (NOW_TYPES).
  const entries = entriesOf(Object.values(views), read.zone.regions);
  const used = typesOf(views);
  for (const e of entries) used.add(e.widget);
  if (!withContent) for (const type of used) if (type !== "stats") used.delete(type);
  const content = await contentFacts(deps, ctx, zoneKey, used, photoProps(entries), real.getTime());
  if (Object.keys(content.facts).length > 0) {
    Object.assign(facts, content.facts);
    views = { landscape: build(false), portrait: build(true) };
  }
  const setting = deps.settings.get("ticker_appearance", "default");
  const appearance = typeof setting === "string" ? setting : "default";
  const { stage, covers } = await stageOf({
    views,
    phase: motion.phase,
    agenda,
    nowMs: at.getTime(),
    stageArt: deps.settings.get("stage_art", true) !== false,
    colors: themeColors(theme?.tokens),
    hostname: ctx.primary_hostname ?? host,
    art: deps.art,
  });
  display.stage = stage;
  // The level's next change and a tint's end rebuild the zone then, as a content widget's does.
  const tintEnds = stage.tint === null ? null : Date.parse(stage.tint.until);
  const changes = [content.changesAt, motion.next?.at, tintEnds].filter((t) => t != null);
  return {
    fingerprint: zoneFingerprint({
      zone: read.zone,
      windowLayoutId: read.windowLayout,
      theme: { revision: theme?.revision ?? 0, layouts: theme?.layouts ?? [] },
      facts,
      tickerAppearance: appearance,
      display,
      claims: read.claims,
      bundle: read.pin.bundle_version,
      showName: read.showName,
      art: covers,
    }),
    zone: read.zone,
    showName: read.showName,
    bundle: read.pin.bundle_version,
    theme: theme ?? NO_THEME,
    eventName,
    views,
    ticker: { ...read.ticker, appearance },
    display,
    nextChangeAt: changes.length === 0 ? null : Math.min(...changes),
    draft,
  };
}

export interface FingerprintInput {
  zone: ZoneRow;
  windowLayoutId: string | null;
  theme: { revision: number; layouts: unknown[] };
  facts: ZoneFacts;
  tickerAppearance?: string;
  /** Holds the `burn_in_drift` setting and the energy level, which no other input carries. */
  display?: Display;
  /** The overrides active on the zone now: one that ends changes the inputs, so it is drawn away. */
  claims?: readonly Override[];
  /** The pinned bundle: a pin change moves the version, so streams send the new `bundle`. */
  bundle?: string | null;
  /** Moves with the event's count of screens, which no other input carries. */
  showName?: boolean;
  /** The cards' and the tint's art read (compose/stage.ts): a cover read only later moves it. */
  art?: readonly string[];
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
    claims: input.claims ?? [],
    bundle: input.bundle ?? null,
    show_name: input.showName ?? true,
    art: input.art ?? [],
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
  const composed = await composeZone(deps, ctx, host, zoneKey, undefined, false);
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
