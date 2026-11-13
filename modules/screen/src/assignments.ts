/**
 * A device's zone or mirror target in the event (contracts/screen.md, Zones and assignments),
 * and the commands crew send it. Every route reaches the device through `eventDevice`, so an
 * earlier event's admin can neither assign nor command a device that has moved on.
 */
import type { FastifyInstance } from "fastify";
import { tenantKey } from "@canccu/kit";
import type { Bus, RightsChecker, SqlClient } from "@canccu/kit";
import type { Audit } from "./audit.js";
import { announcePreview, endPreview } from "./preview/store.js";
import type { Db } from "./db.js";
import { deviceView, eventDevice, findEventDevice, mirrorOf } from "./devices.js";
import type { EventDevice } from "./devices.js";
import {
  actorOf,
  assertWritable,
  body,
  invalidRequest,
  needs,
  newId,
  notFound,
  tenantOf,
  unknownZone,
} from "./http.js";
import type { Kv } from "./kv.js";
import { keys } from "./push/store.js";
import type { Fanout } from "./push/store.js";
import { zoneKey } from "./zone-input.js";
import { publishAll, releaseSound, seededFor, zoneExistsHere } from "./zones.js";
import type { Emit } from "./zones.js";

interface Target {
  zone_key: string | null;
  mirror_device_id: string | null;
  mirror_zone_key: string | null;
}

const NONE: Target = { zone_key: null, mirror_device_id: null, mirror_zone_key: null };

/** The contract's `Assignment`: exactly one of `zone_key` and `mirror_of`, which holds one target. */
function targetInput(value: Record<string, unknown>): Target {
  const { zone_key, mirror_of, ...rest } = value;
  if (Object.keys(rest).length > 0 || (zone_key === undefined) === (mirror_of === undefined)) {
    throw invalidRequest("Send exactly one of `zone_key` and `mirror_of`.");
  }
  if (zone_key !== undefined) return { ...NONE, zone_key: zoneKey(zone_key, "zone_key") };
  if (typeof mirror_of !== "object" || mirror_of === null || Array.isArray(mirror_of)) {
    throw invalidRequest("`mirror_of` must be an object.");
  }
  const m = mirror_of as Record<string, unknown>;
  const keys = Object.keys(m);
  if (keys.length !== 1) {
    throw invalidRequest("`mirror_of` holds exactly one of `device_id` and `zone_key`.");
  }
  if (keys[0] === "zone_key") {
    return { ...NONE, mirror_zone_key: zoneKey(m.zone_key, "mirror_of.zone_key") };
  }
  if (keys[0] !== "device_id" || typeof m.device_id !== "string") {
    throw invalidRequest("`mirror_of` holds exactly one of `device_id` and `zone_key`.");
  }
  return { ...NONE, mirror_device_id: m.device_id };
}

/**
 * Checks the target and locks every device it involves, in id order so two crossing mirror
 * requests cannot deadlock. A mirror shows a zone or what a device that is no mirror shows (its
 * zone, or "not assigned"), never a chain: so a mirror's target is no mirror, and a device
 * others mirror cannot become one.
 */
async function lockForTarget(c: SqlClient, deviceId: string, target: Target): Promise<EventDevice> {
  const ids = [deviceId, target.mirror_device_id].filter((x): x is string => x !== null).sort();
  const locked = new Map<string, EventDevice | undefined>();
  for (const id of ids) locked.set(id, await findEventDevice(c, id, true));
  const device = locked.get(deviceId);
  if (device === undefined) throw notFound();
  const key = target.zone_key ?? target.mirror_zone_key;
  if (key !== null && !(await zoneExistsHere(c, key))) throw unknownZone();
  if (target.mirror_device_id !== null) {
    const shown = locked.get(target.mirror_device_id);
    if (target.mirror_device_id === deviceId)
      throw invalidRequest("A screen cannot mirror itself.");
    if (shown === undefined)
      throw invalidRequest("`mirror_of.device_id` is no screen of this event.");
    // The mirror foreign key needs the target's row; a device moved here (#221) may lack one.
    if (!shown.paired_at) {
      throw invalidRequest("That screen has no place in this event yet: assign it first.");
    }
    if (mirrorOf(shown) !== null) {
      throw invalidRequest("That screen mirrors another one: mirror what it shows instead.");
    }
  }
  if (target.mirror_device_id !== null || target.mirror_zone_key !== null) {
    const { rows } = await c.query(
      "SELECT 1 FROM screen_assignments WHERE mirror_device_id = $1 LIMIT 1",
      [deviceId],
    );
    if (rows.length > 0) {
      throw invalidRequest("Other screens mirror this one: assign them elsewhere first.");
    }
  }
  return device;
}

export interface AssignmentDeps {
  db: Db;
  kv: Kv;
  bus: Bus;
  rights: RightsChecker;
  audit: Audit;
  /** Wakes the device's open stream, whichever container holds it. */
  fanout: Fanout;
  now?: () => number;
}

