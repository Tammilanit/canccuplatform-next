/**
 * The event's storage quota, held by tenants (contracts/tenants.md, Storage quota): a module
 * reserves bytes before it writes a file and releases them when it deletes the file or never
 * writes it. Every module that keeps files on the shared volume shares this client and its locks.
 */
import { KitError } from "./errors.js";
import type { Logger } from "./log.js";
import type { SqlClient } from "./db.js";
import type { ServiceIdentity } from "./service.js";
import { requireTenant } from "./tenant.js";

/**
 * Advisory-lock class of the per-module count of an event; modules use other classes for their
 * own locks (screen's file names use 0x5c4e).
 */
const COUNT_LOCK_CLASS = 0x5c4f;

export interface StorageQuota {
  /** 413 `storage_quota_exceeded` or 409 `event_archived` from tenants, passed on unchanged. */
  reserve(bytes: number): Promise<void>;
  release(bytes: number): Promise<void>;
  /** Sets the module's count of the event to `bytes`, whatever the quota (the recount). */
  repair(bytes: number): Promise<void>;
}

const unavailable = (detail: string): KitError =>
  new KitError(`the storage quota is unreachable: ${detail}`, {
    status: 503,
    code: "tenants_unavailable",
  });

/**
 * Reserves and releases run inside transactions that hold the count lock and row locks
 * (`holdCount`, `releaseHeld`): a tenants that never answers must not hold those, and every
 * recount and writer queued behind them, for ever.
 */
const TENANTS_TIMEOUT_MS = 10_000;

/**
 * The quota of the current tenant, counted for the module `service` names: tenants answers 403
 * for any other module (contracts/tenants.md, Reserve before writing).
 */
export function tenantsStorage(
  tenantsUrl: string,
  service: Pick<ServiceIdentity, "module" | "headers">,
  fetchFn: typeof fetch = fetch,
  timeoutMs = TENANTS_TIMEOUT_MS,
): StorageQuota {
  const base = `${tenantsUrl.replace(/\/+$/, "")}/internal/tenants/storage`;
  const module = service.module;
  const change = async (path: "reserve" | "release" | "repair", bytes: number): Promise<void> => {
    const repair = path === "repair";
    const url = `${base}/${repair ? `modules/${module}` : path}?tenant_id=${encodeURIComponent(requireTenant())}`;
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: repair ? "PUT" : "POST",
        headers: { "content-type": "application/json", ...service.headers("tenants") },
        body: JSON.stringify(repair ? { bytes } : { module, bytes }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw unavailable(String(err));
    }
    if (response.ok) return;
    if (path === "reserve" && (response.status === 413 || response.status === 409)) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      const code = body?.error?.code;
      if (code === "storage_quota_exceeded" || code === "event_archived") {
        throw new KitError(body?.error?.message ?? code, { status: response.status, code });
      }
    }
    throw unavailable(`${path} answered ${response.status}`);
  };
  return {
    reserve: (bytes) => change("reserve", bytes),
    release: (bytes) => change("release", bytes),
    repair: (bytes) => change("repair", bytes),
  };
}

const countKey = (module: string): string => `${module}/${requireTenant()}`;

/**
 * Holds off `module`'s recount until the caller's transaction ends. A writer takes it before it
 * reserves, so a recount waits for the commit that writes the rows holding those bytes instead
 * of reading the rows without them and then setting a count that has them: an upload under way
 * while the module counts is not lost from the count.
 */
export async function holdCount(c: SqlClient, module: string): Promise<void> {
  await c.query("SELECT pg_advisory_xact_lock_shared($1, hashtext($2))", [
    COUNT_LOCK_CLASS,
    countKey(module),
  ]);
}

/** The recount's side of `holdCount`: no reserve runs until the caller's transaction ends. */
export async function lockCount(c: SqlClient, module: string): Promise<void> {
  await c.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
    COUNT_LOCK_CLASS,
    countKey(module),
  ]);
}

/**
 * Gives `bytes` back from inside the transaction that deletes (or rolls back) the rows that held
 * them, before it ends; the caller already holds the count lock (`holdCount`). A recount then sees
 * the rows and the bytes together or neither, never the rows gone while tenants still counts the
 * bytes (contracts/tenants.md, Repair).
 *
 * A failed or timed-out release is logged and the transaction goes on, so a delete still commits
 * while tenants is down. It does wait for tenants, up to the timeout and holding the caller's
 * locks: a hung tenants slows those writes, it no longer fails them. What is left, each mended by
 * the next recount:
 * - tenants never got it: the count stays high, the safe direction;
 * - tenants applies it after the timeout, so after the commit and perhaps after a recount that
 *   already left the bytes out: the count is low;
 * - it reached tenants and the commit then failed: the count is low.
 */
export async function releaseHeld(
  storage: StorageQuota,
  bytes: number,
  log?: Logger,
): Promise<void> {
  if (bytes <= 0) return;
  await storage.release(bytes).catch((err: unknown) => {
    log?.warn({ err, bytes }, "giving bytes back to the storage quota failed");
  });
}
