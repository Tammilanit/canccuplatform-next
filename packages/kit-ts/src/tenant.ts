/**
 * The tenant a piece of work runs for, and every name scoped by it: streams, Valkey keys and
 * files (0013 item 7, contracts/tenants.md). Modules build no raw keys or paths themselves.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { posix } from "node:path";

/** contracts/tenants.openapi.yaml, TenantId. No `_` or `:`, so `_platform` and key parts stay apart. */
export const TENANT_ID_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const MODULE_RE = /^[a-z][a-z0-9_]*$/;
const KEY_PART_RE = /^[^:\s]+$/;

export const FILES_ROOT = "/files";
/** Global files of a module live outside every tenant's tree; `_` is not allowed in tenant ids. */
export const PLATFORM_FILES_DIR = "_platform";

/** Work that needs a tenant ran without one: a bug in the module, never a user error. */
export class NoTenant extends Error {
  override name = "NoTenant";
  constructor() {
    super("no tenant is set for this work (use withTenant)");
  }
}

export function isTenantId(value: string): boolean {
  return TENANT_ID_RE.test(value);
}

function checkTenantId(tenant: string): string {
  if (!isTenantId(tenant)) throw new RangeError(`invalid tenant id ${JSON.stringify(tenant)}`);
  return tenant;
}

function checkModule(module: string): string {
  if (!MODULE_RE.test(module)) throw new RangeError(`invalid module ${JSON.stringify(module)}`);
  return module;
}

const storage = new AsyncLocalStorage<string>();

/** Run `fn` for `tenant`; everything it awaits sees the same tenant. */
export function withTenant<T>(tenant: string, fn: () => T): T {
  return storage.run(checkTenantId(tenant), fn);
}

export function currentTenant(): string | undefined {
  return storage.getStore();
}

export function requireTenant(): string {
  const tenant = storage.getStore();
  if (tenant === undefined) throw new NoTenant();
  return tenant;
}

/** `t:<tenant>:events:<module>`: the stream of a tenant event (contracts/events.md). */
export function tenantStream(module: string, tenant: string = requireTenant()): string {
  return `t:${checkTenantId(tenant)}:events:${checkModule(module)}`;
}

/** `events:<module>`: platform events, which concern no single tenant. */
export function platformStream(module: string): string {
  return `events:${checkModule(module)}`;
}

/** `t:<tenant>:<module>:<parts…>` for the current tenant: caches, locks, schedules. */
export function tenantKey(module: string, ...parts: string[]): string {
  checkModule(module);
  if (module === "events") throw new RangeError("t:<tenant>:events:… is reserved for streams");
  if (parts.length === 0) throw new RangeError("a key needs at least one part");
  for (const part of parts) {
    if (!KEY_PART_RE.test(part)) throw new RangeError(`invalid key part ${JSON.stringify(part)}`);
  }
  return `t:${requireTenant()}:${module}:${parts.join(":")}`;
}

/** `/files/<tenant>/<module>/` for the current tenant. */
export function tenantFilesDir(module: string, root: string = FILES_ROOT): string {
  return `${posix.join(root, requireTenant(), checkModule(module))}/`;
}

/** A file inside the current tenant's tree; a path that could leave it is refused. */
export function tenantFile(module: string, relative: string, root: string = FILES_ROOT): string {
  const bad =
    relative === "" ||
    relative.includes("\0") ||
    relative.includes("\\") ||
    posix.isAbsolute(relative) ||
    relative.split("/").includes("..");
  if (bad) throw new RangeError(`invalid file path ${JSON.stringify(relative)}`);
  return posix.join(tenantFilesDir(module, root), relative);
}

/** `/files/_platform/<module>/`: a module's global files, e.g. venue floor plans. */
export function platformFilesDir(module: string, root: string = FILES_ROOT): string {
  return `${posix.join(root, PLATFORM_FILES_DIR, checkModule(module))}/`;
}
