/**
 * The rows of the airtime scheduler (#777): each moment's slot on a zone (its queue place and its
 * on-air clock) and each zone's hero. The clock is stored as played time plus the start of the
 * stretch that runs now, so a restart resumes it from the rows alone (E2).
 */
import type { SqlClient } from "@canccu/kit";
import type { Grant, ZoneIn } from "./air-plan.js";

export interface SlotRow {
  moment_id: string;
  zone_key: string;
  queued_since: Date;
  forward_at: Date | null;
  granted: Grant;
  inside_of: string | null;
  on_air_since: Date | null;
  played_ms: number;
  tenure_from_ms: number;
  budget_ms: number | null;
  generation: number;
  override_id: string | null;
  ends_at: Date | null;
}

const slotOf = (r: Record<string, unknown>): SlotRow => ({
  ...(r as unknown as SlotRow),
  played_ms: Number(r.played_ms),
  tenure_from_ms: Number(r.tenure_from_ms),
  budget_ms: r.budget_ms === null ? null : Number(r.budget_ms),
});

/**
 * Locks the zone's hero row for this transaction, so two containers never give it twice; with
 * `skip`, null when another transaction holds it (the tick tries again next second).
 */
export async function lockZone(
  c: SqlClient,
  zone: string,
  lock: "wait" | "skip",
): Promise<ZoneIn | null> {
  await c.query(`INSERT INTO moments_zone_air (zone_key) VALUES ($1) ON CONFLICT DO NOTHING`, [
    zone,
  ]);
  const { rows } = await c.query(
    `SELECT holder, free_since FROM moments_zone_air WHERE zone_key = $1
     FOR UPDATE${lock === "skip" ? " SKIP LOCKED" : ""}`,
    [zone],
  );
  const r = rows[0];
  if (r === undefined) return null;
  return {
    holder: r.holder as string | null,
    free_since: r.free_since === null ? null : (r.free_since as Date).getTime(),
  };
}

export async function saveZone(c: SqlClient, zone: string, z: ZoneIn): Promise<void> {
  await c.query(`UPDATE moments_zone_air SET holder = $2, free_since = $3 WHERE zone_key = $1`, [
    zone,
    z.holder,
    z.free_since === null ? null : new Date(z.free_since),
  ]);
}

export async function slotsOn(c: SqlClient, zone: string): Promise<SlotRow[]> {
  const { rows } = await c.query(`SELECT * FROM moment_slots WHERE zone_key = $1`, [zone]);
  return rows.map(slotOf);
}

export async function slotsOf(c: SqlClient, momentId: string): Promise<SlotRow[]> {
  const { rows } = await c.query(`SELECT * FROM moment_slots WHERE moment_id = $1`, [momentId]);
  return rows.map(slotOf);
}

export async function newSlot(
  c: SqlClient,
  momentId: string,
  zone: string,
  queuedSince: Date,
  budgetMs: number | null,
): Promise<SlotRow> {
  const { rows } = await c.query(
    `INSERT INTO moment_slots (moment_id, zone_key, queued_since, budget_ms) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, moment_id, zone_key) DO UPDATE SET zone_key = EXCLUDED.zone_key
     RETURNING *`,
    [momentId, zone, queuedSince, budgetMs],
  );
  return slotOf(rows[0] as Record<string, unknown>);
}

export async function saveSlot(c: SqlClient, s: SlotRow): Promise<void> {
  await c.query(
    `UPDATE moment_slots SET queued_since = $3, forward_at = $4, granted = $5, inside_of = $6,
       on_air_since = $7, played_ms = $8, tenure_from_ms = $9, budget_ms = $10, generation = $11,
       override_id = $12, ends_at = $13
     WHERE moment_id = $1 AND zone_key = $2`,
    [
      s.moment_id,
      s.zone_key,
      s.queued_since,
      s.forward_at,
      s.granted,
      s.inside_of,
      s.on_air_since,
      Math.round(s.played_ms),
      Math.round(s.tenure_from_ms),
      s.budget_ms === null ? null : Math.round(s.budget_ms),
      s.generation,
      s.override_id,
      s.ends_at,
    ],
  );
}

export async function dropSlot(c: SqlClient, momentId: string, zone: string): Promise<void> {
  await c.query(`DELETE FROM moment_slots WHERE moment_id = $1 AND zone_key = $2`, [
    momentId,
    zone,
  ]);
}

/** The played time with the stretch that runs now. */
export const playedAt = (s: SlotRow, now: Date): number =>
  s.played_ms +
  (s.on_air_since === null ? 0 : Math.max(0, now.getTime() - s.on_air_since.getTime()));

/** Stops the clock: Screen hid it, or it left the hero (rule 2). */
export function pause(s: SlotRow, now: Date): void {
  if (s.on_air_since === null) return;
  s.played_ms = playedAt(s, now);
  s.on_air_since = null;
}

/** Runs the clock again from now. */
export function resume(s: SlotRow, now: Date): void {
  if (s.on_air_since === null) s.on_air_since = now;
}

/** The moment's `expires_at`: the latest end among its zones (null: no end of its own). */
export async function syncExpiry(c: SqlClient, momentId: string): Promise<void> {
  await c.query(
    `UPDATE moments SET expires_at = s.e
     FROM (SELECT max(ends_at) AS e, bool_or(ends_at IS NULL) AS open FROM moment_slots
           WHERE moment_id = $1) s
     WHERE id = $1 AND NOT s.open AND s.e IS NOT NULL AND expires_at IS DISTINCT FROM s.e`,
    [momentId],
  );
}
