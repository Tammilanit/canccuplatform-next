/**
 * The superadmin's global device registry (contracts/screen.md, Moving, renaming, revoking): list,
 * move (or park, rename, re-home) and delete devices across events. It answers only on the
 * superadmin hostname, and there only to a superadmin session (G2); everywhere else it is 404
 * before any sign-in check, so an event's hostname learns nothing about it.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isTenantId, normalizeHost, withTenant } from "@canccu/kit";
import type { Bus, Logger, RightsChecker, SqlClient, TenantResolver } from "@canccu/kit";
import type { Audit, AuditEntry } from "./audit.js";
import { asTenant } from "./db.js";
import type { Db, DeviceRow } from "./db.js";
import { detachDevice } from "./detach.js";
import { forgetHealth } from "./health.js";
import { body, deviceName, eventArchived, invalidRequest, noVenue, notFound } from "./http.js";
import type { Kv } from "./kv.js";
import { publishAll } from "./zones.js";
import type { Emit } from "./zones.js";

export const REGISTRY_PREFIX = "/api/screen/registry/";
const VENUE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface RegistryDeps {
  db: Db;
  kv: Kv;
  bus: Bus;
  rights: RightsChecker;
  audit: Audit;
  tenants: TenantResolver;
  /** `CANCCU_SUPERADMIN_HOSTNAME`; without it the registry answers nowhere. */
  superadminHost?: string;
  log?: Logger;
}

/** The contract's `RegistryDevice`. */
function registryView(row: DeviceRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    venue_id: row.venue_id,
    current_tenant_id: row.current_tenant_id,
    created_at: row.created_at.toISOString(),
    revoked_at: row.revoked_at?.toISOString() ?? null,
  };
}

/** What one event hears when a device leaves it, sent once the move has committed. */
interface Left {
  tenant: string;
  emits: Emit[];
}

/**
 * The old event's side of a device leaving it, in that event's RLS: mirrors and sound go
 * (detachDevice), then its assignment row. The caller holds the device's row lock.
 */
async function leave(
  c: SqlClient,
  deps: RegistryDeps,
  device: DeviceRow,
  actor: string,
  last: Emit,
): Promise<Left | null> {
  const tenant = device.current_tenant_id;
  if (tenant === null) return null;
  return asTenant(c, tenant, async () => {
    const emits = await detachDevice(c, device.id, { audit: deps.audit, actor });
    await c.query("DELETE FROM screen_assignments WHERE device_id = $1", [device.id]);
    return { tenant, emits: [...emits, last] };
  });
}

