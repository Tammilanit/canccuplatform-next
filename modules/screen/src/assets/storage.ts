/**
 * The event's storage quota, held by tenants (contracts/tenants.md, Storage quota): bytes are
 * reserved before a file is written and released when it is deleted or never written.
 */
import { KitError, requireTenant } from "@canccu/kit";
import type { Logger, ServiceIdentity, SqlClient } from "@canccu/kit";

/** Advisory-lock class of the event's count; the file locks use 0x5c4e. */
const COUNT_LOCK_CLASS = 0x5c4f;

export interface StorageQuota {
  /** 413 `storage_quota_exceeded` or 409 `event_archived` from tenants, passed on unchanged. */
  reserve(bytes: number): Promise<void>;
  release(bytes: number): Promise<void>;
  /** Sets screen's count of the event to `bytes`, whatever the quota (the recount, upkeep.ts). */
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

export function tenantsStorage(
  tenantsUrl: string,
  service: ServiceIdentity,
  fetchFn: typeof fetch = fetch,
  timeoutMs = TENANTS_TIMEOUT_MS,
): StorageQuota {
  const base = `${tenantsUrl.replace(/\/+$/, "")}/internal/tenants/storage`;
  const change = async (
    path: "reserve" | "release" | "modules/screen",
    bytes: number,
  ): Promise<void> => {
    const url = `${base}/${path}?tenant_id=${encodeURIComponent(requireTenant())}`;
    const repair = path === "modules/screen";
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: repair ? "PUT" : "POST",
        headers: { "content-type": "application/json", ...service.headers("tenants") },
        body: JSON.stringify(repair ? { bytes } : { module: "screen", bytes }),
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
    repair: (bytes) => change("modules/screen", bytes),
  };
}

/**
 * Holds off a recount (upkeep.ts) until the caller's transaction ends. A writer takes it before
 * it reserves, so a recount waits for the commit that writes the rows holding those bytes instead
 * of reading the rows without them and then setting a count that has them: an upload under way
 * while screen counts is not lost from the count.
 */
export async function holdCount(c: SqlClient): Promise<void> {
  await c.query("SELECT pg_advisory_xact_lock_shared($1, hashtext($2))", [
    COUNT_LOCK_CLASS,
    requireTenant(),
  ]);
}

/**
 * Gives `bytes` back in the caller's transaction, before the commit that deletes (or rolls back)
 * the rows that held them, under the count lock: a recount sees the rows and the bytes together
 * or neither, never the rows gone while tenants still counts the bytes (contracts/tenants.md,
 * Repair).
 *
 * A failed or timed-out release is logged and the transaction goes on: a takedown, a privacy
 * delete or a render's end must not wait for tenants. Its cases, all mended by the next recount:
 * - tenants never got it: the count stays high, the safe direction;
 * - tenants applied it after the timeout: the count is right, and since the rows are gone no
 *   retry can release the same bytes twice;
 * - it reached tenants and the commit then failed: the count is low.
 */
export async function releaseHeld(
  c: SqlClient,
  storage: StorageQuota,
  bytes: number,
  log?: Logger,
): Promise<void> {
  if (bytes <= 0) return;
  await holdCount(c);
  await storage.release(bytes).catch((err: unknown) => {
    log?.warn({ err, bytes }, "giving bytes back to the storage quota failed");
  });
}

/** The recount's side of `holdCount`: no reserve runs until the caller's transaction ends. */
export async function lockCount(c: SqlClient): Promise<void> {
  await c.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
    COUNT_LOCK_CLASS,
    requireTenant(),
  ]);
}
