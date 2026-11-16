/**
 * What Moments consumes (contracts/moments.md): Screen's placements and zones, archiving, and the
 * catalog events its rules and live sources follow. Each tenant event is handled in one tenant
 * transaction, whose override events the outbox sends after the commit. Handlers are idempotent:
 * events come at least once, and to every container.
 */
import type { Event } from "@canccu/kit";
import type { Db } from "./db.js";
import type { Engine } from "./engine.js";
import { applyClaims, claimsReportOf } from "./placements.js";
import { applyRules } from "./rules.js";
import { recordSource, refreshBound } from "./sources.js";
import { addZone } from "./store.js";
import { endAll, noteTenant, zoneRemoved } from "./tick.js";

export const TENANT_STREAMS = ["screen", "tenants", "tournament", "pizza", "games"];

export interface ConsumerDeps {
  db: Db;
  engine: Engine;
  flush: () => Promise<unknown>;
  now: () => Date;
}

/** One tenant event, run inside its tenant (the kit's subscribeTenants sets it). */
export async function handleTenantEvent(deps: ConsumerDeps, e: Event): Promise<void> {
  if (e.tenant === undefined) return;
  const now = deps.now();
  if (e.type === "tenants.status.changed") {
    if (e.data.to !== "archived") return;
    await deps.db.tenant((c) => endAll(c, deps.engine, now));
    await deps.db.global((c) =>
      c.query(
        `INSERT INTO moments_tenants (tenant_id, archived_at) VALUES ($1, $2)
         ON CONFLICT (tenant_id) DO UPDATE SET archived_at = EXCLUDED.archived_at`,
        [e.tenant, now],
      ),
    );
    await deps.flush();
    return;
  }
  if (e.source === "tenants") return;
  await noteTenant(deps.db, e.tenant);
  await deps.db.tenant(async (c) => {
    if (e.type === "screen.claims.changed") {
      const report = claimsReportOf(e.data);
      if (report !== null) await applyClaims(c, report, now);
    } else if (e.type === "screen.zone.saved" && typeof e.data.zone_key === "string") {
      await addZone(c, e.data.zone_key);
    } else if (e.type === "screen.zone.removed" && typeof e.data.zone_key === "string") {
      await zoneRemoved(c, deps.engine, e.data.zone_key, now);
    } else if (e.source !== "screen") {
      const touched = await recordSource(c, e);
      await applyRules(c, deps.engine, e, now);
      if (touched !== null) await refreshBound(c, deps.engine, touched, now);
    }
  });
  await deps.flush();
}

/**
 * Screen's zone events replayed from the start of each stream at every boot, so zones saved while
 * Moments was down or before it ran are known (moments with every zone narrow to them, D3). Only
 * the set of zones changes here: a past removal must never end a moment running now; the live
 * subscription (handleTenantEvent) ends moments on a zone removed now.
 */
export async function handleZoneReplay(deps: ConsumerDeps, e: Event): Promise<void> {
  const zone = e.data.zone_key;
  if (e.tenant === undefined || typeof zone !== "string") return;
  if (e.type === "screen.zone.saved") {
    await noteTenant(deps.db, e.tenant);
    await deps.db.tenant((c) => addZone(c, zone));
  } else if (e.type === "screen.zone.removed") {
    await deps.db.tenant((c) => c.query(`DELETE FROM moments_zones WHERE zone_key = $1`, [zone]));
  }
}

/** Platform events: a deleted event's rows, a deleted user's name in the history. */
export async function handlePlatformEvent(deps: ConsumerDeps, e: Event): Promise<void> {
  if (e.type === "tenants.tenant.deleted" && typeof e.data.tenant_id === "string") {
    const tenant = e.data.tenant_id;
    await deps.db.global(async (c) => {
      // The app role is bound by RLS; a deleted event's rows go with the tenant set to it.
      await c.query(`SELECT set_config('canccu.tenant', $1, true)`, [tenant]);
      for (const table of [
        "moment_placements",
        "moment_overrides",
        "moments",
        "moments_zones",
        "moments_priorities",
        "moments_rules",
        "moments_sources",
        "moments_history",
        "moments_idempotency",
        "moments_outbox",
      ]) {
        await c.query(`DELETE FROM ${table}`, []);
      }
      await c.query(`DELETE FROM moments_tenants WHERE tenant_id = $1`, [tenant]);
      await c.query(`DELETE FROM moments_outbox_tenants WHERE tenant_id = $1`, [tenant]);
    });
  } else if (e.type === "tenants.user.deleted" && typeof e.data.user_id === "string") {
    const user = e.data.user_id;
    const tenants = await deps.db.global(async (c) => {
      const { rows } = await c.query(`SELECT tenant_id FROM moments_tenants`, []);
      return rows.map((r) => r.tenant_id as string);
    });
    for (const tenant of tenants) {
      await deps.db.global(async (c) => {
        await c.query(`SELECT set_config('canccu.tenant', $1, true)`, [tenant]);
        await forgetUser(c, user);
      });
    }
  }
}

/** The person's name in a `why` ("Demo Crew · spotlight") replaced, the action kept. */
const ANONYMOUS_WHY = `'A person' || substring(why from position(' · ' in why))`;

/**
 * Removes a person's name and id from the history and the moments: the rows they acted on, and
 * every row of a moment they started, whose `why` names them.
 */
export async function forgetUser(
  c: { query: (text: string, values: unknown[]) => Promise<unknown> },
  user: string,
): Promise<void> {
  await c.query(
    `UPDATE moments_history SET why = ${ANONYMOUS_WHY}
     WHERE origin IN ('crew', 'emergency')
       AND moment_id IN (SELECT id FROM moments WHERE actor_user_id = $1)`,
    [user],
  );
  await c.query(
    `UPDATE moments_history SET actor_user_id = NULL, actor_name = NULL WHERE actor_user_id = $1`,
    [user],
  );
  await c.query(
    `UPDATE moments SET actor_user_id = NULL, actor_name = NULL,
       why = CASE WHEN origin IN ('crew', 'emergency') THEN ${ANONYMOUS_WHY} ELSE why END
     WHERE actor_user_id = $1`,
    [user],
  );
}
