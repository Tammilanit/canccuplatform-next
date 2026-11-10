/**
 * How a moved kiosk finds its new event (contracts/screen.md, Moving, renaming, revoking). Cookies
 * are host-only, so the new hostname holds no cookie yet: the old hostname answers `device/home`
 * with the new screen URL and a one-time transfer code, and the new hostname swaps the code for a
 * new token. Only the current token gets a code; the replaced one becomes superseded, and a
 * superseded token only ever learns the new URL, so a copied old cookie can never take the device.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  KitError,
  checkScreenAccess,
  hashDeviceToken,
  newDeviceToken,
  tenantKey,
  withTenant,
} from "@canccu/kit";
import type { TenantResolver } from "@canccu/kit";
import type { Audit } from "./audit.js";
import type { Db, DeviceRow } from "./db.js";
import { requireDevice } from "./device-access.js";
import { deviceView } from "./devices.js";
import type { Placement } from "./devices.js";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE_S,
  body,
  codeInvalid,
  invalidRequest,
  setCookie,
  tenantOf,
} from "./http.js";
import type { Kv } from "./kv.js";

export const TRANSFER_TTL_MS = 60_000;
/** How long a replaced token still finds the new hostname (unless the new token works first). */
export const SUPERSEDED_TTL_MS = 7 * 24 * 3600_000;

interface TransferRecord {
  device_id: string;
  /** The token the code was made for: a code outlives no token change. */
  token_hash: string;
  expires_at: number;
}

// The code is part of the key: hash it, so no raw client input ever names a key, and Valkey
// never holds a redeemable code.
const transferKey = (code: string) =>
  tenantKey("screen", "transfer", hashDeviceToken(code).slice(0, 32));

export interface MovingDeps {
  db: Db;
  kv: Kv;
  audit: Audit;
  tenants: TenantResolver;
  now?: () => number;
}

export function movingRoutes(app: FastifyInstance, deps: MovingDeps): void {
  const { db, kv } = deps;
  const now = deps.now ?? Date.now;

  app.get(
    "/api/screen/device/home",
    { preHandler: requireDevice(db, { allowElsewhere: true, now: () => new Date(now()) }) },
    async (request) => {
      // requireDevice answers 401 before this handler without a device.
      const device = request.device as DeviceRow;
      const ctx = tenantOf(request);
      const tenant = device.current_tenant_id;
      if (tenant === null) return { url: null };
      const target = tenant === ctx.tenant_id ? ctx : await deps.tenants.byId(tenant);
      // An event without a hostname yet (or deleted) has no screen page to send the kiosk to.
      if (target?.primary_hostname == null) return { url: null };
      const url = `https://${target.primary_hostname}/screen/`;
      if (request.deviceToken !== "current" || device.token_hash === null) return { url };
      const code = randomBytes(32).toString("base64url");
      const record: TransferRecord = {
        device_id: device.id,
        token_hash: device.token_hash,
        expires_at: now() + TRANSFER_TTL_MS,
      };
      // In the new event's keys: only its hostname can redeem the code.
      await withTenant(target.tenant_id, () =>
        kv.set(transferKey(code), JSON.stringify(record), TRANSFER_TTL_MS),
      );
      return { url: `${url}#transfer=${code}` };
    },
  );

  app.post("/api/screen/device/transfer", async (request, reply) => {
    const ctx = tenantOf(request);
    const at = now();
    // From the venue, as every device request; the code stands in for the token here. An
    // archived event still takes its devices, so they can show the archived notice.
    checkScreenAccess(ctx, { deviceTokenValid: true, clientIp: request.ip, now: new Date(at) });
    const code = body(request).code;
    if (typeof code !== "string" || code.length < 16 || code.length > 64) {
      throw invalidRequest("`code` must be the transfer code of the screen URL.");
    }
    const raw = await kv.take(transferKey(code));
    if (raw === null) throw codeInvalid();
    const record = JSON.parse(raw) as TransferRecord;
    const token = newDeviceToken();
    const device = await redeem(record, token, at, ctx.tenant_id).catch(async (err: unknown) => {
      // Not the code's fault (the audit log or the database is down): give it back, so the
      // kiosk's retry works instead of sending it back to a hostname that no longer serves it.
      if (!(err instanceof KitError && err.status < 500) && record.expires_at > at) {
        await kv.setIfAbsent(transferKey(code), raw, record.expires_at - at).catch(() => undefined);
      }
      throw err;
    });
    setCookie(reply, DEVICE_COOKIE, token, DEVICE_COOKIE_MAX_AGE_S);
    return device;
  });

  function redeem(
    record: TransferRecord,
    token: string,
    at: number,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    return db.tenant(async (c) => {
      const { rows } = await c.query(
        "SELECT * FROM devices WHERE id = $1 AND revoked_at IS NULL AND current_tenant_id = $2 FOR UPDATE",
        [record.device_id, tenantId],
      );
      const row = rows[0] as unknown as DeviceRow | undefined;
      // Moved on, revoked or deleted since the code was made: the code is no longer valid.
      if (row === undefined) throw codeInvalid();
      if (row.token_hash !== record.token_hash) throw codeInvalid();
      const kept = row.superseded_token_hashes.filter((s) => Date.parse(s.expires_at) > at);
      const superseded = [
        ...kept,
        { hash: record.token_hash, expires_at: new Date(at + SUPERSEDED_TTL_MS).toISOString() },
      ];
      await c.query(
        "UPDATE devices SET token_hash = $2, superseded_token_hashes = $3::jsonb WHERE id = $1",
        [row.id, hashDeviceToken(token), JSON.stringify(superseded)],
      );
      // The kiosk's own act, so no person is the actor.
      await deps.audit({
        tenant_id: tenantId,
        actor_user_id: null,
        action: "screen.device.transferred",
        target: { type: "device", id: row.id },
      });
      const placed = await c.query(
        "SELECT paired_at, zone_key, mirror_device_id, mirror_zone_key FROM screen_assignments WHERE device_id = $1",
        [row.id],
      );
      return deviceView({ ...row, ...(placed.rows[0] as Placement | undefined) });
    });
  }
}
