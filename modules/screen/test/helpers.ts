/** A screen app on a real Postgres (RLS needs one) with fake tenants, admin and Valkey. */
import pg from "pg";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import {
  AdminClient,
  Bus,
  RightsChecker,
  TenantResolver,
  KitError,
  createHealth,
  runMigrations,
} from "@canccu/kit";
import type { Event, TenantContext } from "@canccu/kit";
import { MemoryStreamStore } from "@canccu/kit/testing";
import { buildApp } from "../src/app.js";
import type { AuditEntry } from "../src/audit.js";
import { APP_ROLE, MIGRATIONS_DIR, poolDb } from "../src/db.js";
import type { Db } from "../src/db.js";
import { requireDevice } from "../src/device-access.js";
import { MemoryKv } from "../src/kv.js";

/** Tests run only with a Postgres to spare; never point this at a database you keep. */
export const DATABASE_URL = process.env.CANCCU_TEST_DATABASE_URL;

export const VENUE_IP = "10.0.0.5";
export const OUTSIDE_IP = "192.0.2.9";

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
};

const ALL_RIGHTS = [
  "screen.devices.read",
  "screen.devices.pair",
  "screen.devices.write",
  "screen.zones.write",
];
const SESSIONS: Record<string, string[]> = {
  admin: ALL_RIGHTS,
  crew: ["screen.devices.read"],
  content: ["screen.content.read"],
  nobody: [],
};

async function fakeTenants(url: string | URL | Request): Promise<Response> {
  const host = new URL(url instanceof Request ? url.url : url).searchParams.get("host") ?? "";
  const ctx = TENANTS[host];
  return Promise.resolve(ctx ? Response.json(ctx) : new Response("{}", { status: 404 }));
}

async function fakeAdmin(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const cookie = (init?.headers as Record<string, string> | undefined)?.cookie ?? "";
  const id = cookie.replace("canccu_session=", "");
  const rights = SESSIONS[id];
  if (rights === undefined) {
    return Promise.resolve(
      Response.json({ error: { code: "not_signed_in", message: "no" } }, { status: 401 }),
    );
  }
  return Promise.resolve(
    Response.json({
      user: { id: `u_${id}`, name: id },
      rights,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  );
}

export interface Harness {
  app: FastifyInstance;
  db: Db;
  pool: pg.Pool;
  store: MemoryStreamStore;
  bus: Bus;
  kv: MemoryKv;
  audits: AuditEntry[];
  /** Set to make the next audit append fail, as a restarting tenants module does. */
  failAudit: { next: boolean };
  clock: { now: number };
  close(): Promise<void>;
}

/** A fresh schema per file, migrated by the module's own files, as at start. */
export async function harness(): Promise<Harness> {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query(
    "DROP TABLE IF EXISTS assignments, screen_zones, screen_zone_seeds, devices, screen_migrations CASCADE",
  );
  await runMigrations(admin, MIGRATIONS_DIR, { ledger: "screen_migrations", lock: 1 });
  await admin.end();
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const db = poolDb(pool);
  const clock = { now: Date.parse("2026-01-01T12:00:00Z") };
  const store = new MemoryStreamStore();
  const audits: AuditEntry[] = [];
  const failAudit = { next: false };
  const kv = new MemoryKv(() => clock.now);
  const bus = new Bus(store, "screen");
  const app = buildApp({
    db,
    kv,
    bus,
    rights: new RightsChecker(new AdminClient("http://admin", { fetch: fakeAdmin })),
    audit: (entry) => {
      if (failAudit.next) {
        failAudit.next = false;
        return Promise.reject(
          new KitError("audit down", { status: 503, code: "tenants_unavailable" }),
        );
      }
      audits.push(entry);
      return Promise.resolve();
    },
    tenants: new TenantResolver({ tenantsUrl: "http://tenants", fetch: fakeTenants }),
    health: createHealth({ module: "screen", version: "dev", checks: {} }),
    now: () => clock.now,
  });
  // A stand-in for the device routes later slices add (state, heartbeat): it runs only the check.
  app.get("/api/screen/device/_probe", { preHandler: requireDevice(db) }, (request) => ({
    device_id: request.device?.id,
  }));
  app.get(
    "/api/screen/device/_home",
    { preHandler: requireDevice(db, { allowElsewhere: true }) },
    (request) => ({
      device_id: request.device?.id,
    }),
  );
  await app.ready();
  return {
    app,
    db,
    pool,
    store,
    bus,
    kv,
    audits,
    failAudit,
    clock,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export interface Call {
  host?: string;
  ip?: string;
  session?: string;
  cookies?: Record<string, string>;
  body?: unknown;
}

export function call(
  h: Harness,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  c: Call = {},
): Promise<LightMyRequestResponse> {
  const cookies = { ...(c.session ? { canccu_session: c.session } : {}), ...c.cookies };
  return h.app.inject({
    method,
    url,
    headers: {
      host: c.host ?? "alpha.test",
      "x-forwarded-for": c.ip ?? VENUE_IP,
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
      ...(c.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(c.body === undefined ? {} : { payload: JSON.stringify(c.body) }),
  });
}

/** The value a response sets for a cookie, or undefined. */
export function setCookie(res: LightMyRequestResponse, name: string): string | undefined {
  const header = [res.headers["set-cookie"] ?? []].flat();
  const line = header.find((h) => h.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(";")[0];
}

/** The data of the bus events of `type` on `tenant`'s screen stream, oldest first. */
export function events(h: Harness, type: string, tenant = "alpha"): Record<string, unknown>[] {
  return (h.store.streams.get(`t:${tenant}:events:screen`) ?? [])
    .map(([, fields]) => JSON.parse(fields.event ?? "{}") as Event)
    .filter((e) => e.type === type)
    .map((e) => e.data);
}

export function code(res: LightMyRequestResponse): string {
  return res.json<{ error: { code: string } }>().error.code;
}

/** Pair a device on `host` end to end; returns its id and the kiosk's device cookie. */
export async function pairDevice(
  h: Harness,
  host = "alpha.test",
  name = "Hall left",
): Promise<{ id: string; token: string }> {
  const start = await call(h, "POST", "/api/screen/pairing", { host });
  const pairing = start.json<{ pairing_id: string; code: string }>();
  const pairingCookie = setCookie(start, "canccu_pairing") ?? "";
  const claim = await call(h, "POST", "/api/screen/devices", {
    host,
    session: "admin",
    body: { code: pairing.code, name },
  });
  const poll = await call(h, "GET", `/api/screen/pairing/${pairing.pairing_id}`, {
    host,
    cookies: { canccu_pairing: pairingCookie },
  });
  return { id: claim.json<{ id: string }>().id, token: setCookie(poll, "canccu_device") ?? "" };
}

export { APP_ROLE };