export function registryRoutes(app: FastifyInstance, deps: RegistryDeps): void {
  const { db } = deps;
  const host = normalizeHost(deps.superadminHost);

  /** 404 off the superadmin hostname, then the superadmin's session or 401/403. */
  async function superadmin(request: FastifyRequest): Promise<string> {
    if (host === undefined || normalizeHost(request.headers.host) !== host) throw notFound();
    const session = await deps.rights.requireSuperadmin(request.headers.cookie);
    request.session = session;
    return session.userId;
  }

  /**
   * After the commit, each side hears its events and the event left behind forgets the device's
   * health. The move is done by then: a failure here is logged, never turned into an error.
   */
  async function announce(deviceId: string, old: Left | null, arrived: Left | null): Promise<void> {
    try {
      for (const side of [old, arrived]) {
        if (side !== null) await withTenant(side.tenant, () => publishAll(deps.bus, side.emits));
      }
      if (old !== null) await withTenant(old.tenant, () => forgetHealth(deps.kv, deviceId));
    } catch (err) {
      deps.log?.error({ err, device_id: deviceId }, "after a registry change: events failed");
    }
  }

  app.get<{ Querystring: { venue_id?: string } }>(
    "/api/screen/registry/devices",
    async (request) => {
      await superadmin(request);
      const venue = request.query.venue_id ?? null;
      const { rows } = await db.global((c) =>
        c.query(
          "SELECT * FROM devices WHERE $1::text IS NULL OR venue_id = $1 ORDER BY created_at, id",
          [venue],
        ),
      );
      return { devices: rows.map((r) => registryView(r as unknown as DeviceRow)) };
    },
  );

  app.patch<{ Params: { device_id: string } }>(
    "/api/screen/registry/devices/:device_id",
    async (request) => {
      const actor = await superadmin(request);
      const input = body(request);
      const name = input.name === undefined ? undefined : deviceName(input.name);
      const venue = input.venue_id;
      if (venue !== undefined && (typeof venue !== "string" || !VENUE_ID_RE.test(venue))) {
        throw invalidRequest("`venue_id` must be a venue id.");
      }
      const target = input.current_tenant_id;
      if (target !== undefined && target !== null) {
        if (typeof target !== "string" || !isTenantId(target)) {
          throw invalidRequest("`current_tenant_id` must be an event id, or null to park it.");
        }
      }
      const [view, left] = await db.global(async (c) => {
        const found = await c.query("SELECT * FROM devices WHERE id = $1 FOR UPDATE", [
          request.params.device_id,
        ]);
        const before = found.rows[0] as unknown as DeviceRow | undefined;
        if (before === undefined) throw notFound();
        const after: DeviceRow = {
          ...before,
          name: name ?? before.name,
          venue_id: venue ?? before.venue_id,
          current_tenant_id: target === undefined ? before.current_tenant_id : target,
        };
        const moving = after.current_tenant_id !== before.current_tenant_id;
        if (moving && after.current_tenant_id !== null && before.revoked_at !== null) {
          throw invalidRequest("A revoked device cannot serve an event. Pair a new one.");
        }
        if (after.current_tenant_id !== null && (moving || after.venue_id !== before.venue_id)) {
          await checkTarget(deps.tenants, after.current_tenant_id, after.venue_id, moving);
        }
        const old = moving
          ? await leave(c, deps, before, actor, [
              "screen.device.released",
              { device_id: before.id, actor_user_id: actor },
            ])
          : null;
        await c.query(
          "UPDATE devices SET name = $2, venue_id = $3, current_tenant_id = $4 WHERE id = $1",
          [before.id, after.name, after.venue_id, after.current_tenant_id],
        );
        let arrived: Left | null = null;
        if (moving && after.current_tenant_id !== null) {
          const tenant = after.current_tenant_id;
          // A place in the new event without a zone: its crew assigns it there.
          await asTenant(c, tenant, () =>
            c.query("INSERT INTO screen_assignments (device_id) VALUES ($1)", [before.id]),
          );
          arrived = {
            tenant,
            emits: [
              [
                "screen.device.moved",
                { device_id: before.id, name: after.name, actor_user_id: actor },
              ],
            ],
          };
        }
        await deps.audit(changeEntry(before, after, actor));
        return [registryView(after), [old, arrived] as const] as const;
      });
      await announce(request.params.device_id, ...left);
      return view;
    },
  );

  app.delete<{ Params: { device_id: string } }>(
    "/api/screen/registry/devices/:device_id",
    async (request, reply) => {
      const actor = await superadmin(request);
      const left = await db.global(async (c) => {
        const found = await c.query("SELECT * FROM devices WHERE id = $1 FOR UPDATE", [
          request.params.device_id,
        ]);
        const device = found.rows[0] as unknown as DeviceRow | undefined;
        if (device === undefined) throw notFound();
        // An already revoked device's event heard `revoked` when it was.
        const side = await leave(c, deps, device, actor, [
          "screen.device.revoked",
          { device_id: device.id, actor_user_id: actor },
        ]);
        if (side !== null && device.revoked_at !== null) side.emits.pop();
        // The row goes with its token and every superseded token.
        await c.query("DELETE FROM devices WHERE id = $1", [device.id]);
        await deps.audit({
          tenant_id: null,
          actor_user_id: actor,
          action: "screen.device.deleted",
          target: { type: "device", id: device.id },
          changes: {
            name: { from: device.name, to: null },
            current_tenant_id: { from: device.current_tenant_id, to: null },
          },
        });
        return side;
      });
      await announce(request.params.device_id, left, null);
      return reply.status(204).send();
    },
  );
}

/** The event a device moves to must exist, take writes, and be at the device's venue. */
async function checkTarget(
  tenants: TenantResolver,
  tenantId: string,
  venueId: string | null,
  moving: boolean,
): Promise<void> {
  const ctx = await tenants.byId(tenantId);
  if (ctx === null) throw invalidRequest("There is no such event.");
  if (moving && ctx.status === "archived") throw eventArchived();
  if (ctx.venue === null) throw noVenue();
  if (ctx.venue.id !== venueId) {
    throw invalidRequest(
      "The event is at another venue. Set the device's `venue_id` to that venue in the same move.",
    );
  }
}

/** One platform entry: the registry acts above events (tenants.md, devices' current tenant). */
function changeEntry(before: DeviceRow, after: DeviceRow, actor: string): AuditEntry {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of ["current_tenant_id", "venue_id", "name"] as const) {
    if (before[field] !== after[field]) changes[field] = { from: before[field], to: after[field] };
  }
  const moved = "current_tenant_id" in changes || "venue_id" in changes;
  return {
    tenant_id: null,
    actor_user_id: actor,
    action: moved ? "screen.device.moved" : "screen.device.renamed",
    target: { type: "device", id: before.id },
    changes,
  };
}
