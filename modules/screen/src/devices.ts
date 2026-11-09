/**
 * The event's devices (contracts/screen.md, Devices): list, rename, revoke. `devices` is global
 * and has no RLS, so every event route reads it through `eventDevice`, which answers 404 unless
 * the device's current event is the request's: an earlier event's admin can never reach it.
 */
import type { FastifyInstance } from "fastify";
import { requireTenant } from "@canccu/kit";
import type { Bus, RightsChecker, SqlClient } from "@canccu/kit";
import type { Audit } from "./audit.js";
import type { Db, DeviceRow } from "./db.js";
import { detachDevice } from "./detach.js";
import { healthOf } from "./health.js";
import { actorOf, assertWritable, body, deviceName, needs, notFound, tenantOf } from "./http.js";
import type { Kv } from "./kv.js";
import { publishAll } from "./zones.js";

/** A device's place in the event: its `assignments` row, joined by every event read. */
export interface Placement {
  paired_at?: Date | null;
  zone_key?: string | null;
  mirror_device_id?: string | null;
  mirror_zone_key?: string | null;
}

export type EventDevice = DeviceRow & Placement;

/** The contract's `MirrorTarget`, or null. */
export function mirrorOf(p: Placement): { device_id: string } | { zone_key: string } | null {
  if (p.mirror_device_id) return { device_id: p.mirror_device_id };
  if (p.mirror_zone_key) return { zone_key: p.mirror_zone_key };
  return null;
}

/** The contract's `Device`; the list adds its `health`. */
export function deviceView(row: EventDevice): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    zone_key: row.zone_key ?? null,
    mirror_of: mirrorOf(row),
    ...(row.paired_at ? { paired_at: row.paired_at.toISOString() } : {}),
  };
}

const EVENT_DEVICES_SQL = `SELECT d.*, a.paired_at, a.zone_key, a.mirror_device_id, a.mirror_zone_key
  FROM devices d LEFT JOIN assignments a ON a.device_id = d.id
  WHERE d.current_tenant_id = $1 AND d.revoked_at IS NULL`;

/** A device of the current event, or undefined. `FOR UPDATE` when the caller changes it. */
export async function findEventDevice(
  client: SqlClient,
  id: string,
  lock = false,
): Promise<EventDevice | undefined> {
  const { rows } = await client.query(
    `${EVENT_DEVICES_SQL} AND d.id = $2${lock ? " FOR UPDATE OF d" : ""}`,
    [requireTenant(), id],
  );
  return rows[0] as unknown as EventDevice | undefined;
}

/** A device of the current event, or 404: the one gate of every event device route. */
export async function eventDevice(
  client: SqlClient,
  id: string,
  lock = false,
): Promise<EventDevice> {
  const row = await findEventDevice(client, id, lock);
  if (row === undefined) throw notFound();
  return row;
}

export interface DeviceDeps {
  db: Db;
  kv: Kv;
  bus: Bus;
  rights: RightsChecker;
  audit: Audit;
  now?: () => number;
}

type ById = { Params: { device_id: string } };

export function deviceRoutes(app: FastifyInstance, deps: DeviceDeps): void {
  const { db } = deps;
  const now = deps.now ?? Date.now;

  app.get(
    "/api/screen/devices",
    { preHandler: needs(deps.rights, "screen.devices.read") },
    async () => {
      const rows = await db.tenant(
        async (c) =>
          (await c.query(`${EVENT_DEVICES_SQL} ORDER BY d.name, d.id`, [requireTenant()])).rows,
      );
      const health = await healthOf(
        deps.kv,
        rows.map((r) => r.id as string),
        now(),
      );
      return {
        devices: rows.map((r) => ({
          ...deviceView(r as unknown as EventDevice),
          health: health.get(r.id as string),
        })),
      };
    },
  );

  app.patch<ById>(
    "/api/screen/devices/:device_id",
    { preHandler: needs(deps.rights, "screen.devices.write") },
    async (request) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const name = deviceName(body(request).name);
      return db.tenant(async (c) => {
        const before = await eventDevice(c, request.params.device_id, true);
        await c.query("UPDATE devices SET name = $2 WHERE id = $1", [before.id, name]);
        await deps.audit({
          tenant_id: ctx.tenant_id,
          actor_user_id: actorOf(request),
          action: "screen.device.renamed",
          target: { type: "device", id: before.id },
          changes: { name: { from: before.name, to: name } },
        });
        return deviceView({ ...before, name });
      });
    },
  );

  app.post<ById>(
    "/api/screen/devices/:device_id/revoke",
    { preHandler: needs(deps.rights, "screen.devices.write") },
    async (request, reply) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const actor = actorOf(request);
      const [id, emits] = await db.tenant(async (c) => {
        const device = await eventDevice(c, request.params.device_id, true);
        const detached = await detachDevice(c, device.id, { audit: deps.audit, actor });
        // The token and every superseded token stop at once; the kiosk goes back to pairing.
        await c.query(
          "UPDATE devices SET revoked_at = now(), token_hash = NULL, superseded_token_hashes = '[]'::jsonb WHERE id = $1",
          [device.id],
        );
        await c.query("DELETE FROM assignments WHERE device_id = $1", [device.id]);
        await deps.audit({
          tenant_id: ctx.tenant_id,
          actor_user_id: actor,
          action: "screen.device.revoked",
          target: { type: "device", id: device.id },
        });
        return [device.id, detached] as const;
      });
      await publishAll(deps.bus, emits);
      await deps.bus.publish(
        "screen.device.revoked",
        { device_id: id, actor_user_id: actor },
        { version: 1 },
      );
      return reply.status(204).send();
    },
  );
}
