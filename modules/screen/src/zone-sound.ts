/**
 * A zone's sound device (contracts/screen.md, Zones and assignments): the lock and the check a
 * zone save runs, and the release when the device leaves the zone.
 */
import { requireTenant } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { invalidRequest } from "./http.js";
import type { Emit } from "./zones.js";

/**
 * Lock order for a sound device: its `devices` row first, as reassignment and revoke take it
 * (`FOR UPDATE`) before they touch its assignment row or a zone (`releaseSound`). A zone save
 * takes it (`FOR SHARE`) before its zone row, so the two serialise on the device and never
 * deadlock. Whichever goes second sees the first's commit: a waiting save re-reads the device's
 * placement and refuses it; a waiting reassignment's `releaseSound` sees and clears the id.
 */
export async function lockSoundDevice(c: SqlClient, deviceId: string | null): Promise<void> {
  if (deviceId !== null) {
    await c.query("SELECT 1 FROM devices WHERE id = $1 FOR SHARE", [deviceId]);
  }
}

/** The sound device must be a device of this event assigned to this very zone. */
export async function checkSoundDevice(
  c: SqlClient,
  key: string,
  deviceId: string | null,
): Promise<void> {
  if (deviceId === null) return;
  const { rows } = await c.query(
    `SELECT 1 FROM screen_assignments a JOIN devices d ON d.id = a.device_id
     WHERE a.device_id = $1 AND a.zone_key = $2 AND d.current_tenant_id = $3 AND d.revoked_at IS NULL
     FOR SHARE OF a, d`,
    [deviceId, key, requireTenant()],
  );
  if (rows.length === 0) {
    throw invalidRequest("`sound.device_id` must be a screen assigned to this zone.");
  }
}

/**
 * Zones other than `keep` whose sound device is `deviceId` lose it: the device left them
 * (contracts/screen.md, No dangling references). Each is a saved zone with a new revision.
 */
export async function releaseSound(
  c: SqlClient,
  deviceId: string,
  keep: string | null,
  actor: string | null,
): Promise<Emit[]> {
  const { rows } = await c.query(
    `UPDATE screen_zones SET sound = jsonb_set(sound, '{device_id}', 'null'::jsonb),
       revision = revision + 1, updated_at = now()
     WHERE sound->>'device_id' = $1 AND key IS DISTINCT FROM $2 RETURNING key, revision`,
    [deviceId, keep],
  );
  return rows.map((r) => [
    "screen.zone.saved",
    { zone_key: r.key, revision: r.revision, changed: ["sound"], actor_user_id: actor },
  ]);
}
