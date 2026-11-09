/** Audit entries go to the tenants module in the request that made the change (contracts/screen.md, Audit). */
import { KitError } from "@canccu/kit";
import type { ServiceIdentity } from "@canccu/kit";

export interface AuditEntry {
  tenant_id: string | null;
  actor_user_id: string | null;
  action: string;
  target: { type: string; id: string };
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export type Audit = (entry: AuditEntry) => Promise<void>;

/**
 * Callers append before they commit: a change that cannot be audited is rolled back, so nothing
 * the contract lists as audited ever happens unrecorded.
 */
export function tenantsAudit(
  tenantsUrl: string,
  service: ServiceIdentity,
  fetchFn: typeof fetch = fetch,
): Audit {
  const url = `${tenantsUrl.replace(/\/+$/, "")}/internal/tenants/audit`;
  return async (entry) => {
    const { actor_user_id, ...rest } = entry;
    const body = { module: "screen", ...rest, ...(actor_user_id ? { actor_user_id } : {}) };
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...service.headers("tenants") },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new KitError(`audit log unreachable: ${String(err)}`, {
        status: 503,
        code: "tenants_unavailable",
      });
    }
    if (!response.ok) {
      throw new KitError(`audit log answered ${response.status}`, {
        status: 503,
        code: "tenants_unavailable",
      });
    }
  };
}
