/**
 * The server-side tick (E2): every container visits the events in `moments_tenants` once a
 * second and runs each zone's airtime pass (air.ts): what used its on-air time or went stale
 * ends, from the stored clocks. Rows are taken `FOR UPDATE SKIP LOCKED`, so two
 * containers never end the same moment twice, and a restart resumes from the rows alone.
 */
import type { Logger, SqlClient } from "@canccu/kit";
import { withTenant } from "@canccu/kit";
import { isolated } from "./db.js";
import type { Db } from "./db.js";
import type { Engine } from "./engine.js";
import { evaluateScenes, storeAgenda } from "./scene-store.js";
import type { AgendaReader } from "./scene-store.js";
import { knownZones, loadOrders, runningMoments } from "./store.js";
import { tickAnnouncements } from "./announce/follow.js";
import { passZone, staleAt } from "./air.js";
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
  // Every zone's airtime pass (#777): what used its on-air time or went stale ends, the queue
  // moves on. Each in a savepoint, as each story: one zone that throws must not undo the rest. A
  // zone another transaction holds waits a second.
  for (const zone of await knownZones(c))
    await isolated(
      c,
      () => passZone(c, engine, zone, now, "skip"),
      (err) => log?.warn({ err, zone }, "an airtime pass failed"),
    );
  await isolated(
    c,
    () => endUnplaced(c, engine, now),
    (err) => log?.warn({ err }, "ending unplaced moments failed"),
  );
  await tickAnnouncements(c, engine, now);
  await tickStories({ c, engine, now, log });
  await engine.pumpSounds(c, now);
}

/**
 * A moment on no zone the event knows has no slot, so no pass ends it: it ends when it would have
 * gone stale waiting, and frees its dedupe key and happening.
 */
async function endUnplaced(c: SqlClient, engine: Engine, now: Date): Promise<void> {
  const { air } = await loadOrders(c);
  const unplaced = await runningMoments(
    c,
    `class <> 'emergency' AND NOT EXISTS (SELECT 1 FROM moment_slots s WHERE s.moment_id = moments.id)`,
    [],
    "skip",
  );
  for (const m of unplaced)
    if (now.getTime() >= staleAt(m, air)) await engine.end(c, m, "stale", null, now);
}

/** A priority change ranks every running moment again at once and never ends one (E8). */
export async function reRank(c: SqlClient, engine: Engine, now: Date): Promise<void> {
  for (const m of await runningMoments(c, "TRUE", [], "wait")) {
    await engine.show(c, m, null, "cleared", now);
  }
}

/** Archiving ends every moment, the emergency included (E10). */
export async function endAll(c: SqlClient, engine: Engine, now: Date): Promise<void> {
  for (const m of await runningMoments(c, "TRUE", [], "wait")) {
    await engine.end(c, m, "source_ended", null, now);
  }
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
  await c.query(`DELETE FROM moments_claims_marks WHERE zone_key = $1`, [zone]);
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

/** How long the tick waits for the tenants module's answer before it goes on without it. */
const STATUS_WAIT_MS = 1500;

/** One container's pace of reading each event's status from the tenants module. */
export class StatusTicker {
  readonly last = new Map<string, number>();
  constructor(
    readonly statusOf: (tenant: string) => Promise<string | null>,
    readonly waitMs = STATUS_WAIT_MS,
  ) {}
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
  // The read has no timeout of its own, and the tick is one loop: a hang would stall every event.
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(resolve, ticker.waitMs, null)));
  const status = await Promise.race([ticker.statusOf(tenant).catch(() => null), late]);
  clearTimeout(timer);
  return status === "archived";
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
