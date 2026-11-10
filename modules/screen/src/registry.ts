/**
 * The superadmin's global device registry (contracts/screen.md, Moving, renaming, revoking): list,
 * move (or park, rename, re-home) and delete devices across events. It answers only on the
 * superadmin hostname, and there only to a superadmin session (G2); everywhere else it is 404
 * before any sign-in check, so an event's hostname learns nothing about it.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isTenantId, normalizeHost, withTenant } from "@canccu/kit";
import type {
  Bus,
  Logger,
  RightsChecker,
  SqlClient,
  TenantContext,
  TenantResolver,
} from "@canccu/kit";
import type { Audit, AuditEntry } from "./audit.js";
import { asTenant } from "./db.js";
import type { Db, DeviceRow } from "./db.js";
import { announceLeft, leaveEvent, publishEach } from "./detach.js";
import type { Left } from "./detach.js";
import {
  body,
  deviceName,
  eventArchived,
  invalidRequest,
  noVenue,
  notFound,
  versionConflict,
} from "./http.js";
import type { Kv } from "./kv.js";
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

/** Whether `requestHost` is the superadmin hostname; never without one configured. */
export function onSuperadminHost(
  superadminHost: string | undefined,
  requestHost: string | undefined,
): boolean {
  const host = normalizeHost(superadminHost);
  return host !== undefined && normalizeHost(requestHost) === host;
}

/** The fields a PATCH sets; `undefined` leaves one as it is. */
interface Patch {
  name: string | undefined;
  venue_id: string | undefined;
  current_tenant_id: string | null | undefined;
}

function patchOf(input: Record<string, unknown>): Patch {
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
  return { name, venue_id: venue, current_tenant_id: target };
}

function applied(before: DeviceRow, patch: Patch): DeviceRow {
  return {
    ...before,
    name: patch.name ?? before.name,
    venue_id: patch.venue_id ?? before.venue_id,
    current_tenant_id:
      patch.current_tenant_id === undefined ? before.current_tenant_id : patch.current_tenant_id,
  };
}

/** The event to check the device against: one it moves to, or whose venue it leaves. */
function eventToCheck(before: DeviceRow, after: DeviceRow): string | null {
  const moving = after.current_tenant_id !== before.current_tenant_id;
  if (after.current_tenant_id === null || !(moving || after.venue_id !== before.venue_id)) {
    return null;
  }
  return after.current_tenant_id;
}

