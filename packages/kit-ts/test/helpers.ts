import { AdminClient } from "../src/index.js";
import type { TenantContext } from "../src/index.js";

export interface Recorded {
  method: string;
  path: string;
  cookie: string | null;
  body: unknown;
}

export type Answer = (req: Recorded) => Response | Promise<Response>;

/** A fake admin API: answers through `answer` and records every request. */
export class FakeAdmin {
  requests: Recorded[] = [];
  answer: Answer = () => jsonResponse(404, { error: { code: "not_found", message: "no" } });

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = new Headers(init?.headers);
    const rec: Recorded = {
      method: init?.method ?? "GET",
      path: url.pathname,
      cookie: headers.get("cookie"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    this.requests.push(rec);
    return this.answer(rec);
  };

  client(): AdminClient {
    return new AdminClient("http://admin", { fetch: this.fetch });
  }
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function sessionBody(rights: string[], expiresAt = "2999-01-01T00:00:00Z"): unknown {
  return { user: { id: "u1", name: "Demo User" }, rights, expires_at: expiresAt };
}

/** A live demo tenant at a venue with one IPv4 and one IPv6 prefix; override any field. */
export function tenantContext(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenant_id: "demo",
    status: "live",
    primary_hostname: "demo.example.org",
    time_zone: "Europe/Berlin",
    info_page_mode: "public",
    membership: "open",
    admin_access: "restricted",
    venue: { id: "v1", name: "Demo Hall", addresses: ["192.0.2.0/24", "2001:db8:1::/48"] },
    venue_ip_check: { enabled: true, disabled_until: null, reason: null },
    flags_version: 0,
    flags: {},
    ...overrides,
  };
}
