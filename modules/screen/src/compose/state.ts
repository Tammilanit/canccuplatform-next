/**
 * A zone's composed part, the same for every screen of the zone, and the hub's `NowView` of it
 * (contracts/screen.md, Composed state). A device's own `ScreenState` (its `device` and `sound`)
 * is put together from the stored zone part in src/push/device-state.ts.
 */
import { tickerLook } from "../ticker/look.js";
import type { TickerLook } from "../ticker/look.js";
import type { Bus, Logger, SqlClient, TenantContext } from "@canccu/kit";
import type { Db } from "../db.js";
import { loadAgendaItems } from "../content/agenda.js";
import { healthOf } from "../health.js";
import type { Settings } from "../health.js";
import type { Kv } from "../kv.js";
import type { CountSource, Orientation, ZoneStore } from "../push/store.js";
import { countsOf } from "./stats.js";
import { loadFood } from "./food.js";
import { resolveWinner } from "../schedule/winner.js";
import { loadWindows } from "../tick/content.js";
import { tickerNow } from "../ticker/store.js";
import { showsName } from "./zone-reads.js";
import { buildRegions } from "./build.js";
import { stageOf } from "./stage.js";
import type { ArtCache } from "../stage/art.js";
import { themeColors } from "../stage/scrim.js";
import { claimEndAt, placeClaims } from "./claims.js";
import type { Placement } from "./claims.js";
import { contentFacts, entriesOf, photoProps } from "./content.js";
import { displayOf, moodOf, phaseSource } from "./display.js";
import { loadScene } from "./scenes.js";
import type { ZoneScene } from "./scenes.js";
import type { Display } from "./display.js";
import { nextPhaseAt, type MotionLevel, type MotionPhase } from "./motion.js";
import { zonePlay, zonePrefetch } from "../moments-sound.js";
import type { Play } from "../moments-sound.js";
import { themeLayouts } from "./layouts.js";
import type { Layout } from "./layouts.js";
import { loadOverrides } from "./overrides.js";
import { zoneFingerprint } from "./fingerprint.js";
import { highlightChangeAt, highlightOf } from "./features.js";
import { isShowcase } from "./showcase.js";
import type { HeaderMode, HubQrMode } from "./parts.js";
import { heldBundle } from "../pins/bundles.js";
import type { BundleStore } from "../pins/bundles.js";
import { readPin } from "../pins/store.js";
import { themeFor } from "../pins/look.js";
import type { Sources, ThemeNow } from "./sources.js";
import { foodClaim } from "./widgets.js";
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
  /** The kept bundles: a pinned one no longer kept is not what screens load. */
  bundles: Pick<BundleStore, "available">;
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
  /** The pinned bundle version while it is kept, or null for the platform's. */
  bundle: string | null;
  eventName: string;
  /** Landscape and portrait screens of a zone differ in the layout, its regions and so its claims. */
  views: Record<Orientation, ZoneView>;
  ticker: ZoneFacts["ticker"] & TickerLook;
  display: Display;
  /** When a content widget next changes by itself (epoch ms), or null. */
  nextChangeAt: number | null;
  /** The counts its widgets read (ZoneRecord.counts). */
  counts: CountSource[];
  /** Whether a preview's draft was drawn (PreviewLook.themeKey); `none` without one. */
  draft: DraftUse;
  /** Moments' sound for the zone's screens (moments-sound.ts), or null. */
  play: Play | null;
  /** The files Moments asks the zone's screens to keep ahead: its stories' videos (#114). */
  prefetch: string[];
  /** The day's phase now, which Moments' sound gates read (contracts/screen.md, For Moments). */
  phase: MotionPhase;
  /** The zone's scene, whose quiet mode and sound switch the sound gates read in its place. */
  scene: ZoneScene | null;
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
  /**
   * False where no screen draws the result (the hub's view, a preview's checks): no content
   * widget but `stats` (NOW_TYPES), and no stage, so no cover is read for it.
   */
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
      claims: (await loadOverrides(c, zone.key, real.getTime())).map((o) => {
        const rank = preview.ranks?.[o.id];
        return rank === undefined ? o : { ...o, rank };
      }),
      pin: await readPin(c),
      showName: await showsName(c, zone),
      play: await zonePlay(c, zone.key, real.getTime()),
      prefetch: await zonePrefetch(c, zone.key),
      scene: await loadScene(c, zone.key),
      food: await loadFood(c),
    };
  });
  if (read === null) return null;
  const [live, event, agenda, venue, bundle] = await Promise.all([
    themeFor(deps.sources, ctx.tenant_id, read.pin),
    deps.sources.event(host),
    preview.at == null
      ? deps.sources.agendaNow(ctx.tenant_id, zoneKey)
      : agendaAt(deps.sources, ctx.tenant_id, zoneKey, at.getTime()),
    deps.sources.venueInfo(ctx.tenant_id),
    heldBundle(deps.bundles, read.pin.bundle_version),
  ]);
  const { theme, draft } = await lookFor(deps.sources, ctx.tenant_id, live, preview.themeKey);
  const eventName = event?.name ?? ctx.primary_hostname ?? "";
  // The phase and the highlight come before the build: the hero's features read them.
  const items = phaseSource(
    (await deps.sources.agendaDay?.(ctx.tenant_id)) ?? null,
    agenda,
    zoneKey,
  );
  const { display, motion } = displayOf({
    tokens: theme?.tokens,
    items,
    pin: read.zone.motion_level ?? null,
    settings: deps.settings,
    at: at.getTime(),
    scene: read.scene,
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
    food: { orders: read.food, names: deps.settings.get("food_holder_names", true) !== false },
  };
  const claims = read.claims.map((o) => foodClaim(o, facts));
  const build = (portrait: boolean): ZoneView => {
    const once = (showcase?: "grow" | "keep"): ZoneView => {
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
        sceneLayoutId: read.scene?.layout ?? null,
        heroOff: read.scene?.hero_off ?? [],
        themeLayouts: themeLayouts(theme?.layouts),
        portrait,
        facts,
        ...(showcase === undefined ? {} : { showcase }),
      });
      return { layout, ...placeClaims(regions, claims) };
    };
    const plain = once();
    // A claim's place follows roles alone, so the second build places every claim as this one
    // did. A showcase decides the hero's size; only without one does it fill the waiting boxes.
    if (!isShowcase(plain.regions)) return plain;
    return once(read.zone.grow_for_showcase ? "grow" : "keep");
  };
  let views = { landscape: build(false), portrait: build(true) };
  // The content widgets' sources are read only for a zone that shows them, so their changes
  // (every frame, photo and code) never move another zone's version. The hub's view keeps only
  // `stats` of them (NOW_TYPES).
  const entries = entriesOf(Object.values(views), read.zone);
  const used = typesOf(views);
  for (const e of entries) used.add(e.widget);
  if (!withContent) for (const type of used) if (type !== "stats") used.delete(type);
  // "Today in numbers" is empty outside wind-down: its counts would move every Pulse zone's
  // version at each count for nothing.
  if (facts.phase !== "wind_down") used.delete("today_numbers");
  const content = await contentFacts(deps, ctx, zoneKey, used, photoProps(entries), real.getTime());
  if (Object.keys(content.facts).length > 0) {
    Object.assign(facts, content.facts);
    views = { landscape: build(false), portrait: build(true) };
  }
  const look = tickerLook(deps.settings);
  const { stage, covers } = withContent
    ? await stageOf({
        views,
        phase: moodOf(read.scene, motion.phase),
        agenda,
        nowMs: at.getTime(),
        stageArt: deps.settings.get("stage_art", true) !== false,
        colors: themeColors(theme?.tokens),
        hostname: ctx.primary_hostname ?? host,
        art: deps.art,
      })
    : { stage: null, covers: [] };
  if (stage !== null) display.stage = stage;
  // The level's and the phase's next change, the highlight's and a tint's end rebuild the zone
  // then, as a content widget's does: a pinned level never names the phase's.
  const tintEnds = stage?.tint == null ? null : Date.parse(stage.tint.until);
  const day = [nextPhaseAt(items, at.getTime()), highlightChangeAt(items, at.getTime())];
  // A claim's end too: the hero a claim grew, and the regions it held, go back only on a rebuild.
  const claimEnds = read.claims.map(claimEndAt);
  // And the sound's catch-up end, so a screen that comes back later no longer gets it.
  const soundEnds = read.play === null ? null : Date.parse(read.play.catch_up_until);
  const changes = [
    content.changesAt,
    motion.next?.at,
    ...day,
    tintEnds,
    ...claimEnds,
    soundEnds,
  ].filter((t) => t != null);
  return {
    fingerprint: zoneFingerprint({
      zone: read.zone,
      windowLayoutId: read.windowLayout,
      theme: { revision: theme?.revision ?? 0, layouts: theme?.layouts ?? [] },
      facts,
      tickerAppearance: look.appearance,
      tickerSpeed: look.speed,
      display,
      claims: read.claims,
      bundle,
      showName: read.showName,
      art: covers,
      play: read.play,
      scene: read.scene,
      prefetch: read.prefetch,
    }),
    zone: read.zone,
    showName: read.showName,
    bundle,
    theme: theme ?? NO_THEME,
    eventName,
    views,
    ticker: { ...read.ticker, ...look },
    display,
    nextChangeAt: changes.length === 0 ? null : Math.min(...changes),
    counts: countsOf(used),
    draft,
    play: read.play,
    prefetch: read.prefetch,
    phase: motion.phase,
    scene: read.scene,
  };
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
  // The screen's background (theming.md, The two backgrounds); absent from an older theming.
  ...(t.backdrop === undefined ? {} : { backdrop: t.backdrop }),
});
