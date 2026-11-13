/**
 * The server-side tick (plan #108, D5): every second, in every container, each zone of each
 * event with screens advances once. A Valkey claim per zone and second hands each step to one
 * container; the state row, locked for the step, and the time it was written keep a slower
 * container from writing over a later step. The tick alone writes playback state, and it also
 * ends expired pushes and announces the ticker's own changes (a window starting or ending).
 */
import { isTenantId, tenantKey, withTenant } from "@canccu/kit";
import type { Bus, Logger, SqlClient, TenantContext } from "@canccu/kit";
import type { Audit } from "../audit.js";
import type { Db } from "../db.js";
import type { Settings } from "../health.js";
import type { Kv } from "../kv.js";
import { expirePushes } from "../content/push.js";
import { tickTicker } from "../ticker/routes.js";
import { resolveWinner } from "../schedule/winner.js";
import { canonical, publishAll } from "../zones.js";
import {
  breakInputFor,
  loadContent,
  pushFor,
  type AssetReader,
  type EventContent,
} from "./content.js";
import { advanceZone, EMPTY_ZONE, type ZoneState } from "./zone.js";
import { announcePreview, endExpired } from "../preview/store.js";
import type { Fanout } from "../push/store.js";

export const TICK_MS = 1000;
/** Shorter than a tick, so the next second's step is free to any container. */
const CLAIM_MS = 900;
/** How long an event's time zone and status are reused before the tenants module is asked again. */
const CONTEXT_MS = 60_000;

export interface TickDeps {
  db: Db;
  kv: Kv;
  bus: Bus;
  audit: Audit;
  settings: Settings;
  assets: AssetReader;
  /** The tenants module's view of an event by id (`TenantResolver.byId`). */
  tenantById: (id: string) => Promise<TenantContext | null>;
  now: () => number;
  log?: Logger;
  /**
   * The zones of the event whose playback this step stored a change of (PushHub.played): their
   * `playlist` widget reads that state, so the screens see the change only after a rebuild.
   */
  played?: (tenant: string, zones: string[]) => void;
  /** Tells the streams of a device whose preview on a screen ended by itself; none in tests. */
  fanout?: Fanout;
}

export function breakGapSeconds(settings: Settings): number {
  const value = settings.get("break_min_gap_seconds", 60);
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 60;
}

export async function loadZoneState(c: SqlClient, zoneKey: string): Promise<ZoneState> {
  const { rows } = await c.query("SELECT state FROM screen_zone_playback WHERE zone_key = $1", [
    zoneKey,
  ]);
  return (rows[0]?.state as ZoneState | undefined) ?? EMPTY_ZONE;
}

/**
 * One step for the current tenant: expired pushes end, then each zone this container claims.
 * Content is read only once a zone is claimed, and each step's clock is read after its claim.
 */
export async function tickTenant(deps: TickDeps, ctx: TenantContext): Promise<void> {
  const tenantId = ctx.tenant_id;
  const ended = await deps.db.tenant((c) => expirePushes(c, deps.audit, tenantId, deps.now()));
  await publishAll(deps.bus, ended);
  // Previews past their `until` end here, audited with the module as actor; a stream drawing one
  // already went back to the live zone at its own ping (src/push/stream.ts).
  const previews = await deps.db.tenant((c) => endExpired(c, deps.audit, deps.now()));
  const fanout = deps.fanout;
  if (fanout !== undefined) {
    for (const id of previews) await announcePreview({ kv: deps.kv, fanout }, id);
  }
  // Not under "tick": a zone may be called `ticker`.
  if (await deps.kv.setIfAbsent(tenantKey("screen", "ticker", "tick"), "1", CLAIM_MS)) {
    const ticker = await deps.db.tenant((c) => tickTicker(c, ctx.time_zone, deps.now()));
    await publishAll(deps.bus, ticker);
  }
  const keys = await deps.db.tenant(async (c) =>
    (await c.query("SELECT key FROM screen_zones ORDER BY key")).rows.map((r) => r.key as string),
  );
  const claimed: string[] = [];
  for (const key of keys) {
    if (await deps.kv.setIfAbsent(tenantKey("screen", "tick", key), "1", CLAIM_MS))
      claimed.push(key);
  }
  if (claimed.length === 0) return;
  await deps.settings.ensure();
  const gap = breakGapSeconds(deps.settings);
  const content = await deps.db.tenant((c) => loadContent(c, deps.assets, deps.now()));
  const changed: string[] = [];
  for (const key of claimed) {
    try {
      if (await stepZone(deps, ctx, content, key, gap)) changed.push(key);
    } catch (err) {
      // A zone deleted since the read has no row to write (its foreign key refuses the insert);
      // that, or any one zone's failure, never holds back the event's other zones.
      deps.log?.warn({ err, tenant_id: tenantId, zone_key: key }, "screen zone tick failed");
    }
  }
  if (changed.length > 0) deps.played?.(tenantId, changed);
}

