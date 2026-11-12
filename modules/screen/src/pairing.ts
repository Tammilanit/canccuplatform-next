/**
 * Pairing a kiosk (contracts/screen.md, Pairing; 0028): the kiosk asks for a code from the venue
 * network, an event admin claims it, and the kiosk collects its token with the pairing cookie.
 * Open codes live only in Valkey; the token is made at collection, so it is never stored.
 */
import { randomBytes, randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  checkScreenAccess,
  deviceTokenMatches,
  hashDeviceToken,
  newDeviceToken,
  requireTenant,
  tenantKey,
} from "@canccu/kit";
import type { Bus, Logger, RightsChecker, TenantContext } from "@canccu/kit";
import type { Audit } from "./audit.js";
import type { Db, DeviceRow } from "./db.js";
import { deviceView } from "./devices.js";
import type { Placement } from "./devices.js";
import {
  DEVICE_COOKIE,
  actorOf,
  DEVICE_COOKIE_MAX_AGE_S,
  PAIRING_COOKIE,
  assertWritable,
  body,
  codeInvalid,
  cookie,
  deviceName,
  invalidRequest,
  needs,
  newId,
  noVenue,
  notFound,
  rateLimited,
  setCookie,
  tenantOf,
  unknownZone,
} from "./http.js";
import type { Kv } from "./kv.js";
import { zoneKey as zoneKeyOf } from "./zone-input.js";
import { publishAll, seededFor, zoneExistsHere } from "./zones.js";
import type { Emit } from "./zones.js";

export const CODE_TTL_MS = 10 * 60_000;
/** The record outlives its code a little, so a late poll learns `expired` instead of 404. */
const RECORD_TTL_MS = CODE_TTL_MS + 5 * 60_000;
export const MAX_OPEN_PER_EVENT = 10;
export const MAX_OPEN_PER_ADDRESS = 3;
/** No look-alikes (0/O, 1/I): the code is read off a TV across a room. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

interface PairingRecord {
  code: string;
  secret_hash: string;
  address: string;
  expires_at: number;
  device_id: string | null;
  /** The hash of the token last handed out, so a kiosk whose answer was lost can collect again. */
  issued_hash?: string;
}

export interface PairingDeps {
  db: Db;
  kv: Kv;
  bus: Bus;
  rights: RightsChecker;
  audit: Audit;
  log?: Logger;
  now?: () => number;
}

/** How long a collected pairing stays collectable again by the same browser. */
const RECOLLECT_MS = 60_000;

// The kit's SHA-256 helper: the pairing secret is a bearer secret like a device token.
const sha256 = hashDeviceToken;
const keys = {
  record: (id: string) => tenantKey("screen", "pairing", id),
  code: (code: string) => tenantKey("screen", "pairing-code", code),
  open: () => tenantKey("screen", "pairings-open"),
  // The address is part of a key: hash it, so no raw client input ever names a key.
  byAddress: (address: string) =>
    tenantKey("screen", "pairings-open", sha256(address).slice(0, 32)),
};

function newCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

function fromVenue(ctx: TenantContext, ip: string | undefined, now: number): void {
  if (ctx.venue === null) throw noVenue();
  // The kit's venue rule (and its emergency switch); a pairing has no token yet to check.
  checkScreenAccess(ctx, { deviceTokenValid: true, clientIp: ip, now: new Date(now) });
}

