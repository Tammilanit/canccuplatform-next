/**
 * The check every device request passes (contracts/screen.md, Every device request), in the
 * contract's order: the token, then the device's current event, then the venue address. The
 * address alone is never enough, and a token alone only while the emergency switch is off.
 */
import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { DeviceUnknown, checkScreenAccess, hashDeviceToken } from "@canccu/kit";
import type { SqlClient, TenantContext } from "@canccu/kit";
import type { Db, DeviceRow } from "./db.js";
import { DEVICE_COOKIE, cookie, deviceMoved, tenantOf } from "./http.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by requireDevice. */
    device: DeviceRow | null;
    /** Which of the device's tokens the cookie held; set by requireDevice. */
    deviceToken: TokenMatch["kind"] | null;
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
  const { rows } = await client.query(
    `SELECT * FROM devices WHERE revoked_at IS NULL
       AND (token_hash = $1 OR superseded_token_hashes @> $2::jsonb)`,
    [hash, JSON.stringify([{ hash }])],
  );
  const device = rows[0] as unknown as DeviceRow | undefined;
  if (device === undefined) return null;
  if (device.token_hash === hash) return { kind: "current", device };
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

/**
 * The whole check for one device request: the match, or 401 `device_unknown`, 409
 * `device_moved` or 403 `venue_ip_refused`. The push channel runs it again at every `ping`, so a
 * revoked, moved or refused screen loses an open stream too.
 */
export async function checkDevice(
  db: Db,
  ctx: TenantContext,
  token: string | undefined,
  clientIp: string | undefined,
  at: Date,
  options: Pick<DeviceCheckOptions, "allowElsewhere"> = {},
): Promise<TokenMatch> {
  if (token === undefined) throw new DeviceUnknown(DEVICE_UNKNOWN_MESSAGE);
  const match = await db.tenant(async (c) => {
    const found = await findByToken(c, token, at);
    if (found === null) return null;
    const elsewhere =
      found.kind === "superseded" || found.device.current_tenant_id !== ctx.tenant_id;
    if (elsewhere && options.allowElsewhere !== true) throw deviceMoved(MOVED_MESSAGE);
    // Before any write: a refused address must change nothing.
    checkScreenAccess(ctx, { deviceTokenValid: true, clientIp, now: at });
    if (found.kind === "current" && found.device.superseded_token_hashes.length > 0 && !elsewhere) {
      // The new token has worked once here: the old ones have done their job (contracts/screen.md,
      // Moving). Only while the matched token is still current, so a transfer in between keeps
      // its entry.
      await c.query(
        "UPDATE devices SET superseded_token_hashes = '[]'::jsonb WHERE id = $1 AND token_hash = $2",
        [found.device.id, found.device.token_hash],
      );
    }
    return found;
  });
  if (match === null) throw new DeviceUnknown(DEVICE_UNKNOWN_MESSAGE);
  return match;
}

/** preHandler: sets request.device or answers 401 `device_unknown`, 409 `device_moved` or 403 `venue_ip_refused`. */
export function requireDevice(
  db: Db,
  options: DeviceCheckOptions = {},
): preHandlerAsyncHookHandler {
  const now = options.now ?? (() => new Date());
  return async (request: FastifyRequest) => {
    const match = await checkDevice(
      db,
      tenantOf(request),
      cookie(request, DEVICE_COOKIE),
      request.ip,
      now(),
      options,
    );
    request.device = match.device;
    request.deviceToken = match.kind;
  };
}
