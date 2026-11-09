/**
 * Pairing a kiosk (contracts/screen.md, Pairing; 0028): the kiosk asks for a code from the venue
 * network, an event admin claims it, and the kiosk collects its token with the pairing cookie.
 * Open codes live only in Valkey; the token is made at collection, so it is never stored.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  VENUE_REFUSED_MESSAGE,
  VenueIpRefused,
  hashDeviceToken,
  ipInCidrs,
  newDeviceToken,
  requireTenant,
  tenantKey,
  venueIpCheckActive,
} from "@canccu/kit";
import type { Bus, RightsChecker, TenantContext } from "@canccu/kit";
import type { Audit } from "./audit.js";
import type { Db, DeviceRow } from "./db.js";
import { deviceView } from "./devices.js";
import {
  DEVICE_COOKIE,
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
}

export interface PairingDeps {
  db: Db;
  kv: Kv;
  bus: Bus;
  rights: RightsChecker;
  audit: Audit;
  now?: () => number;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
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

function secretMatches(secret: string, stored: string): boolean {
  const given = Buffer.from(sha256(secret));
  const want = Buffer.from(stored);
  return given.length === want.length && timingSafeEqual(given, want);
}

function fromVenue(ctx: TenantContext, ip: string | undefined, now: number): void {
  if (ctx.venue === null) throw noVenue();
  if (venueIpCheckActive(ctx, new Date(now)) && !ipInCidrs(ip, ctx.venue.addresses)) {
    throw new VenueIpRefused(VENUE_REFUSED_MESSAGE);
  }
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
    return found !== null && secretMatches(secret, found.secret_hash) ? [id, found] : null;
  }

  app.post("/api/screen/pairing", async (request, reply) => {
    const ctx = tenantOf(request);
    assertWritable(ctx);
    const at = now();
    fromVenue(ctx, request.ip, at);
    const address = request.ip;
    const mine = await held(cookie(request, PAIRING_COOKIE));
    if (mine !== null && mine[1].device_id === null && mine[1].expires_at > at) {
      // A kiosk reload keeps its code instead of using up another one.
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
      assertWritable(tenantOf(request));
      for (const id of await kv.live(keys.open(), now())) {
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
      const device = await db.tenant(async (c) => {
        const { rows } = await c.query(
          `UPDATE devices SET token_hash = $2 WHERE id = $1 AND token_hash IS NULL
           AND revoked_at IS NULL AND current_tenant_id = $3 RETURNING *`,
          [rec.device_id, hashDeviceToken(token), requireTenant()],
        );
        const row = rows[0] as unknown as DeviceRow | undefined;
        if (row === undefined) return null;
        const paired = await c.query("SELECT paired_at FROM assignments WHERE device_id = $1", [
          row.id,
        ]);
        return deviceView(row, paired.rows[0]?.paired_at as Date | undefined);
      });
      await kv.del(keys.record(id));
      if (device === null) throw notFound();
      setCookie(reply, DEVICE_COOKIE, token, DEVICE_COOKIE_MAX_AGE_S);
      setCookie(reply, PAIRING_COOKIE, "", 0);
      return { status: "paired", device };
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
      if (input.zone_key !== undefined && input.zone_key !== null) {
        // Zones arrive with #220; until then no zone exists to pair into.
        throw unknownZone();
      }
      if (ctx.venue === null) throw noVenue();
      const at = now();
      const id = await kv.take(keys.code(input.code.toUpperCase()));
      const rec = id === null ? null : await record(id);
      if (id === null || rec === null || rec.device_id !== null || rec.expires_at <= at)
        throw codeInvalid();
      const deviceId = newId("dv");
      const actor = request.session?.userId ?? null;
      const device = await db.tenant(async (c) => {
        const { rows } = await c.query(
          `INSERT INTO devices (id, name, venue_id, current_tenant_id) VALUES ($1, $2, $3, $4) RETURNING *`,
          [deviceId, name, ctx.venue?.id, ctx.tenant_id],
        );
        const paired = await c.query(
          "INSERT INTO assignments (device_id) VALUES ($1) RETURNING paired_at",
          [deviceId],
        );
        await deps.audit({
          tenant_id: ctx.tenant_id,
          actor_user_id: actor,
          action: "screen.device.paired",
          target: { type: "device", id: deviceId },
          changes: { name: { from: null, to: name } },
        });
        return deviceView(rows[0] as unknown as DeviceRow, paired.rows[0]?.paired_at as Date);
      });
      await kv.set(keys.record(id), JSON.stringify({ ...rec, device_id: deviceId }), RECORD_TTL_MS);
      await kv.removeMember(keys.open(), id);
      await kv.removeMember(keys.byAddress(rec.address), id);
      await deps.bus.publish(
        "screen.device.paired",
        { device_id: deviceId, name, zone_key: null, actor_user_id: actor },
        { version: 1 },
      );
      return reply.status(201).send(device);
    },
  );
}
