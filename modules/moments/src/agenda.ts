/**
 * What Moments reads of other modules for scenes: the event's whole agenda as a module
 * (`GET /internal/agenda/items`, contracts/agenda.md) and the event's time zone (the kit's
 * TenantResolver), each null or the default when the other module does not answer, so a scene
 * pass never fails for them.
 */
import type { ServiceIdentity, TenantResolver } from "@canccu/kit";
import type { AgendaItem } from "./scene-eval.js";
import type { AgendaReader } from "./scene-store.js";

const READ_TIMEOUT_MS = 1500;
const ZONE_CACHE_MS = 300_000;

export function httpAgenda(url: string, service: ServiceIdentity): AgendaReader {
  return async (tenantId) => {
    const res = await fetch(
      `${url.replace(/\/+$/, "")}/internal/agenda/items?tenant_id=${encodeURIComponent(tenantId)}`,
      { headers: service.headers("agenda"), signal: AbortSignal.timeout(READ_TIMEOUT_MS) },
    ).catch(() => null);
    if (res === null || !res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      agenda_version?: unknown;
      items?: unknown;
    } | null;
    if (typeof body?.agenda_version !== "number" || !Array.isArray(body.items)) return null;
    return {
      agenda_version: body.agenda_version,
      items: body.items.filter(
        (i): i is AgendaItem => typeof i === "object" && i !== null && !Array.isArray(i),
      ),
    };
  };
}

/** Each event's time zone, kept 5 minutes; UTC while the tenants module does not answer. */
export function timeZones(
  tenants: Pick<TenantResolver, "byId">,
): (tenant: string) => Promise<string> {
  const kept = new Map<string, { zone: string; at: number }>();
  return async (tenant) => {
    const hit = kept.get(tenant);
    if (hit !== undefined && Date.now() - hit.at < ZONE_CACHE_MS) return hit.zone;
    const ctx = await tenants.byId(tenant).catch(() => null);
    if (ctx === null) return hit?.zone ?? "UTC";
    kept.set(tenant, { zone: ctx.time_zone, at: Date.now() });
    return ctx.time_zone;
  };
}
