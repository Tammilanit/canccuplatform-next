/** A screen app on a real Postgres (RLS needs one) with fake tenants, admin and Valkey. */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { requireTenant } from "@canccu/kit";
import type { Event, SettingValue, TenantContext } from "@canccu/kit";
import { MemoryStreamStore } from "@canccu/kit/testing";
import { buildApp } from "../src/app.js";
import type { StorageQuota } from "../src/assets/storage.js";
import type { AuditEntry } from "../src/audit.js";
import { APP_ROLE, MIGRATIONS_DIR, poolDb } from "../src/db.js";
import type { Db } from "../src/db.js";
import { requireDevice } from "../src/device-access.js";
import { sweepOffline } from "../src/health.js";
import { MemoryKv } from "../src/kv.js";
import { dispatchOnce, sweepLeases } from "../src/render/dispatch.js";
import type { DispatchDeps } from "../src/render/dispatch.js";
import type { RenderDeps } from "../src/render/jobs.js";
import { MemoryRenderQueue } from "../src/render/queue.js";

/** Tests run only with a Postgres to spare; never point this at a database you keep. */
export const DATABASE_URL = process.env.CANCCU_DATABASE_URL;

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
  "screen.content.read",
  "screen.content.write",
  "screen.push.write",
  "screen.ticker.write",
  "screen.photos.write",
];
const SESSIONS: Record<string, string[]> = {
  admin: ALL_RIGHTS,
  crew: ["screen.devices.read"],
  content: ["screen.content.read"],
  editor: ["screen.content.read", "screen.content.write"],
  ticker: ["screen.ticker.write"],
  photos: ["screen.photos.write"],
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
  /** tenant → the admin settings it answers; unset keys take their default. */
  settings: Record<string, Record<string, SettingValue>>;
  /** The fake storage quota: bytes per tenant, and the limit each gets (default 2 GiB). */
  storage: { used: Record<string, number>; quota: Record<string, number> };
  /** The fake quota itself, for calls made outside a request. */
  quota: StorageQuota;
  filesRoot: string;
  /** What the fake oEmbed answers for YouTube probes. */
  oembedStatus: { value: number };
  /** One run of the offline sweep, as main starts every 5 seconds. */
  sweep(): Promise<void>;
  queue: MemoryRenderQueue;
  /**
   * One turn of the render dispatcher against the renderer at `socketPath`; true if it ran a job.
   * `opts` replaces its deadline, database or bus, or gives it a shutdown signal.
   */
  dispatch(socketPath: string, opts?: Partial<DispatchDeps>): Promise<boolean>;
  /** One run of the lost-container sweep. */
  sweepLeases(): Promise<void>;
  close(): Promise<void>;
}

/** A fresh schema per file, migrated by the module's own files, as at start. */
export async function harness(): Promise<Harness> {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query(
    `DROP TABLE IF EXISTS screen_agenda_items, screen_zone_playback, screen_pushes, screen_schedules,
       screen_playlist_items, screen_playlists, assignments, screen_zones, screen_zone_seeds, devices,
       screen_migrations, screen_render_jobs, screen_asset_versions, screen_assets, screen_files,
       screen_ticker, screen_ticker_windows, screen_photos CASCADE`,
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
  const settings: Record<string, Record<string, SettingValue>> = {};
  const storage = { used: {} as Record<string, number>, quota: {} as Record<string, number> };
  const filesRoot = await mkdtemp(join(tmpdir(), "canccu-screen-files-"));
  const oembedStatus = { value: 200 };
  const quota: StorageQuota = {
    reserve: (bytes) => {
      const tenant = requireTenant();
      const used = (storage.used[tenant] ?? 0) + bytes;
      if (used > (storage.quota[tenant] ?? 2 ** 31)) {
        return Promise.reject(
          new KitError("This event's files would pass its storage quota.", {
            status: 413,
            code: "storage_quota_exceeded",
          }),
        );
      }
      storage.used[tenant] = used;
      return Promise.resolve();
    },
    release: (bytes) => {
      const tenant = requireTenant();
      storage.used[tenant] = Math.max(0, (storage.used[tenant] ?? 0) - bytes);
      return Promise.resolve();
    },
  };
  const queue = new MemoryRenderQueue();
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
    settings: {
      ensure: () => Promise.resolve(),
      get: (key: string, fallback: SettingValue) => settings[requireTenant()]?.[key] ?? fallback,
    },
    storage: quota,
    renderQueue: queue,
    filesRoot,
    fetch: () => Promise.resolve(new Response("{}", { status: oembedStatus.value })),
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
  const renderDeps: RenderDeps = {
    db,
    queue,
    bus,
    storage: quota,
    filesRoot,
    now: () => clock.now,
  };
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
    settings,
    storage,
    quota,
    filesRoot,
    oembedStatus,
    sweep: () => sweepOffline({ db, kv, bus, now: () => clock.now }),
    queue,
    dispatch: (socketPath, opts = {}) =>
      dispatchOnce({ ...renderDeps, socketPath, renewMs: 50, ...opts }),

    sweepLeases: () => sweepLeases(renderDeps),
    close: async () => {
      await app.close();
      await pool.end();
      await rm(filesRoot, { recursive: true, force: true });
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

/** A multipart upload of one file (and optionally a title or other fields), as Studio sends it. */
export function upload(
  h: Harness,
  url: string,
  file: Buffer,
  filename: string,
  c: Call & { title?: string; fields?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  const boundary = "canccu-test-boundary";
  const parts: Buffer[] = [];
  const fields = { ...(c.title === undefined ? {} : { title: c.title }), ...c.fields };
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\n` +
        "content-type: application/octet-stream\r\n\r\n",
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return h.app.inject({
    method: "POST",
    url,
    headers: {
      host: c.host ?? "alpha.test",
      "x-forwarded-for": c.ip ?? VENUE_IP,
      cookie: c.session ? `canccu_session=${c.session}` : "",
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat(parts),
  });
}

/** A small PNG; `seed` changes its bytes, so each seed is a file of its own. */
export async function png(seed = 0): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: seed % 256, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

export function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/media/${name}`, import.meta.url));
}
