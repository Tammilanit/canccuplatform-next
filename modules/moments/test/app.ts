/** The moments app on a real Postgres, with fake tenants and admin and the audit log kept in memory. */
import type pg from "pg";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import {
  AdminClient,
  RightsChecker,
  ServiceIdentity,
  TenantResolver,
  createHealth,
  createLogger,
} from "@canccu/kit";
import type { TenantContext } from "@canccu/kit";
import { buildApp } from "../src/app.js";
import type { AuditEntry } from "../src/audit.js";
import type { AppDeps } from "../src/http.js";
import { world } from "./helpers.js";
import type { World } from "./helpers.js";

const ctx = (id: string, o: Partial<TenantContext> = {}): TenantContext => ({
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
  ...o,
});

const TENANTS: Record<string, TenantContext> = {
  "demo.test": ctx("demo"),
  "two.test": ctx("two"),
  "away.test": ctx("away", { venue: { id: "v_2", name: "Away", addresses: [] } }),
  "archived.test": ctx("archived", { status: "archived" }),
  "draft.test": ctx("draft", { status: "draft" }),
};
export const SUPERADMIN_HOST = "super.test";

const ALL = [
  "moments.read",
  "moments.announce",
  "moments.take",
  "moments.emergency",
  "moments.settings.write",
  "moments.scenes.take",
  "screen.zones.write",
];
const SESSIONS: Record<string, { rights: string[]; superadmin?: boolean }> = {
  admin: { rights: ALL },
  crew: { rights: ["moments.read", "moments.announce", "moments.take", "moments.scenes.take"] },
  reader: { rights: ["moments.read"] },
  nobody: { rights: [] },
  super: { rights: [], superadmin: true },
};

function fakeTenants(url: string | URL | Request): Promise<Response> {
  const parsed = new URL(url instanceof Request ? url.url : url);
  const byId = /^\/internal\/tenants\/tenants\/([a-z0-9-]+)$/.exec(parsed.pathname)?.[1];
  if (parsed.pathname === "/api/tenants/current") {
    return Promise.resolve(Response.json({ name: "Demo Event", status: "live", time_zone: "UTC" }));
  }
  if (
    parsed.pathname === "/internal/tenants/resolve" &&
    parsed.searchParams.get("host") === SUPERADMIN_HOST
  ) {
    return Promise.resolve(Response.json({ kind: "platform" }));
  }
  const host = parsed.searchParams.get("host") ?? "";
  const found = byId ? Object.values(TENANTS).find((t) => t.tenant_id === byId) : TENANTS[host];
  return Promise.resolve(found ? Response.json(found) : new Response("{}", { status: 404 }));
}

function fakeAdmin(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const cookie = (init?.headers as Record<string, string> | undefined)?.cookie ?? "";
  const id = cookie.replace("canccu_session=", "");
  const s = SESSIONS[id];
  if (s === undefined) {
    return Promise.resolve(
      Response.json({ error: { code: "not_signed_in", message: "no" } }, { status: 401 }),
    );
  }
  return Promise.resolve(
    Response.json({
      user: { id: `u_${id}`, name: `Demo ${id}` },
      rights: s.rights,
      superadmin: s.superadmin === true,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  );
}

export const SERVICE_KEY = "k".repeat(32);

/** An answer's JSON, loosely typed for the assertions. */
export const json = (r: LightMyRequestResponse): Record<string, unknown> =>
  r.json<Record<string, unknown>>();
export const idOf = (r: LightMyRequestResponse): string => String(json(r).id);
export const errorOf = (r: LightMyRequestResponse): Record<string, unknown> =>
  json(r).error as Record<string, unknown>;

export interface AppWorld extends World {
  app: FastifyInstance;
  audit: AuditEntry[];
  call(
    who: string | null,
    method: InjectOptions["method"],
    url: string,
    body?: unknown,
    o?: { host?: string; key?: string; form?: boolean },
  ): Promise<LightMyRequestResponse>;
}

let keys = 0;
export async function appWorld(
  pool: pg.Pool,
  o: Partial<Pick<AppDeps, "agenda">> = {},
): Promise<AppWorld> {
  const w = world(pool);
  const audit: AuditEntry[] = [];
  const app = buildApp({
    db: w.db,
    engine: w.engine,
    cues: w.cues,
    screen: w.screen,
    outbox: w.outbox,
    rights: new RightsChecker(new AdminClient("http://admin", { fetch: fakeAdmin })),
    tenants: new TenantResolver({
      tenantsUrl: "http://tenants",
      fetch: fakeTenants,
      platformHosts: [SUPERADMIN_HOST],
    }),
    audit: (e) => {
      audit.push(e);
      return Promise.resolve();
    },
    service: new ServiceIdentity({ module: "moments", key: SERVICE_KEY }),
    health: createHealth({ module: "moments", version: "dev", checks: {} }),
    log: createLogger("moments"),
    now: () => w.now,
    superadminHost: SUPERADMIN_HOST,
    ...o,
  });
  await app.ready();
  return Object.assign(w, {
    app,
    audit,
    call: (
      who: string | null,
      method: InjectOptions["method"],
      url: string,
      body?: unknown,
      o: { host?: string; key?: string; form?: boolean } = {},
    ) => {
      keys += 1;
      const headers: Record<string, string> = { host: o.host ?? "demo.test" };
      if (who !== null) headers.cookie = `canccu_session=${who}`;
      if (method !== "GET")
        headers["idempotency-key"] = o.key ?? `test-key-${String(keys).padStart(4, "0")}`;
      if (body !== undefined)
        headers["content-type"] =
          o.form === true ? "application/x-www-form-urlencoded" : "application/json";
      return app.inject({
        method: method ?? "GET",
        url,
        headers,
        ...(body === undefined
          ? {}
          : {
              payload:
                o.form === true
                  ? new URLSearchParams(body as Record<string, string>).toString()
                  : JSON.stringify(body),
            }),
      });
    },
  });
}
