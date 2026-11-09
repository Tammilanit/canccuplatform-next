/**
 * The event's zones (contracts/screen.md, Zones and assignments): list, read, add, replace with
 * the revision read, and remove while nothing refers to the key. Zones are per tenant under RLS;
 * events are published only after the transaction commits, so none names an uncommitted change.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireTenant } from "@canccu/kit";
import type { Bus, RightsChecker, SqlClient, TenantContext } from "@canccu/kit";
import type { Db } from "./db.js";
import {
  actorOf,
  assertWritable,
  body,
  invalidRequest,
  needs,
  needsAny,
  notFound,
  tenantOf,
  versionConflict,
  zoneExists,
  zoneInUse,
} from "./http.js";
import { zoneInput } from "./zone-input.js";
import type { ZoneInput } from "./zone-input.js";

/** A bus event to publish once the transaction that caused it has committed. */
export type Emit = [type: string, data: Record<string, unknown>];

export async function publishAll(bus: Bus, emits: readonly Emit[]): Promise<void> {
  for (const [type, data] of emits) await bus.publish(type, data, { version: 1 });
}

const ZONE_FIELDS = ["name", "layout_id", "regions", "sound"] as const;
const ZONE_COLUMNS = "key, name, layout_id, regions, sound, revision";

type ZoneRow = Omit<ZoneInput, "revision"> & { revision: number };

/** The contract's `Zone`; the epoch stays inside the module (the composed state shows it). */
function zoneView(row: Record<string, unknown>): ZoneRow {
  return {
    key: row.key as string,
    name: row.name as string,
    layout_id: row.layout_id as string | null,
    regions: row.regions as ZoneRow["regions"],
    sound: row.sound as ZoneRow["sound"],
    revision: row.revision as number,
  };
}

function newEpoch(): string {
  return randomBytes(6).toString("base64url");
}

/** JSON with sorted keys: jsonb comes back in its own key order, so plain stringify would differ. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The `main` zone a new event starts with (plan #107, D8): made on `tenants.tenant.created`,
 * and on the first zone or assignment request of an event that never had one, so a missed bus
 * event never leaves an event without zones. The marker row makes it once: a deleted `main`
 * stays deleted.
 */
export async function ensureMainZone(c: SqlClient): Promise<Emit[]> {
  if ((await c.query("SELECT 1 FROM screen_zone_seeds")).rows.length > 0) return [];
  const marked = await c.query(
    "INSERT INTO screen_zone_seeds DEFAULT VALUES ON CONFLICT DO NOTHING RETURNING tenant_id",
  );
  if (marked.rows.length === 0) return [];
  const made = await c.query(
    `INSERT INTO screen_zones (key, name, regions, epoch) VALUES ('main', 'Main', $1, $2)
     ON CONFLICT DO NOTHING RETURNING revision`,
    [JSON.stringify({ hero: { idle: "next" } }), newEpoch()],
  );
  if (made.rows.length === 0) return [];
  return [
    [
      "screen.zone.saved",
      { zone_key: "main", revision: 1, changed: [...ZONE_FIELDS], actor_user_id: null },
    ],
  ];
}

/** The handler for `tenants.tenant.created`, run inside the new tenant. */
export function seedMainZone(db: Db, bus: Bus): () => Promise<void> {
  return async () => publishAll(bus, await db.tenant(ensureMainZone));
}

/** Seeding writes, so an archived event, read-only, is never seeded on a read. */
export async function seededFor(ctx: TenantContext, c: SqlClient): Promise<Emit[]> {
  return ctx.status === "archived" ? [] : ensureMainZone(c);
}

/** A zone of this event exists; `FOR KEY SHARE` holds it against a removal until commit. */
export async function zoneExistsHere(c: SqlClient, key: string): Promise<boolean> {
  const { rows } = await c.query("SELECT 1 FROM screen_zones WHERE key = $1 FOR KEY SHARE", [key]);
  return rows.length > 0;
}

/**
 * What may refer to a zone key, each answering why the zone is in use or null (plan #107, D9).
 * The contract names devices, schedule windows, active pushes and break playlists; #108 adds
 * its three here. The foreign keys on `assignments` are the database's backstop for the first.
 */
export type ZoneUse = (c: SqlClient, key: string) => Promise<string | null>;
export const ZONE_USES: ZoneUse[] = [
  async (c, key) => {
    const { rows } = await c.query(
      "SELECT count(*)::int AS n FROM assignments WHERE zone_key = $1 OR mirror_zone_key = $1",
      [key],
    );
    const n = (rows[0]?.n as number | undefined) ?? 0;
    return n === 0
      ? null
      : `${n} screen(s) show this zone or mirror it. Assign them elsewhere first.`;
  },
];