export function registryRoutes(app: FastifyInstance, deps: RegistryDeps): void {
  const { db } = deps;

  /** 404 off the superadmin hostname (app.ts says so before parsing), then the session. */
  async function superadmin(request: FastifyRequest): Promise<string> {
    if (!onSuperadminHost(deps.superadminHost, request.headers.host)) throw notFound();
    const session = await deps.rights.requireSuperadmin(request.headers.cookie);
    request.session = session;
    return session.userId;
  }

  /** Its current event's side of the device leaving; the caller holds the row lock. */
  function leaveCurrent(
    c: SqlClient,
    device: DeviceRow,
    actor: string,
    last: Emit,
  ): Promise<Left | null> {
    const from = device.current_tenant_id;
    if (from === null) return Promise.resolve(null);
    // A revoked device's event heard `revoked` when it was; it hears nothing more.
    const told = device.revoked_at === null ? last : undefined;
    return asTenant(c, from, () => leaveEvent(c, device.id, { audit: deps.audit, actor }, told));
  }

  /** After the commit: the event left behind (announceLeft), then the one the device joined. */
  async function announce(old: Left | null, joined: Left | null): Promise<void> {
    if (old !== null) await announceLeft(deps, old);
    if (joined !== null) await withTenant(joined.tenant, () => publishEach(deps, joined.emits));
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
      const patch = patchOf(body(request));
      const id = request.params.device_id;
      // The tenants lookup goes over the network: done before the row lock, so a slow tenants
      // module never holds the device's heartbeats and transfers. Checked again under the lock.
      const seen = await readDevice(db, id);
      const wanted = eventToCheck(seen, applied(seen, patch));
      const target = wanted === null ? null : await deps.tenants.byId(wanted);
      const [view, old, joined] = await db.global(async (c) => {
        const found = await c.query("SELECT * FROM devices WHERE id = $1 FOR UPDATE", [id]);
        const before = found.rows[0] as unknown as DeviceRow | undefined;
        if (before === undefined) throw notFound();
        const after = applied(before, patch);
        const moving = after.current_tenant_id !== before.current_tenant_id;
        if (moving && after.current_tenant_id !== null && before.revoked_at !== null) {
          throw invalidRequest("A revoked device cannot serve an event. Pair a new one.");
        }
        const check = eventToCheck(before, after);
        if (check !== null) {
          // Moved by someone else since the lookup, which then named another event.
          if (check !== wanted) throw versionConflict("device");
          checkTarget(target, after.venue_id, moving);
        }
        const entry = changeEntry(before, after, actor);
        if (entry === null) return [registryView(before), null, null] as const;
        const left = moving
          ? await leaveCurrent(c, before, actor, [
              "screen.device.released",
              { device_id: before.id, actor_user_id: actor },
            ])
          : null;
        await c.query(
          "UPDATE devices SET name = $2, venue_id = $3, current_tenant_id = $4 WHERE id = $1",
          [before.id, after.name, after.venue_id, after.current_tenant_id],
        );
        let arrived: Left | null = null;
        const to = after.current_tenant_id;
        if (moving && to !== null) {
          // A place in the new event without a zone: its crew assigns it there.
          await asTenant(c, to, () =>
            c.query("INSERT INTO screen_assignments (device_id) VALUES ($1)", [before.id]),
          );
          const data = { device_id: before.id, name: after.name, actor_user_id: actor };
          arrived = { tenant: to, deviceId: before.id, emits: [["screen.device.moved", data]] };
        }
        await deps.audit(entry);
        return [registryView(after), left, arrived] as const;
      });
      await announce(old, joined);
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
        const side = await leaveCurrent(c, device, actor, [
          "screen.device.revoked",
          { device_id: device.id, actor_user_id: actor },
        ]);
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
      await announce(left, null);
      return reply.status(204).send();
    },
  );
}

async function readDevice(db: Db, id: string): Promise<DeviceRow> {
  const { rows } = await db.global((c) => c.query("SELECT * FROM devices WHERE id = $1", [id]));
  const row = rows[0] as unknown as DeviceRow | undefined;
  if (row === undefined) throw notFound();
  return row;
}

/** The event a device moves to must exist, take writes, and be at the device's venue. */
function checkTarget(ctx: TenantContext | null, venueId: string | null, moving: boolean): void {
  if (ctx === null) throw invalidRequest("There is no such event.");
  if (moving && ctx.status === "archived") throw eventArchived();
  if (ctx.venue === null) throw noVenue();
  if (ctx.venue.id !== venueId) {
    throw invalidRequest(
      "The event is at another venue. Set the device's `venue_id` to that venue in the same move.",
    );
  }
}

/**
 * One platform entry (the registry acts above events; tenants.md, devices' current tenant), or
 * null when nothing changes. `moved` is a change of event; a new venue alone is `rehomed`.
 */
function changeEntry(before: DeviceRow, after: DeviceRow, actor: string): AuditEntry | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of ["current_tenant_id", "venue_id", "name"] as const) {
    if (before[field] !== after[field]) changes[field] = { from: before[field], to: after[field] };
  }
  if (Object.keys(changes).length === 0) return null;
  const action =
    "current_tenant_id" in changes
      ? "screen.device.moved"
      : "venue_id" in changes
        ? "screen.device.rehomed"
        : "screen.device.renamed";
  return {
    tenant_id: null,
    actor_user_id: actor,
    action,
    target: { type: "device", id: before.id },
    changes,
  };
}
