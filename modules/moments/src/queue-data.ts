/**
 * Each zone's queue as On air and `GET /api/moments/moments` show it (#777, rule 7): who holds the
 * hero, the breathing gap, what waits in queue order (and which one waits in the rail), and what
 * went stale in the last hour.
 */
import type { SqlClient } from "@canccu/kit";
import { rankOn } from "./arbiter.js";
import type { Class } from "./arbiter.js";
import { knownZones, loadOrders, titleOf } from "./store.js";
import type { MomentRow } from "./store.js";

export interface ZoneQueue {
  zone_key: string;
  holder: string | null;
  free_until: string | null;
  waiting: { moment_id: string; title: string; class: Class; since: string; in_rail: boolean }[];
  stale: { title: string; class: Class; at: string }[];
}

const STALE_SHOWN = 10;

export async function zoneQueues(c: SqlClient, now: Date): Promise<ZoneQueue[]> {
  const { air, ...orders } = await loadOrders(c);
  const out: ZoneQueue[] = [];
  for (const zone of await knownZones(c)) {
    const z = (
      await c.query(`SELECT holder, free_since FROM moments_zone_air WHERE zone_key = $1`, [zone])
    ).rows[0] as { holder: string | null; free_since: Date | null } | undefined;
    const gapEnd = z?.free_since == null ? null : z.free_since.getTime() + air.gap_ms;
    const { rows } = await c.query(
      `SELECT s.moment_id, s.queued_since, s.forward_at, s.granted, m.class, m.template, m.content
       FROM moment_slots s JOIN moments m ON m.tenant_id = s.tenant_id AND m.id = s.moment_id
       WHERE s.zone_key = $1 AND m.ended_at IS NULL AND (s.granted IS NULL OR s.granted = 'rail')`,
      [zone],
    );
    const waiting = rows
      .map((r) => ({
        r,
        rank: rankOn(orders, zone, r.class as Class),
        fwd: (r.forward_at as Date | null)?.getTime() ?? -1,
        since: (r.queued_since as Date).getTime(),
      }))
      .sort((a, b) => b.fwd - a.fwd || b.rank - a.rank || a.since - b.since)
      .map(({ r }) => ({
        moment_id: r.moment_id as string,
        title: titleOf(r as unknown as Pick<MomentRow, "content" | "template">),
        class: r.class as Class,
        since: (r.queued_since as Date).toISOString(),
        in_rail: r.granted === "rail",
      }));
    const stale = await c.query(
      `SELECT title, class, at FROM moments_history
       WHERE zone_key = $1 AND action = 'ended' AND outcome = 'stale' AND at > $2
       ORDER BY at DESC LIMIT ${String(STALE_SHOWN)}`,
      [zone, new Date(now.getTime() - 3_600_000)],
    );
    out.push({
      zone_key: zone,
      holder: z?.holder ?? null,
      free_until:
        z?.holder == null && gapEnd !== null && gapEnd > now.getTime()
          ? new Date(gapEnd).toISOString()
          : null,
      waiting,
      stale: (stale.rows as { title: string; class: Class; at: Date }[]).map((s) => ({
        title: s.title,
        class: s.class,
        at: s.at.toISOString(),
      })),
    });
  }
  return out;
}
