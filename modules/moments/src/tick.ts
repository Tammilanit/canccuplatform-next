/**
 * The server-side tick (E2): every container visits the events in `moments_tenants` once a
 * second and ends what is due from the stored times: moments past `expires_at`, and waiting
 * moments past their patience on a zone. Rows are taken `FOR UPDATE SKIP LOCKED`, so two
 * containers never end the same moment twice, and a restart resumes from the rows alone.
 */
import type { Logger, SqlClient } from "@canccu/kit";
import { withTenant } from "@canccu/kit";
import type { Db } from "./db.js";
import type { Engine } from "./engine.js";
import { evaluateScenes, storeAgenda } from "./scene-store.js";
import type { AgendaReader } from "./scene-store.js";
import { lockMoment, runningMoments } from "./store.js";
import { tickAnnouncements } from "./announce/follow.js";
import { retryRules } from "./rule-retries.js";
import { tickStories } from "./story/triggers.js";

export const TICK_MS = 1000;
/** History of an archived event is deleted this long after archiving (D21). */
const HISTORY_AFTER_ARCHIVE = "30 days";

export async function tickTenant(
  c: SqlClient,
  engine: Engine,
  now: Date,
  log?: Logger,
): Promise<void> {
  for (const m of await runningMoments(c, "expires_at <= $1", [now], "skip")) {
    await engine.end(c, m, "expired", null, now);
  }
  const { rows } = await c.query(
    `SELECT p.moment_id, p.zone_key FROM moment_placements p
     JOIN moments m ON m.tenant_id = p.tenant_id AND m.id = p.moment_id
     WHERE m.ended_at IS NULL AND p.state = 'unplaced' AND NOT p.placed_once
       AND p.since + make_interval(secs => m.patience_seconds) <= $1
     ORDER BY p.since`,
    [now],
  );
  for (const r of rows as { moment_id: string; zone_key: string }[]) {
    const m = await lockMoment(c, r.moment_id);
    if (m === null || m.ended_at !== null) continue;
    await engine.end(c, m, "preempted", null, now, r.zone_key);
  }
  await retryRules(c, engine, now);
  await tickAnnouncements(c, engine, now);
  await tickStories({ c, engine, now, log });
  await engine.pumpSounds(c, now);
}

/** A priority change ranks every running moment again at once and never ends one (E8). */
export async function reRank(c: SqlClient, engine: Engine): Promise<void> {
  for (const m of await runningMoments(c, "TRUE", [], "wait")) {
    await engine.show(c, m, null, "preempted");
  }
}

/** Archiving ends every moment, the emergency included (E10). */
export async function endAll(c: SqlClient, engine: Engine, now: Date): Promise<void> {
  for (const m of await runningMoments(c, "TRUE", [], "wait")) {
    await engine.end(c, m, "source_ended", null, now);
  }
  await c.query(`DELETE FROM moments_rule_retries`, []);
}

/** The event is archived (E10): every moment ends, and its writes answer 409 from now on. */
export async function archive(db: Db, engine: Engine, tenant: string, now: Date): Promise<void> {
  await withTenant(tenant, () => db.tenant((c) => endAll(c, engine, now)));
  await db.global((c) =>
    c.query(
      `INSERT INTO moments_tenants (tenant_id, archived_at) VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET archived_at = EXCLUDED.archived_at`,
      [tenant, now],
    ),
  );
}

/** A removed zone: every moment leaves it (E9), and it is no zone of the event any more. */
export async function zoneRemoved(
  c: SqlClient,
  engine: Engine,
  zone: string,
  now: Date,
): Promise<void> {
  const covering = await runningMoments(
    c,
    "(cardinality(zones) = 0 OR $1 = ANY (zones)) AND NOT ($1 = ANY (left_zones))",
    [zone],
    "wait",
  );
  for (const m of covering) await engine.end(c, m, "source_ended", null, now, zone);
  await c.query(`DELETE FROM moments_zones WHERE zone_key = $1`, [zone]);
  await c.query(`DELETE FROM moment_placements WHERE zone_key = $1`, [zone]);
  await c.query(`DELETE FROM moments_scene_zones WHERE zone_key = $1`, [zone]);
}

/** How often each event's zones are put in their scenes, besides on the events they follow. */
export const SCENES_EVERY_MS = 10_000;

/** One container's pace of the scene pass: when each event's ran, and whose agenda it has read. */
export class SceneTicker {
  readonly last = new Map<string, number>();
  /** The agenda is read once per container and event; its events keep it current after that. */
  readonly read = new Set<string>();
}

/** How often a container reads each event's status again (E10, for an archive it missed). */
export const STATUS_EVERY_MS = 60_000;