type ById = { Params: { device_id: string } };

export function assignmentRoutes(app: FastifyInstance, deps: AssignmentDeps): void {
  const { db, bus } = deps;
  const now = deps.now ?? Date.now;
  const write = needs(deps.rights, "screen.devices.write");

  /** Sets the device's target in one transaction: audited, events after commit. */
  async function place(request: Parameters<typeof tenantOf>[0], target: Target | null) {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const actor = actorOf(request);
    const id = (request.params as { device_id: string }).device_id;
    const next = target ?? NONE;
    const [emits, view, previewEnded] = await db.tenant(async (c) => {
      const seeded = await seededFor(ctx, c);
      const before = await lockForTarget(c, id, next);
      // Even to the same zone: a preview never outlives the assignment it was started for.
      const ended = await endPreview(c, before.id, deps.audit, null);
      // Upsert: a device the superadmin moves here (#221) may have no row in this event yet.
      await c.query(
        `INSERT INTO screen_assignments (device_id, zone_key, mirror_device_id, mirror_zone_key)
         VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, device_id) DO UPDATE
         SET zone_key = $2, mirror_device_id = $3, mirror_zone_key = $4`,
        [before.id, next.zone_key, next.mirror_device_id, next.mirror_zone_key],
      );
      const after: EventDevice = { ...before, ...next };
      const released = await releaseSound(c, before.id, next.zone_key, actor);
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actor,
        action: "screen.device.assigned",
        target: { type: "device", id: before.id },
        changes: {
          zone_key: { from: before.zone_key ?? null, to: next.zone_key },
          mirror_of: { from: mirrorOf(before), to: mirrorOf(after) },
        },
      });
      const assigned: Emit = [
        "screen.device.assigned",
        {
          device_id: before.id,
          zone_key: next.zone_key,
          mirror_of: mirrorOf(after),
          actor_user_id: actor,
        },
      ];
      return [[...seeded, ...released, assigned], deviceView(after), ended] as const;
    });
    await publishAll(bus, emits);
    if (previewEnded) await announcePreview(deps, id);
    return view;
  }

  app.put<ById>(
    "/api/screen/devices/:device_id/assignment",
    { preHandler: write },
    async (request) => place(request, targetInput(body(request))),
  );

  app.delete<ById>(
    "/api/screen/devices/:device_id/assignment",
    { preHandler: write },
    async (request, reply) => {
      await place(request, null);
      return reply.status(204).send();
    },
  );

  app.post<ById>(
    "/api/screen/devices/:device_id/commands",
    { preHandler: write },
    async (request, reply) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const command = body(request).command;
      if (command !== "reload" && command !== "identify") {
        throw invalidRequest("`command` must be `reload` or `identify`.");
      }
      const device = await db.tenant((c) => eventDevice(c, request.params.device_id));
      // Recorded before it is queued, so no command reaches a screen unrecorded.
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actorOf(request),
        action: "screen.device.command_sent",
        target: { type: "device", id: device.id },
        changes: { command: { from: null, to: command } },
      });
      await queueCommand(deps, device.id, command, now());
      return reply.status(202).send();
    },
  );
}

/** A command not delivered within this is dropped (contracts/screen.md, Commands). */
export const COMMAND_TTL_MS = 60_000;

/** Queues `command` for the device, in the current event's keys, and nudges its open streams. */
export async function queueCommand(
  deps: { kv: Kv; fanout: Pick<Fanout, "publish"> },
  deviceId: string,
  command: PendingCommand["command"],
  nowMs: number,
): Promise<void> {
  const expiresAt = nowMs + COMMAND_TTL_MS;
  const entry = { id: newId("cm"), command, expires_at: new Date(expiresAt).toISOString() };
  await deps.kv.addExpiring(commandsKey(deviceId), JSON.stringify(entry), expiresAt);
  // Best effort: a stream that misses the nudge takes the command at its next ping.
  await deps.fanout.publish(keys.deviceChannel(deviceId), "commands").catch(() => undefined);
}

/** Per device, in the current event's keys: a moved device never gets the old event's commands. */
function commandsKey(deviceId: string): string {
  return tenantKey("screen", "commands", deviceId);
}

export interface PendingCommand {
  command: "reload" | "identify";
  expires_at: string;
}

/**
 * The device's undelivered commands, oldest first, each handed out once: the push channel sends
 * them as `command` messages. Run inside the device's tenant.
 */
export async function takeCommands(
  kv: Kv,
  deviceId: string,
  nowMs: number,
): Promise<PendingCommand[]> {
  // One atomic read-and-clear, so two open streams never both deliver a command.
  return (await kv.takeLive(commandsKey(deviceId), nowMs))
    .map((member) => {
      const { command, expires_at } = JSON.parse(member) as PendingCommand;
      return { command, expires_at };
    })
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at));
}
