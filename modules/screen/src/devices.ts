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
import { assertWritable, body, deviceName, needs, notFound, tenantOf } from "./http.js";

/** The contract's `Device`; zones, mirrors and health join it with #220 and #222. */
export function deviceView(row: DeviceRow, pairedAt: Date | undefined): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    zone_key: null,
    mirror_of: null,
    ...(pairedAt === undefined ? {} : { paired_at: pairedAt.toISOString() }),
  };
}

const EVENT_DEVICES_SQL = `SELECT d.*, a.paired_at FROM devices d
  LEFT JOIN assignments a ON a.device_id = d.id
  WHERE d.current_tenant_id = $1 AND d.revoked_at IS NULL`;

/** A device of the current event, or 404. `FOR UPDATE` when the caller changes it. */
export async function eventDevice(
  client: SqlClient,
  id: string,
  lock = false,
): Promise<DeviceRow & { paired_at?: Date }> {
  const { rows } = await client.query(
    `${EVENT_DEVICES_SQL} AND d.id = $2${lock ? " FOR UPDATE OF d" : ""}`,
    [requireTenant(), id],
  );
  const row = rows[0];
  if (row === undefined) throw notFound();
  return row as unknown as DeviceRow & { paired_at?: Date };
}

export interface DeviceDeps {
  db: Db;
  bus: Bus;
  rights: RightsChecker;
  audit: Audit;
}

type ById = { Params: { device_id: string } };

export function deviceRoutes(app: FastifyInstance, deps: DeviceDeps): void {
  const { db } = deps;

  app.get(
    "/api/screen/devices",
    { preHandler: needs(deps.rights, "screen.devices.read") },
    async () => {
      const rows = await db.tenant(
        async (c) =>
          (await c.query(`${EVENT_DEVICES_SQL} ORDER BY d.name, d.id`, [requireTenant()])).rows,
      );
      return {
        devices: rows.map((r) =>
          deviceView(r as unknown as DeviceRow, (r.paired_at as Date | null) ?? undefined),
        ),
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
          actor_user_id: request.session?.userId ?? null,
          action: "screen.device.renamed",
          target: { type: "device", id: before.id },
          changes: { name: { from: before.name, to: name } },
        });
        return deviceView({ ...before, name }, before.paired_at);
      });
    },
  );

  app.post<ById>(
    "/api/screen/devices/:device_id/revoke",
    { preHandler: needs(deps.rights, "screen.devices.write") },
    async (request, reply) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const actor = request.session?.userId ?? null;
      const id = await db.tenant(async (c) => {
        const device = await eventDevice(c, request.params.device_id, true);
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
        return device.id;
      });
      await deps.bus.publish(
        "screen.device.revoked",
        { device_id: id, actor_user_id: actor },
        { version: 1 },
      );
      return reply.status(204).send();
    },
  );
}