export function pairingRoutes(app: FastifyInstance, deps: PairingDeps): void {
  const { kv, db } = deps;
  const now = deps.now ?? Date.now;

  async function record(id: string): Promise<PairingRecord | null> {
    const raw = await kv.get(keys.record(id));
    return raw === null ? null : (JSON.parse(raw) as PairingRecord);
  }

  /** The pairing this browser holds by its cookie, or null. */
  async function held(cookieValue: string | undefined): Promise<[string, PairingRecord] | null> {
    const [id, secret] = (cookieValue ?? "").split(".");
    if (id === undefined || secret === undefined || !/^pr_[A-Za-z0-9_-]+$/.test(id)) return null;
    const found = await record(id);
    return found !== null && deviceTokenMatches(secret, found.secret_hash) ? [id, found] : null;
  }

  app.post("/api/screen/pairing", async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const at = now();
    fromVenue(ctx, request.ip, at);
    const address = request.ip;
    const mine = await held(cookie(request, PAIRING_COOKIE));
    if (mine !== null && (mine[1].device_id !== null || mine[1].expires_at > at)) {
      // A kiosk reload keeps its pairing instead of using up another code: also once claimed,
      // so a reload between the claim and the next poll still collects the device.
      const [id, rec] = mine;
      return reply.status(201).send({
        pairing_id: id,
        code: rec.code,
        expires_at: new Date(rec.expires_at).toISOString(),
        poll_seconds: 2,
      });
    }
    if ((await kv.live(keys.open(), at)).length >= MAX_OPEN_PER_EVENT) {
      throw rateLimited(
        "This event has too many open pairing codes. Use one, or clear them in Studio.",
      );
    }
    if ((await kv.live(keys.byAddress(address), at)).length >= MAX_OPEN_PER_ADDRESS) {
      throw rateLimited("This address has too many open pairing codes. Wait for one to expire.");
    }
    const id = newId("pr");
    const secret = randomBytes(24).toString("base64url");
    const expiresAt = at + CODE_TTL_MS;
    let code = newCode();
    // 32^8 codes per event: a clash is rare, but a code must name one pairing only.
    for (let tries = 0; !(await kv.setIfAbsent(keys.code(code), id, CODE_TTL_MS)); tries++) {
      if (tries > 5) throw new Error("no free pairing code");
      code = newCode();
    }
    const rec: PairingRecord = {
      code,
      secret_hash: sha256(secret),
      address,
      expires_at: expiresAt,
      device_id: null,
    };
    await kv.set(keys.record(id), JSON.stringify(rec), RECORD_TTL_MS);
    await kv.addExpiring(keys.open(), id, expiresAt);
    await kv.addExpiring(keys.byAddress(address), id, expiresAt);
    setCookie(reply, PAIRING_COOKIE, `${id}.${secret}`, CODE_TTL_MS / 1000);
    return reply.status(201).send({
      pairing_id: id,
      code,
      expires_at: new Date(expiresAt).toISOString(),
      poll_seconds: 2,
    });
  });

  app.delete(
    "/api/screen/pairing",
    { preHandler: needs(deps.rights, "screen.devices.pair") },
    async (request, reply) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const open = await kv.live(keys.open(), now());
      // Recorded first: if the audit log is down, the codes stay and the person can try again.
      await deps.audit({
        tenant_id: ctx.tenant_id,
        actor_user_id: actorOf(request),
        action: "screen.pairing.cleared",
        target: { type: "pairing_codes", id: ctx.tenant_id },
        changes: { open_codes: { from: open.length, to: 0 } },
      });
      for (const id of open) {
        const rec = await record(id);
        if (rec !== null)
          await kv.del(keys.code(rec.code), keys.record(id), keys.byAddress(rec.address));
      }
      await kv.del(keys.open());
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { pairing_id: string } }>(
    "/api/screen/pairing/:pairing_id",
    async (request, reply) => {
      const mine = await held(cookie(request, PAIRING_COOKIE));
      // Only the browser that asked may poll: another one learns nothing, not even that it exists.
      if (mine === null || mine[0] !== request.params.pairing_id) throw notFound();
      const [id, rec] = mine;
      if (rec.device_id === null) {
        return { status: rec.expires_at > now() ? "waiting" : "expired" };
      }
      const token = newDeviceToken();
      const collected = await db.tenant(
        async (c): Promise<{ device: Record<string, unknown> } | { gone: boolean }> => {
          // The first collection, or a repeat by the same browser of the token it was just given
          // (its answer was lost): never a token that has since changed hands.
          const { rows } = await c.query(
            `UPDATE devices SET token_hash = $2 WHERE id = $1
             AND token_hash IS NOT DISTINCT FROM $4
             AND revoked_at IS NULL AND current_tenant_id = $3 RETURNING *`,
            [rec.device_id, hashDeviceToken(token), requireTenant(), rec.issued_hash ?? null],
          );
          const row = rows[0] as unknown as DeviceRow | undefined;
          if (row === undefined) {
            // Lost to a collection that changed the token since this poll read the record: most
            // often an overlapping poll of this browser, whose record with `issued_hash` must stay
            // for its retry. A device gone from this event ends the pairing, and so does a lost
            // write of `issued_hash` (below).
            const live = await c.query(
              "SELECT 1 FROM devices WHERE id = $1 AND revoked_at IS NULL AND current_tenant_id = $2",
              [rec.device_id, requireTenant()],
            );
            return { gone: live.rows.length === 0 };
          }
          const placed = await c.query(
            "SELECT paired_at, zone_key, mirror_device_id, mirror_zone_key FROM screen_assignments WHERE device_id = $1",
            [row.id],
          );
          return { device: deviceView({ ...row, ...(placed.rows[0] as Placement | undefined) }) };
        },
      );
      if ("gone" in collected) {
        if (collected.gone) {
          await kv.del(keys.record(id));
          throw notFound();
        }
        // A live device whose stored record still has no `issued_hash` was collected by a poll
        // whose write below was lost: no token can be collected again, so forget the pairing and
        // let the next POST start a new one. Read afresh, and delete only that very value: an
        // overlapping winner may write `issued_hash` at any point, and its record must stay.
        const raw = await kv.get(keys.record(id));
        if (
          raw !== null &&
          (JSON.parse(raw) as PairingRecord).issued_hash === undefined &&
          (await kv.delIfEquals(keys.record(id), raw))
        ) {
          deps.log?.warn(
            { device_id: rec.device_id },
            "pairing forgotten after a lost issued_hash write: revoke the device, its token is held by no one",
          );
        }
        throw notFound();
      }
      await kv.set(
        keys.record(id),
        JSON.stringify({ ...rec, issued_hash: hashDeviceToken(token) }),
        RECOLLECT_MS,
      );
      setCookie(reply, DEVICE_COOKIE, token, DEVICE_COOKIE_MAX_AGE_S);
      setCookie(reply, PAIRING_COOKIE, "", 0);
      return { status: "paired", device: collected.device };
    },
  );

  app.post(
    "/api/screen/devices",
    { preHandler: needs(deps.rights, "screen.devices.pair") },
    async (request, reply) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const input = body(request);
      const name = deviceName(input.name);
      if (typeof input.code !== "string" || !CODE_RE.test(input.code.toUpperCase())) {
        throw invalidRequest("`code` must be the 8 characters the screen shows.");
      }
      const zone = input.zone_key ?? null;
      const zoneKey = zone === null ? null : zoneKeyOf(zone, "zone_key");
      if (ctx.venue === null) throw noVenue();
      const at = now();
      const id = await kv.take(keys.code(input.code.toUpperCase()));
      // The code is spent from here; a failed claim below puts it back.
      const rec = id === null ? null : await record(id);
      if (id === null || rec === null || rec.device_id !== null || rec.expires_at <= at)
        throw codeInvalid();
      const deviceId = newId("dv");
      const actor = actorOf(request);
      const code = input.code.toUpperCase();
      let device: Record<string, unknown>;
      let seeded: Emit[];
      try {
        [seeded, device] = await db.tenant(async (c) => {
          const made = await seededFor(ctx, c);
          if (zoneKey !== null && !(await zoneExistsHere(c, zoneKey))) throw unknownZone();
          const { rows } = await c.query(
            `INSERT INTO devices (id, name, venue_id, current_tenant_id) VALUES ($1, $2, $3, $4) RETURNING *`,
            [deviceId, name, ctx.venue?.id, ctx.tenant_id],
          );
          const paired = await c.query(
            "INSERT INTO screen_assignments (device_id, zone_key) VALUES ($1, $2) RETURNING paired_at, zone_key",
            [deviceId, zoneKey],
          );
          await deps.audit({
            tenant_id: ctx.tenant_id,
            actor_user_id: actor,
            action: "screen.device.paired",
            target: { type: "device", id: deviceId },
            changes: { name: { from: null, to: name } },
          });
          const view = deviceView({ ...(rows[0] as unknown as DeviceRow), ...paired.rows[0] });
          return [made, view] as const;
        });
      } catch (err) {
        // Nothing was paired: give the code back, so the admin's retry works and the kiosk
        // is not left showing a dead code.
        await kv.setIfAbsent(keys.code(code), id, rec.expires_at - at).catch(() => undefined);
        throw err;
      }
      // The device is committed: the claimed record is what the kiosk's next poll needs, so it
      // goes first; what follows must not turn a done pairing into an error.
      await kv.set(keys.record(id), JSON.stringify({ ...rec, device_id: deviceId }), RECORD_TTL_MS);
      try {
        await kv.removeMember(keys.open(), id);
        await kv.removeMember(keys.byAddress(rec.address), id);
        await publishAll(deps.bus, [
          ...seeded,
          [
            "screen.device.paired",
            { device_id: deviceId, name, zone_key: zoneKey, actor_user_id: actor },
          ],
        ]);
      } catch (err) {
        deps.log?.error({ err, device_id: deviceId }, "after pairing: counters or event failed");
      }
      return reply.status(201).send(device);
    },
  );
}