async function stepZone(
  deps: TickDeps,
  ctx: TenantContext,
  content: EventContent,
  key: string,
  gap: number,
): Promise<boolean> {
  const nowMs = deps.now();
  const windows = content.windows.filter((w) => w.zoneKey === key);
  const winner = resolveWinner({ ...content, windows, timeZone: ctx.time_zone }, new Date(nowMs));
  const push = pushFor(content, key);
  const input = {
    winner: winner === null ? null : { id: winner.id, playlistId: winner.playlistId },
    push:
      push === null ? null : { id: push.id, playlistId: push.playlistId, assetId: push.assetId },
    playlists: content.playlists,
    breaks: breakInputFor(content, key, ctx.time_zone, gap),
  };
  return deps.db.tenant(async (c) => {
    const { rows } = await c.query(
      "SELECT state, updated_at FROM screen_zone_playback WHERE zone_key = $1 FOR UPDATE",
      [key],
    );
    // A container whose step began earlier never writes over a later one: time only moves on.
    const stored = rows[0] as { state: ZoneState; updated_at: Date } | undefined;
    if (stored !== undefined && stored.updated_at.getTime() > nowMs) return false;
    const before = stored?.state ?? EMPTY_ZONE;
    const after = advanceZone(before, input, nowMs);
    // Most steps change nothing; only a change is written.
    if (canonical(before) === canonical(after)) return false;
    // The guard also covers two first inserts racing, which no row lock can.
    const written = await c.query(
      `INSERT INTO screen_zone_playback (zone_key, state, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, zone_key) DO UPDATE SET state = $2, updated_at = $3
       WHERE screen_zone_playback.updated_at <= $3
       RETURNING zone_key`,
      [key, JSON.stringify(after), new Date(nowMs)],
    );
    return written.rows.length > 0;
  });
}

/** One tick of every event that has screens. */
export function tickRunner(deps: TickDeps): () => Promise<void> {
  const contexts = new Map<string, { ctx: TenantContext | null; until: number }>();
  const contextOf = async (id: string) => {
    const held = contexts.get(id);
    if (held !== undefined && held.until > deps.now()) return held.ctx;
    const ctx = await deps.tenantById(id);
    contexts.set(id, { ctx, until: deps.now() + CONTEXT_MS });
    return ctx;
  };
  return async () => {
    const tenants = await deps.db.global(async (c) =>
      (
        await c.query(
          "SELECT DISTINCT current_tenant_id FROM devices WHERE current_tenant_id IS NOT NULL",
        )
      ).rows.map((r) => r.current_tenant_id as string),
    );
    for (const tenant of tenants.filter(isTenantId)) {
      try {
        const ctx = await contextOf(tenant);
        // An archived event is read-only: its screens show the archived notice, not content.
        if (ctx === null || ctx.status === "archived") continue;
        await withTenant(tenant, () => tickTenant(deps, ctx));
      } catch (err) {
        // One event's failure never holds back the others' screens.
        deps.log?.warn({ err, tenant_id: tenant }, "screen tick failed");
      }
    }
  };
}