/** The sound device must be a device of this event assigned to this very zone. */
async function checkSoundDevice(c: SqlClient, key: string, deviceId: string | null): Promise<void> {
  if (deviceId === null) return;
  const { rows } = await c.query(
    `SELECT 1 FROM assignments a JOIN devices d ON d.id = a.device_id
     WHERE a.device_id = $1 AND a.zone_key = $2 AND d.current_tenant_id = $3 AND d.revoked_at IS NULL`,
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

export interface ZoneDeps {
  db: Db;
  bus: Bus;
  rights: RightsChecker;
}

type ByKey = { Params: { zone_key: string } };

export function zoneRoutes(app: FastifyInstance, deps: ZoneDeps): void {
  const { db, bus } = deps;
  const read = needsAny(deps.rights, ["screen.devices.read", "screen.content.read"]);
  const write = needs(deps.rights, "screen.zones.write");

  app.get("/api/screen/zones", { preHandler: read }, async (request) => {
    const ctx = tenantOf(request);
    const [emits, rows] = await db.tenant(async (c) => {
      const seeded = await seededFor(ctx, c);
      const all = await c.query(`SELECT ${ZONE_COLUMNS} FROM screen_zones ORDER BY key`);
      return [seeded, all.rows] as const;
    });
    await publishAll(bus, emits);
    return { zones: rows.map(zoneView) };
  });

  app.get<ByKey>("/api/screen/zones/:zone_key", { preHandler: read }, async (request) => {
    const ctx = tenantOf(request);
    const [emits, row] = await db.tenant(async (c) => {
      const seeded = await seededFor(ctx, c);
      const one = await c.query(`SELECT ${ZONE_COLUMNS} FROM screen_zones WHERE key = $1`, [
        request.params.zone_key,
      ]);
      return [seeded, one.rows[0]] as const;
    });
    await publishAll(bus, emits);
    if (row === undefined) throw notFound();
    return zoneView(row);
  });

  app.post("/api/screen/zones", { preHandler: write }, async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const zone = zoneInput(body(request));
    const actor = actorOf(request);
    const [emits, row] = await db.tenant(async (c) => {
      const seeded = await seededFor(ctx, c);
      await checkSoundDevice(c, zone.key, zone.sound.device_id);
      const { rows } = await c.query(
        `INSERT INTO screen_zones (key, name, layout_id, regions, sound, epoch)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING ${ZONE_COLUMNS}`,
        [
          zone.key,
          zone.name,
          zone.layout_id,
          JSON.stringify(zone.regions),
          JSON.stringify(zone.sound),
          newEpoch(),
        ],
      );
      if (rows[0] === undefined) throw zoneExists();
      const saved: Emit = [
        "screen.zone.saved",
        { zone_key: zone.key, revision: 1, changed: [...ZONE_FIELDS], actor_user_id: actor },
      ];
      return [[...seeded, saved], rows[0]] as const;
    });
    await publishAll(bus, emits);
    return reply.status(201).send(zoneView(row));
  });

  app.put<ByKey>("/api/screen/zones/:zone_key", { preHandler: write }, async (request) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const zone = zoneInput(body(request));
    if (zone.key !== request.params.zone_key) {
      throw invalidRequest(
        "`key` cannot change: it is how agenda items and Moments name the zone.",
      );
    }
    if (zone.revision === undefined) {
      throw invalidRequest("`revision` is required: send the revision you read.");
    }
    const actor = actorOf(request);
    const [emits, row] = await db.tenant(async (c) => {
      const seeded = await seededFor(ctx, c);
      const { rows } = await c.query(
        `SELECT ${ZONE_COLUMNS} FROM screen_zones WHERE key = $1 FOR UPDATE`,
        [zone.key],
      );
      const before = rows[0];
      if (before === undefined) throw notFound();
      if (before.revision !== zone.revision) throw versionConflict();
      await checkSoundDevice(c, zone.key, zone.sound.device_id);
      const after = await c.query(
        `UPDATE screen_zones SET name = $2, layout_id = $3, regions = $4, sound = $5,
           revision = revision + 1, updated_at = now()
         WHERE key = $1 RETURNING ${ZONE_COLUMNS}`,
        [
          zone.key,
          zone.name,
          zone.layout_id,
          JSON.stringify(zone.regions),
          JSON.stringify(zone.sound),
        ],
      );
      const saved = zoneView(after.rows[0] ?? {});
      const changed = ZONE_FIELDS.filter((f) => canonical(before[f]) !== canonical(saved[f]));
      const event: Emit = [
        "screen.zone.saved",
        { zone_key: zone.key, revision: saved.revision, changed, actor_user_id: actor },
      ];
      return [[...seeded, event], saved] as const;
    });
    await publishAll(bus, emits);
    return row;
  });

  app.delete<ByKey>(
    "/api/screen/zones/:zone_key",
    { preHandler: write },
    async (request, reply) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const key = request.params.zone_key;
      const actor = actorOf(request);
      const emits = await db.tenant(async (c) => {
        const seeded = await seededFor(ctx, c);
        // Locked first, so an assignment racing this removal waits and then finds no zone.
        const { rows } = await c.query("SELECT 1 FROM screen_zones WHERE key = $1 FOR UPDATE", [
          key,
        ]);
        if (rows.length === 0) throw notFound();
        for (const use of ZONE_USES) {
          const why = await use(c, key);
          if (why !== null) throw zoneInUse(why);
        }
        await c.query("DELETE FROM screen_zones WHERE key = $1", [key]);
        return [
          ...seeded,
          ["screen.zone.removed", { zone_key: key, actor_user_id: actor }] as Emit,
        ];
      });
      await publishAll(bus, emits);
      return reply.status(204).send();
    },
  );
}
