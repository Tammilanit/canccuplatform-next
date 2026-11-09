/** The screen contract's error codes, cookies and request helpers shared by the routes. */
import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { KitError, MissingRight, checkAdminAccess } from "@canccu/kit";
import type { RightsChecker, TenantContext } from "@canccu/kit";
import { requireRight } from "@canccu/kit/fastify";

export const PAIRING_COOKIE = "canccu_pairing";
export const DEVICE_COOKIE = "canccu_device";
/** 400 days, the longest Max-Age browsers keep (contracts/screen.md, Pairing). */
export const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 3600;

const error = (status: number, code: string) => (message?: string) =>
  new KitError(message, { status, code });
export const invalidRequest = error(400, "invalid_request");
export const notFound = (): KitError => error(404, "not_found")("Not found.");
export const deviceMoved = error(409, "device_moved");
export const eventArchived = (): KitError =>
  error(409, "event_archived")("This event is archived and read-only.");
export const noVenue = (): KitError =>
  error(409, "no_venue")("This event has no venue, so it cannot pair screens.");
export const rateLimited = error(429, "rate_limited");
export const unknownZone = (): KitError =>
  error(400, "unknown_zone")("This event has no such zone.");
export const versionConflict = (): KitError =>
  error(409, "version_conflict")("This zone was changed by someone else. Read it again.");
export const zoneExists = (): KitError =>
  error(409, "zone_exists")("This event already has a zone with this key.");
export const zoneInUse = error(409, "zone_in_use");
export const codeInvalid = (): KitError =>
  error(
    400,
    "code_invalid",
  )("This code is unknown, used or expired. Ask the screen for a new one.");

/** An id with a readable prefix (`dv_…`); random, so ids say nothing about order or count. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

export function cookie(request: FastifyRequest, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** Host-only (no Domain), so a cookie of one event's hostname never reaches another's. */
export function setCookie(reply: FastifyReply, name: string, value: string, maxAgeS: number): void {
  const attrs = `Path=/; Max-Age=${maxAgeS}; HttpOnly; Secure; SameSite=Strict`;
  void reply.header("set-cookie", [
    ...[reply.getHeader("set-cookie") ?? []].flat().map(String),
    `${name}=${value}; ${attrs}`,
  ]);
}

export function tenantOf(request: FastifyRequest): TenantContext {
  // installTenancy sets it on every route of this module; null would be a wiring bug.
  if (request.tenant === null) throw notFound();
  return request.tenant;
}

export function assertWritable(ctx: TenantContext): void {
  if (ctx.status === "archived") throw eventArchived();
}

/** A person's request: admin pages' address rule, then sign-in and the right (contracts/tenants.md, Access). */
export function needs(rights: RightsChecker, right: string): preHandlerAsyncHookHandler[] {
  return [
    async (request) => {
      checkAdminAccess(tenantOf(request), request.ip);
      await Promise.resolve();
    },
    requireRight(rights, right),
  ];
}

/** As `needs`, for a route that any one of `rights` opens. */
export function needsAny(rights: RightsChecker, any: string[]): preHandlerAsyncHookHandler[] {
  return [
    async (request) => {
      checkAdminAccess(tenantOf(request), request.ip);
      const session = await rights.session(request.headers.cookie);
      if (!any.some((r) => session.rights.has(r))) {
        throw new MissingRight(`needs one of the rights ${any.join(", ")}`);
      }
      request.session = session;
    },
  ];
}

export function actorOf(request: FastifyRequest): string | null {
  return request.session?.userId ?? null;
}

/** The body as an object, or 400: Fastify parses JSON but checks no shape. */
export function body(request: FastifyRequest): Record<string, unknown> {
  const value: unknown = request.body;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidRequest("The body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function deviceName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > 80) {
    throw invalidRequest("`name` must be 1 to 80 characters.");
  }
  return value.trim();
}
