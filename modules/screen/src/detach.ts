/**
 * A device leaving an event: revoked there, moved away, parked or deleted (contracts/screen.md,
 * Moving, renaming, revoking; plan #107, D10). Every path runs `leaveEvent` in its transaction
 * and `announceLeft` after the commit, so none of them can leave a dangling reference behind,
 * or health that the event's offline sweep would later report.
 */
import { requireTenant, withTenant } from "@canccu/kit";
import type { Bus, Logger, SqlClient } from "@canccu/kit";
import type { Audit } from "./audit.js";
import { forgetHealth } from "./health.js";
import type { Kv } from "./kv.js";
import { endPreview } from "./preview/store.js";
import { releaseSound } from "./zones.js";
import type { Emit } from "./zones.js";

/** What one event hears when a device leaves it, sent once the leaving has committed. */
export interface Left {
  tenant: string;
  deviceId: string;
  emits: Emit[];
}

/**
 * The current event's side of a device leaving it: mirrors, sound and its preview go, then its
 * assignment row. `last` is what the event hears about the device itself; none when it heard it already (a
 * device revoked earlier). The caller holds the device's row lock.
 */
export async function leaveEvent(
  c: SqlClient,
  deviceId: string,
  by: { audit: Audit; actor: string | null },
  last?: Emit,
): Promise<Left> {
  const emits = await detachDevice(c, deviceId, by);
  // Before the row its preview refers to: ended with the module as actor, so the log says why.
  await endPreview(c, deviceId, by.audit, null);
  await c.query("DELETE FROM screen_assignments WHERE device_id = $1", [deviceId]);
  return { tenant: requireTenant(), deviceId, emits: last ? [...emits, last] : emits };
}

export interface AnnounceDeps {
  bus: Bus;
  kv: Kv;
  log?: Logger;
}

/**
 * Each event of the current tenant on its own. The change has committed, so a failure is logged,
 * never thrown: a retry would find nothing left to do, and one lost event must not cost the rest.
 */
export async function publishEach(deps: AnnounceDeps, emits: readonly Emit[]): Promise<void> {
  for (const [type, data] of emits) {
    try {
      await deps.bus.publish(type, data, { version: 1 });
    } catch (err) {
      deps.log?.error({ err, type, tenant_id: requireTenant() }, "an event after a commit failed");
    }
  }
}

/** After the commit: the event left behind hears its events and forgets the device's health. */
export async function announceLeft(deps: AnnounceDeps, left: Left): Promise<void> {
  await withTenant(left.tenant, async () => {
    await publishEach(deps, left.emits);
    try {
      await forgetHealth(deps.kv, left.deviceId);
    } catch (err) {
      deps.log?.error({ err, device_id: left.deviceId }, "forgetting a device's health failed");
    }
  });
}

/**
 * Unassigns the devices that mirror the device and gives a zone that plays sound on it `null`
 * there. Before the device's assignment row goes, which the mirrors' foreign key would refuse.
 */

async function detachDevice(
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
