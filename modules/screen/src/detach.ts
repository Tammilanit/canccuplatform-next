/**
 * No dangling references (contracts/screen.md, Moving, renaming, revoking; plan #107, D10): when
 * a device leaves the event (revoked, moved away or deleted, src/registry.ts) the devices that
 * mirror it are unassigned and a zone that plays sound on it gets `null` there. Every leaving
 * path calls this one function, in its own transaction and before the device's assignment row
 * goes, which the foreign key from the mirrors would otherwise refuse.
 */
import { requireTenant } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import type { Audit } from "./audit.js";
import { releaseSound } from "./zones.js";
import type { Emit } from "./zones.js";

export async function detachDevice(
  c: SqlClient,
  deviceId: string,
  by: { audit: Audit; actor: string | null },
): Promise<Emit[]> {
  const { rows } = await c.query(
    "UPDATE screen_assignments SET mirror_device_id = NULL WHERE mirror_device_id = $1 RETURNING device_id",
    [deviceId],
  );
  const emits: Emit[] = [];
  for (const row of rows) {
    const mirror = row.device_id as string;
    // An assignment change like any other: audited, so the log shows why the screen went blank.
    await by.audit({
      tenant_id: requireTenant(),
      actor_user_id: by.actor,
      action: "screen.device.assigned",
      target: { type: "device", id: mirror },
      changes: {
        zone_key: { from: null, to: null },
        mirror_of: { from: { device_id: deviceId }, to: null },
      },
    });
    emits.push([
      "screen.device.assigned",
      { device_id: mirror, zone_key: null, mirror_of: null, actor_user_id: by.actor },
    ]);
  }
  return [...emits, ...(await releaseSound(c, deviceId, null, by.actor))];
}
