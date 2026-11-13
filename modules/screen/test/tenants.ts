/** The fake tenants module: the events the tests run on, by hostname and by id. */
import type { TenantContext } from "@canccu/kit";

export function context(id: string, overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenant_id: id,
    status: "live",
    primary_hostname: `${id}.test`,
    time_zone: "UTC",
    info_page_mode: "public",
    membership: "open",
    admin_access: "internet",
    venue: { id: "v_1", name: "Demo Hall", addresses: ["10.0.0.0/24"] },
    venue_ip_check: { enabled: true, disabled_until: null, reason: null },
    flags_version: 1,
    flags: {},
    ...overrides,
  };
}

/** alpha and beta share one venue, as two events at one place do; the rest are edge cases. */
export const TENANTS: Record<string, TenantContext> = {
  "alpha.test": context("alpha"),
  "beta.test": context("beta"),
  "gamma.test": context("gamma", { status: "archived" }),
  "delta.test": context("delta", { venue: null }),
  "eps.test": context("eps", {
    venue_ip_check: {
      enabled: false,
      disabled_until: "2999-01-01T00:00:00Z",
      reason: "new uplink",
    },
  }),
  "zeta.test": context("zeta", { admin_access: "restricted" }),
  // Before the event: Studio opens on Zones, not Live.
  "eta.test": context("eta", { status: "draft" }),
  // Web and YouTube assets off: Studio offers no links (contracts/screen.md, Feature flags).
  "iota.test": context("iota", { flags: { "screen.web": false } }),
  // Another venue: no device of alpha's venue may move here.
  "far.test": context("far", {
    venue: { id: "v_2", name: "Far Hall", addresses: ["10.9.0.0/24"] },
  }),
};

/** The platform's own hostnames: never a tenant; the registry answers only on the first. */
export const SUPERADMIN_HOST = "super.platform.test";
export const SIGNIN_HOST = "signin.platform.test";

/** `resolve?host=` and `tenants/{id}`, as the tenants module answers them. */
export async function fakeTenants(url: string | URL | Request): Promise<Response> {
  const parsed = new URL(url instanceof Request ? url.url : url);
  const byId = /^\/internal\/tenants\/tenants\/([^/]+)$/.exec(parsed.pathname)?.[1];
  const ctx =
    byId === undefined
      ? TENANTS[parsed.searchParams.get("host") ?? ""]
      : Object.values(TENANTS).find((t) => t.tenant_id === byId);
  return Promise.resolve(ctx ? Response.json(ctx) : new Response("{}", { status: 404 }));
}
