/**
 * The event's pin as screen keeps it (contracts/screen.md, Pins and Timed pins and freeze): the
 * row, its changes with the event, audit and `reload` each one carries, and the bundle retention
 * that holds every version a pin names or restores.
 */
import { isTenantId, requireTenant, withTenant } from "@canccu/kit";
import type { Bus, SqlClient } from "@canccu/kit";
import { queueCommand } from "../assignments.js";
import type { Audit } from "../audit.js";
import type { Db } from "../db.js";
import type { Kv } from "../kv.js";
import type { Fanout } from "../push/store.js";
import { publishAll } from "../zones.js";
import type { Emit } from "../zones.js";
import type { BundleStore } from "./bundles.js";

export interface PinValues {
  bundle_version: string | null;
  theme_revision: number | null;
}

export interface PinRow extends PinValues {
  until: Date | null;
  restores: PinValues | null;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: Date | null;
}

export type PinReason = "set" | "cleared" | "expired";

export const NO_PIN: PinRow = {
  bundle_version: null,
  theme_revision: null,
  until: null,
  restores: null,
  changed_by: null,
  changed_by_name: null,
  changed_at: null,
};

const COLUMNS =
  "bundle_version, theme_revision, until, restores, changed_by, changed_by_name, changed_at";

export async function readPin(c: SqlClient): Promise<PinRow> {
  const { rows } = await c.query(`SELECT ${COLUMNS} FROM screen_pins`);
  return (rows[0] as PinRow | undefined) ?? NO_PIN;
}

/** The pin locked for a change; the row is made first, so two first writers also queue. */
export async function lockPin(c: SqlClient): Promise<PinRow> {
  await c.query("INSERT INTO screen_pins DEFAULT VALUES ON CONFLICT DO NOTHING");
  const { rows } = await c.query(`SELECT ${COLUMNS} FROM screen_pins FOR UPDATE`);
  return rows[0] as unknown as PinRow;
}

/** A committed change still to announce: its event, and the screens of the event to reload. */
export interface PinChange {
  emit: Emit;
  devices: string[];
}

/**
 * Writes `next` over `before` under the pin's lock and audits it (without `actor_user_id` for the
 * tick's restore); the caller hands the result to `announcePin` after commit.
 */
export async function changePin(
  deps: { audit: Audit },
  c: SqlClient,
  before: PinRow,
  next: PinRow,
  reason: PinReason,
): Promise<PinChange> {
  const tenant = requireTenant();
  await c.query(
    `UPDATE screen_pins SET bundle_version = $1, theme_revision = $2, until = $3, restores = $4,
       changed_by = $5, changed_by_name = $6, changed_at = $7`,
    [
      next.bundle_version,
      next.theme_revision,
      next.until,
      next.restores === null ? null : JSON.stringify(next.restores),
      next.changed_by,
      next.changed_by_name,
      next.changed_at,
    ],
  );
  const holds =
    next.bundle_version !== null || next.theme_revision !== null || next.restores !== null;
  await c.query(
    holds
      ? "INSERT INTO screen_pin_tenants (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING"
      : "DELETE FROM screen_pin_tenants WHERE tenant_id = $1",
    [tenant],
  );
  const until = (row: PinRow) => row.until?.toISOString() ?? null;
  await deps.audit({
    tenant_id: tenant,
    // The tick's restore has no person behind it: the module is the actor.
    actor_user_id: reason === "expired" ? null : next.changed_by,
    action: `screen.pin.${reason}`,
    target: { type: "pin", id: "pin" },
    changes: {
      bundle_version: { from: before.bundle_version, to: next.bundle_version },
      theme_revision: { from: before.theme_revision, to: next.theme_revision },
      until: { from: until(before), to: until(next) },
    },
  });
  const { rows } = await c.query(
    "SELECT id FROM devices WHERE current_tenant_id = $1 AND revoked_at IS NULL",
    [tenant],
  );
  return {
    emit: [
      "screen.pin.changed",
      {
        bundle_version: next.bundle_version,
        theme_revision: next.theme_revision,
        until: until(next),
        restores: next.restores,
        reason,
        actor_user_id: reason === "expired" ? null : next.changed_by,
      },
    ],
    devices: rows.map((r) => r.id as string),
  };
}

/**
 * Publishes the change and queues a `reload` for every screen of the event. Only after commit:
 * a screen reloads on the nudge at once and reads the pin then, so a reload before commit would
 * load the old bundle and stay on it.
 */
export async function announcePin(
  deps: { bus: Bus; kv: Kv; fanout: Pick<Fanout, "publish"> },
  change: PinChange,
  nowMs: number,
): Promise<void> {
  await publishAll(deps.bus, [change.emit]);
  for (const device of change.devices) await queueCommand(deps, device, "reload", nowMs);
}

/** Every bundle version an event's pin names or its timed pin restores, across events. */
export async function heldBundles(db: Db): Promise<Set<string>> {
  const tenants = await db.global(async (c) =>
    (await c.query("SELECT tenant_id FROM screen_pin_tenants")).rows.map(
      (r) => r.tenant_id as string,
    ),
  );
  const held = new Set<string>();
  for (const tenant of tenants.filter(isTenantId)) {
    const pin = await withTenant(tenant, () => db.tenant(readPin));
    for (const v of [pin.bundle_version, pin.restores?.bundle_version]) if (v) held.add(v);
  }
  return held;
}

/** At start: copies this container's bundle in, then lets go of the versions nothing holds. */
export async function keepBundles(deps: { db: Db; store: BundleStore }): Promise<void> {
  await deps.store.install();
  await deps.store.prune(await heldBundles(deps.db));
}