/** One container's pace of reading each event's status from the tenants module. */
export class StatusTicker {
  readonly last = new Map<string, number>();
  constructor(readonly statusOf: (tenant: string) => Promise<string | null>) {}
}

interface TickDeps {
  db: Db;
  engine: Engine;
  flush: () => Promise<unknown>;
  now: () => Date;
  log?: Logger;
  scenes?: SceneTicker;
  statuses?: StatusTicker;
  agenda?: AgendaReader;
  timeZoneOf?: (tenant: string) => Promise<string>;
}

/** Time conditions and holds move by the clock alone: the zones' scenes are decided again. */
async function sceneTick(deps: TickDeps, ticker: SceneTicker, tenant: string): Promise<void> {
  const now = deps.now();
  if (now.getTime() - (ticker.last.get(tenant) ?? Number.NEGATIVE_INFINITY) < SCENES_EVERY_MS)
    return;
  ticker.last.set(tenant, now.getTime());
  let agenda = null;
  if (!ticker.read.has(tenant) && deps.agenda !== undefined) {
    agenda = await deps.agenda(tenant).catch(() => null);
    if (agenda !== null) ticker.read.add(tenant);
  }
  const timeZone = (await deps.timeZoneOf?.(tenant)) ?? "UTC";
  await deps.db.tenant(async (c) => {
    if (agenda !== null) await storeAgenda(c, agenda);
    await evaluateScenes(c, deps.engine.outbox, { timeZone, now });
  });
}

/**
 * Whether the tenants module now says the event is archived, read at most once a minute: an
 * archive sent while Moments was down reaches no subscription, which reads from "now" (E10).
 */
async function archivedMeanwhile(deps: TickDeps, tenant: string): Promise<boolean> {
  const ticker = deps.statuses;
  if (ticker === undefined) return false;
  const now = deps.now().getTime();
  if (now - (ticker.last.get(tenant) ?? Number.NEGATIVE_INFINITY) < STATUS_EVERY_MS) return false;
  ticker.last.set(tenant, now);
  return (await ticker.statusOf(tenant).catch(() => null)) === "archived";
}

/** One pass over every event: the tick, then the outbox and the 24-hour idempotency keys. */
export async function tickAll(deps: TickDeps): Promise<void> {
  const tenants = await deps.db.global(async (c) => {
    const { rows } = await c.query(
      `SELECT tenant_id FROM moments_tenants WHERE archived_at IS NULL ORDER BY tenant_id`,
      [],
    );
    return rows.map((r) => r.tenant_id as string);
  });
  for (const tenant of tenants) {
    try {
      if (await archivedMeanwhile(deps, tenant)) {
        await archive(deps.db, deps.engine, tenant, deps.now());
        await withTenant(tenant, deps.flush);
        continue;
      }
      await withTenant(tenant, async () => {
        await deps.db.tenant((c) => tickTenant(c, deps.engine, deps.now(), deps.log));
        if (deps.scenes !== undefined) await sceneTick(deps, deps.scenes, tenant);
        await deps.flush();
      });
    } catch (err) {
      deps.log?.warn({ err, tenant }, "the moments tick failed for an event");
    }
  }
}

/**
 * Hourly: idempotency keys after 24 hours, once-per-source sounds after 7 days, and an archived
 * event's history and sound log after 30 days.
 */
export async function upkeep(db: Db, now: Date): Promise<void> {
  const tenants = await db.global(async (c) => {
    const { rows } = await c.query(`SELECT tenant_id, archived_at FROM moments_tenants`, []);
    return rows as { tenant_id: string; archived_at: Date | null }[];
  });
  for (const t of tenants) {
    await withTenant(t.tenant_id, () =>
      db.tenant(async (c) => {
        await c.query(
          `DELETE FROM moments_idempotency WHERE at < $1::timestamptz - interval '1 day'`,
          [now],
        );
        // Once per source holds 7 days (D16, the legacy's oncePerSource memory).
        await c.query(
          `DELETE FROM moments_sound_sources WHERE at < $1::timestamptz - interval '7 days'`,
          [now],
        );
        if (t.archived_at !== null) {
          await c.query(
            `DELETE FROM moments_history
             WHERE $1::timestamptz >= $2::timestamptz + interval '${HISTORY_AFTER_ARCHIVE}'`,
            [now, t.archived_at],
          );
          await c.query(
            `DELETE FROM moments_sound_log
             WHERE $1::timestamptz >= $2::timestamptz + interval '${HISTORY_AFTER_ARCHIVE}'`,
            [now, t.archived_at],
          );
        }
      }),
    );
  }
}

/** Notes an event the module serves, so the tick visits it (idempotent). */
export async function noteTenant(db: Db, tenant: string): Promise<void> {
  await db.global((c) =>
    c.query(`INSERT INTO moments_tenants (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [tenant]),
  );
}
