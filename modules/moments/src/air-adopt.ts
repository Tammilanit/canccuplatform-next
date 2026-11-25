/**
 * Moments running when #777 deploys (plan D19, no backfill): each had one override `<id>` for its
 * zones; the passes give it an override per zone instead. Its first slot takes the time it had
 * left, the hero stays with the one Screen shows, and the old override ends only after the new
 * one started, so a restart with moments on air never blanks a screen.
 */
import type { Outbox, SqlClient } from "@canccu/kit";
import { endOverride, liveOverrides } from "./store.js";
import type { Actor, MomentRow } from "./store.js";
import type { EndReason } from "./engine.js";

export interface Adopted {
  /** Its on-air budget there: what its old end left it (D19), null without one. */
  budget_ms: number | null;
  /** Screen shows its old override in this zone's hero. */
  hero: boolean;
}

/** The moment's adoption on `zone` when it still has its old override and no slot yet, or null. */
export async function adoptionOf(
  c: SqlClient,
  m: MomentRow,
  zone: string,
  now: Date,
): Promise<Adopted | null> {
  if (!(await liveOverrides(c, m.id)).some((o) => o.override_id === m.id)) return null;
  const { rows: slots } = await c.query(`SELECT 1 FROM moment_slots WHERE moment_id = $1 LIMIT 1`, [
    m.id,
  ]);
  if (slots.length > 0) return null;
  const { rows: hero } = await c.query(
    `SELECT 1 FROM moment_placements WHERE override_id = $1 AND zone_key = $2
       AND state = 'placed' AND role IN ('hero', 'full')`,
    [m.id, zone],
  );
  return {
    budget_ms:
      m.expires_at === null ? null : Math.max(1000, m.expires_at.getTime() - now.getTime()),
    hero: hero.length > 0,
  };
}

/**
 * Ends the moment's old override `<id>` (`final: true`). `carry`: it goes on per zone, so where
 * Screen placed the old one moves to the per-zone id each zone's first send has (`<id>.<zone>`):
 * it counts as seen there (air-plan.ts), and its next report writes no new history.
 */
export async function endOld(
  c: SqlClient,
  outbox: Outbox,
  m: MomentRow,
  reason: EndReason,
  actor: Actor | null,
  carry: boolean,
): Promise<void> {
  const old = (await liveOverrides(c, m.id)).find((o) => o.override_id === m.id);
  if (old === undefined) return;
  if (carry)
    await c.query(
      `UPDATE moment_placements p SET override_id = $1 || '.' || p.zone_key
       WHERE p.override_id = $1 AND NOT EXISTS (
         SELECT 1 FROM moment_placements q
         WHERE q.override_id = $1 || '.' || p.zone_key AND q.zone_key = p.zone_key)`,
      [m.id],
    );
  await endOverride(c, m.id);
  await outbox.add(
    c,
    "moments.override.ended",
    {
      override_id: m.id,
      zones: old.sent.zones,
      reason,
      final: true,
      actor_user_id: actor?.user_id ?? null,
    },
    { version: 1 },
  );
}
