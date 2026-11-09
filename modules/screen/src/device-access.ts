/**
 * The check every device request passes (contracts/screen.md, Every device request), in the
 * contract's order: the token, then the device's current event, then the venue address. The
 * address alone is never enough, and a token alone only while the emergency switch is off.
 */
import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { DeviceUnknown, checkScreenAccess, hashDeviceToken } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import type { Db, DeviceRow } from "./db.js";
import { DEVICE_COOKIE, cookie, deviceMoved, tenantOf } from "./http.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by requireDevice. */
    device: DeviceRow | null;
  }
}

export const DEVICE_UNKNOWN_MESSAGE =
  "This screen is not paired, or its pairing was revoked. Pair it again from the event's screen page.";
const MOVED_MESSAGE = "This screen now serves another event, or none.";

export type TokenMatch =
  { kind: "current"; device: DeviceRow } | { kind: "superseded"; device: DeviceRow };

/** The device a token belongs to, as its current or a still valid superseded token. */
export async function findByToken(
  client: SqlClient,
  token: string,
  now: Date,
): Promise<TokenMatch | null> {
  const hash = hashDeviceToken(token);
  const current = await client.query(
    "SELECT * FROM devices WHERE token_hash = $1 AND revoked_at IS NULL",
    [hash],
  );
  if (current.rows[0] !== undefined)
    return { kind: "current", device: current.rows[0] as unknown as DeviceRow };
  const old = await client.query(
    `SELECT * FROM devices WHERE revoked_at IS NULL AND superseded_token_hashes @> $1::jsonb`,
    [JSON.stringify([{ hash }])],
  );
  const device = old.rows[0] as unknown as DeviceRow | undefined;
  if (device === undefined) return null;
  // An expired superseded token is dropped and answers like an unknown one.
  const entry = device.superseded_token_hashes.find((s) => s.hash === hash);
  if (entry === undefined || Date.parse(entry.expires_at) <= now.getTime()) {
    await client.query(
      `UPDATE devices SET superseded_token_hashes = (
         SELECT coalesce(jsonb_agg(s), '[]'::jsonb) FROM jsonb_array_elements(superseded_token_hashes) s
         WHERE (s->>'expires_at')::timestamptz > $2) WHERE id = $1`,
      [device.id, now.toISOString()],
    );
    return null;
  }
  return { kind: "superseded", device };
}

export interface DeviceCheckOptions {
  /** Only `GET /api/screen/device/home` serves superseded tokens and other events' devices. */
  allowElsewhere?: boolean;
  now?: () => Date;
}

/** preHandler: sets request.device or answers 401 `device_unknown`, 409 `device_moved` or 403 `venue_ip_refused`. */
export function requireDevice(
  db: Db,
  options: DeviceCheckOptions = {},
): preHandlerAsyncHookHandler {
  const now = options.now ?? (() => new Date());
  return async (request: FastifyRequest) => {
    const ctx = tenantOf(request);
    const token = cookie(request, DEVICE_COOKIE);
    const at = now();
    const match = token === undefined ? null : await db.tenant((c) => findByToken(c, token, at));
    if (match === null) throw new DeviceUnknown(DEVICE_UNKNOWN_MESSAGE);
    const elsewhere =
      match.kind === "superseded" || match.device.current_tenant_id !== ctx.tenant_id;
    if (elsewhere && options.allowElsewhere !== true) throw deviceMoved(MOVED_MESSAGE);
    checkScreenAccess(ctx, { deviceTokenValid: true, clientIp: request.ip, now: at });
    if (match.kind === "current" && match.device.superseded_token_hashes.length > 0 && !elsewhere) {
      // The new token has worked once here: the old ones have done their job (contracts/screen.md, Moving).
      await db.tenant((c) =>
        // Only while the matched token is still current, so a transfer in between keeps its entry.
        c.query(
          "UPDATE devices SET superseded_token_hashes = '[]'::jsonb WHERE id = $1 AND token_hash = $2",
          [match.device.id, match.device.token_hash],
        ),
      );
    }
    request.device = match.device;
  };
}
