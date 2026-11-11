/**
 * Screen's copy of Moments' active overrides (contracts/events.md, Screen overrides), kept from
 * the `moments.override.*` events. Main reads the moments streams from their start at every boot,
 * as it does the agenda's (plan #108, D7), and every container reads every event, so events come
 * twice and out of turn: the newest event id decides (ids are UUID v7 and sort by time,
 * contracts/admin.md), and an ended override keeps its row so an older start cannot bring it back.
 */
import type { Event, SqlClient } from "@canccu/kit";
import type { Db } from "../db.js";
import { activeOn, overrideOf } from "./claims.js";
import type { Override } from "./claims.js";

export const OVERRIDE_EVENTS = new Set([
  "moments.override.started",
  "moments.override.changed",
  "moments.override.ended",
]);

const NEWER = "screen_claims.event_id < EXCLUDED.event_id";

/** Apply one event of a moments tenant stream; run inside the event's tenant. */
export async function applyOverrideEvent(db: Db, event: Event): Promise<void> {
  if (!OVERRIDE_EVENTS.has(event.type)) return;
  if (event.type === "moments.override.ended") {
    const id = event.data.override_id;
    const zones = event.data.zones;
    if (typeof id !== "string" || !Array.isArray(zones)) return;
    const left = zones.filter((z): z is string => typeof z === "string");
    // An end that names no zone ends the override everywhere.
    await db.tenant((c) =>
      c.query(
        `INSERT INTO screen_claims (override_id, left_zones, ended, event_id)
         VALUES ($1, $2, cardinality($2::text[]) = 0, $3)
         ON CONFLICT (tenant_id, override_id) DO UPDATE SET
           left_zones = screen_claims.left_zones || EXCLUDED.left_zones,
           ended = screen_claims.ended OR EXCLUDED.ended,
           event_id = EXCLUDED.event_id
         WHERE ${NEWER}`,
        [id, left, event.id],
      ),
    );
    return;
  }
  const override = overrideOf(event.data.override);
  if (override === null) return;
  // A start begins the override afresh; a change keeps the zones it left and never revives it.
  const fresh = event.type === "moments.override.started";
  await db.tenant((c) =>
    c.query(
      `INSERT INTO screen_claims (override_id, override, event_id) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, override_id) DO UPDATE SET
         override = EXCLUDED.override,
         left_zones = CASE WHEN $4 THEN '{}' ELSE screen_claims.left_zones END,
         ended = CASE WHEN $4 THEN false ELSE screen_claims.ended END,
         event_id = EXCLUDED.event_id
       WHERE ${NEWER}`,
      [override.id, JSON.stringify(override), event.id, fresh],
    ),
  );
}

/** The overrides that claim on `zone` at `nowMs`, by override id. */
export async function loadOverrides(
  c: SqlClient,
  zone: string,
  nowMs: number,
): Promise<Override[]> {
  const { rows } = await c.query(
    `SELECT override FROM screen_claims
     WHERE NOT ended AND override IS NOT NULL AND NOT ($1 = ANY (left_zones))
     ORDER BY override_id`,
    [zone],
  );
  return rows
    .map((r) => overrideOf(r.override))
    .filter((o): o is Override => o !== null && activeOn(o, zone, nowMs));
}
