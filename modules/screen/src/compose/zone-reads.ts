/**
 * What a zone's state reads of its devices: the zone a device draws, and whether its header names
 * the zone (contracts/screen.md, Composed state).
 */
import type { SqlClient } from "@canccu/kit";
import type { ZoneRow } from "./state.js";

/** The zone a device draws, and whether it only mirrors it (one hop: a mirror of a mirror shows nothing). */
export async function placement(
  c: SqlClient,
  deviceId: string,
): Promise<{ zoneKey: string | null; mirror: boolean; mirrorOf: string | null }> {
  const { rows } = await c.query(
    `SELECT a.zone_key, a.mirror_device_id, a.mirror_zone_key, t.zone_key AS target_zone
     FROM screen_assignments a LEFT JOIN screen_assignments t ON t.device_id = a.mirror_device_id
     WHERE a.device_id = $1`,
    [deviceId],
  );
  const row = rows[0] as Record<string, string | null> | undefined;
  if (row === undefined) return { zoneKey: null, mirror: false, mirrorOf: null };
  if (row.mirror_zone_key) return { zoneKey: row.mirror_zone_key, mirror: true, mirrorOf: null };
  if (row.mirror_device_id) {
    return { zoneKey: row.target_zone ?? null, mirror: true, mirrorOf: row.mirror_device_id };
  }
  return { zoneKey: row.zone_key ?? null, mirror: false, mirrorOf: null };
}

/**
 * Whether the header names the zone (contracts/screen.md, `screen_name`): with `auto`, while the
 * event has two or more screens, counted as its devices assigned to a zone or mirroring one; a
 * session's mirror and a preview are no devices, so they never count.
 */
export async function showsName(
  c: SqlClient,
  zone: Pick<ZoneRow, "screen_name">,
): Promise<boolean> {
  if (zone.screen_name === "always") return true;
  if (zone.screen_name === "never") return false;
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM screen_assignments
     WHERE zone_key IS NOT NULL OR mirror_device_id IS NOT NULL OR mirror_zone_key IS NOT NULL`,
  );
  return ((rows[0] as { n: number } | undefined)?.n ?? 0) >= 2;
}
