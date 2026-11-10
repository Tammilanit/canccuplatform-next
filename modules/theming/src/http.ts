/** The theming contract's error codes and the request helpers its routes share. */
import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { KitError, checkAdminAccess } from "@canccu/kit";
import type { RightsChecker, TenantContext } from "@canccu/kit";
import { requireRight } from "@canccu/kit/fastify";

const error = (status: number, code: string, message: string): KitError =>
  new KitError(message, { status, code });

export const notFound = (): KitError => error(404, "not_found", "Not found.");
export const noDraft = (): KitError => error(404, "no_draft", "This event has no draft.");
export const invalidRequest = (message: string): KitError => error(400, "invalid_request", message);
export const draftExists = (): KitError =>
  error(409, "draft_exists", "This event already has a draft. Edit it or discard it first.");
export const versionConflict = (what: string): KitError =>
  error(409, "version_conflict", `The ${what} was changed by someone else. Read it again.`);

export function tenantOf(request: FastifyRequest): TenantContext {
  // installTenancy sets it on every route of this module; null would be a wiring bug.
  if (request.tenant === null) throw notFound();
  return request.tenant;
}

/** Archived events are read-only (contracts/tenants.md, Lifecycle). */
export function assertWritable(request: FastifyRequest): void {
  if (tenantOf(request).status === "archived") {
    throw error(409, "event_archived", "This event is archived and read-only.");
  }
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

/** The signed-in person; the routes that call it run after `needs`, which sets the session. */
export function actorOf(request: FastifyRequest): string {
  const id = request.session?.userId;
  if (id === undefined) throw new Error("actorOf before the right check");
  return id;
}

/** A positive integer from a path or query string, or undefined when absent. */
export function positiveInt(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,8}$/.test(value)) {
    throw invalidRequest(`${name} must be a positive integer.`);
  }
  return Number(value);
}
