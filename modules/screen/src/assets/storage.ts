/**
 * The event's storage quota, held by tenants (contracts/tenants.md, Storage quota): bytes are
 * reserved before a file is written and released when it is deleted or never written.
 */
import { KitError, requireTenant } from "@canccu/kit";
import type { ServiceIdentity } from "@canccu/kit";

export interface StorageQuota {
  /** 413 `storage_quota_exceeded` or 409 `event_archived` from tenants, passed on unchanged. */
  reserve(bytes: number): Promise<void>;
  release(bytes: number): Promise<void>;
}

const unavailable = (detail: string): KitError =>
  new KitError(`the storage quota is unreachable: ${detail}`, {
    status: 503,
    code: "tenants_unavailable",
  });

export function tenantsStorage(
  tenantsUrl: string,
  service: ServiceIdentity,
  fetchFn: typeof fetch = fetch,
): StorageQuota {
  const base = `${tenantsUrl.replace(/\/+$/, "")}/internal/tenants/storage`;
  const change = async (path: "reserve" | "release", bytes: number): Promise<void> => {
    const url = `${base}/${path}?tenant_id=${encodeURIComponent(requireTenant())}`;
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...service.headers("tenants") },
        body: JSON.stringify({ module: "screen", bytes }),
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
  };
}
