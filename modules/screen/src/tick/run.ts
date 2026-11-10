/**
 * The server-side tick (plan #108, D5): every second, in every container, each zone of each
 * event with screens advances once. A Valkey claim per zone and second hands each step to one
 * container; the state row, locked for the step, keeps a slower one from writing over a newer
 * step. The tick alone writes playback state, and it also ends expired pushes.
 */
import { isTenantId, tenantKey, withTenant } from "@canccu/kit";
import type { Bus, Logger, SqlClient, TenantContext } from "@canccu/kit";
import type { Audit } from "../audit.js";
import type { Db } from "../db.js";
import type { Settings } from "../health.js";
import type { Kv } from "../kv.js";
import { expirePushes } from "../content/push.js";
import { resolveWinner } from "../schedule/winner.js";
import { canonical, publishAll } from "../zones.js";
import { breakInputFor, loadContent, pushFor, type AssetReader } from "./content.js";
import { advanceZone, EMPTY_ZONE, type ZoneState } from "./zone.js";

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
}

export function breakGapSeconds(settings: Settings): number {
  const value = settings.get("break_min_gap_seconds", 60);
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 60;
}

export async function loadZoneState(
  c: SqlClient,
  zoneKey: string,
  lock = false,
): Promise<ZoneState> {
  const { rows } = await c.query(
    `SELECT state FROM screen_zone_playback WHERE zone_key = $1${lock ? " FOR UPDATE" : ""}`,
    [zoneKey],
  );
  return (rows[0]?.state as ZoneState | undefined) ?? EMPTY_ZONE;
}

/** One step for the current tenant: expired pushes end, then each zone this container claims. */
export async function tickTenant(deps: TickDeps, ctx: TenantContext): Promise<void> {
  const nowMs = deps.now();
  const tenantId = ctx.tenant_id;
  const ended = await deps.db.tenant((c) => expirePushes(c, deps.audit, tenantId, nowMs));
  await publishAll(deps.bus, ended);
  await deps.settings.ensure();
  const gap = breakGapSeconds(deps.settings);
  const content = await deps.db.tenant((c) => loadContent(c, deps.assets, nowMs));
  for (const zone of content.zones) {
    if (!(await deps.kv.setIfAbsent(tenantKey("screen", "tick", zone.key), "1", CLAIM_MS)))
      continue;
    const windows = content.windows.filter((w) => w.zoneKey === zone.key);
    const winner = resolveWinner({ ...content, windows, timeZone: ctx.time_zone }, new Date(nowMs));
    const push = pushFor(content, zone.key);
    const input = {
      winner: winner === null ? null : { id: winner.id, playlistId: winner.playlistId },
      push:
        push === null ? null : { id: push.id, playlistId: push.playlistId, assetId: push.assetId },
      playlists: content.playlists,
      breaks: breakInputFor(content, zone.key, ctx.time_zone, gap),
    };
    await deps.db.tenant(async (c) => {
      const before = await loadZoneState(c, zone.key, true);
      const after = advanceZone(before, input, nowMs);
      // Most steps change nothing; only a change is written.
      if (canonical(before) === canonical(after)) return;
      await c.query(
        `INSERT INTO screen_zone_playback (zone_key, state, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, zone_key) DO UPDATE SET state = $2, updated_at = $3`,
        [zone.key, JSON.stringify(after), new Date(nowMs)],
      );
    });
  }
}

/**
 * One tick of every event that has screens. A zone deleted between the read and its step has
 * no row to write; the foreign key refuses it and the next tick no longer sees the zone.
 */
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
