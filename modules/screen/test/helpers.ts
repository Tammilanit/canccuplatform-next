/** A screen app on a real Postgres (RLS needs one) with fake tenants, admin and Valkey. */
import type { ThemeNow } from "../src/compose/sources.js";
import type { AgendaItem, AgendaNow, CheckinCode, VenueInfo } from "../src/compose/widgets.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import {
  AdminClient,
  Bus,
  KitError,
  RightsChecker,
  TenantResolver,
  createHealth,
  requireTenant,
  runMigrations,
} from "@canccu/kit";
import type { PublicEvent, SettingValue, StorageQuota } from "@canccu/kit";
import { MemoryStreamStore, requireTestDatabase } from "@canccu/kit/testing";
import { buildApp } from "../src/app.js";
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
import { call, setCookie } from "./calls.js";
import { SIGNIN_HOST, SUPERADMIN_HOST, fakeTenants } from "./tenants.js";

/** Tests run only on a database named `*_test` (dropTables refuses any other). */
export const DATABASE_URL = process.env.CANCCU_DATABASE_URL;

export { VENUE_IP } from "./calls.js";
export const OUTSIDE_IP = "192.0.2.9";

export { SIGNIN_HOST, SUPERADMIN_HOST, TENANTS, context } from "./tenants.js";

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
  "screen.bundle.write",
];
/** The sessions the fake admin knows; a test may add or remove one (then drop it from `h.rights`). */
export const SESSIONS: Record<string, string[]> = {
  admin: ALL_RIGHTS,
  crew: ["screen.devices.read"],
  content: ["screen.content.read"],
  editor: ["screen.content.read", "screen.content.write"],
  ticker: ["screen.ticker.write"],
  photos: ["screen.photos.write"],
  bundler: ["screen.bundle.write"],
  nobody: [],
  // `superadmin` as admin answers it: a platform-bound session with `mfa_enabled` (G2).
  root: [],
};

async function fakeAdmin(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const cookie = (init?.headers as Record<string, string> | undefined)?.cookie ?? "";
  const id = cookie.replace("canccu_session=", "");
  if (id === "admin-down") return Promise.resolve(new Response("down", { status: 503 }));
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
      superadmin: id === "root",
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
  /** tenant → admin's own settings (the event's `language`), as Studio reads them. */
  adminSettings: Record<string, Record<string, SettingValue>>;
  /** The fake storage quota: bytes per tenant, and the limit each gets (default 2 GiB). */
  storage: { used: Record<string, number>; quota: Record<string, number> };
  /** The fake quota itself, for calls made outside a request. */
  quota: StorageQuota;
  filesRoot: string;
  /** The player's built files, which a test may take away. */
  playerDir: string;
  /** What the fake oEmbed answers for YouTube probes. */
  oembedStatus: { value: number };
  /** What the fake agenda, tenants and theming answer the composed state; null is "down". */
  sources: FakeSources;
  /** host → the event's public answer (its `ends_at`); unset hosts answer nothing. */
  publicEvents: Record<string, PublicEvent>;
  /** The app's tenant cache; a test that changes TENANTS clears it with a tenants event. */
  tenants: TenantResolver;
  /** The app's rights cache; a test that changes SESSIONS clears it with `admin.rights.changed`. */
  rights: RightsChecker;
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

export interface FakeSources {
  theme: ThemeNow | null;
  /** The event's theme revisions by number, as the pinned read answers them. */
  revisions: Record<number, ThemeNow>;
  event: { name: string } | null;
  agenda: AgendaNow | null;
  /** The whole run of show (`GET /internal/agenda/items`); null is "down". */
  agendaItems: AgendaItem[] | null;
  venue: VenueInfo | null;
  /** The hostnames the guest read (event) was made with. */
  hosts: string[];
  /** The tenant ids the module reads (theme, now and next, venue info) were made for. */
  tenants: string[];
  checkin: CheckinCode | null;
  /** The purposes notify's check-in code was read for. */
  checkinReads: string[];
}

/** Drops every screen table; `assignments` too, the name before migration 007. */
export async function dropTables(admin: pg.Client): Promise<void> {
  await requireTestDatabase(admin);
  await admin.query(
    `DROP TABLE IF EXISTS screen_agenda_items, screen_zone_playback, screen_pushes, screen_schedules,
       screen_playlist_items, screen_playlists, assignments, screen_assignments, screen_zones,
       screen_zone_seeds, devices, screen_migrations, screen_render_jobs, screen_asset_versions,
       screen_assets, screen_files, screen_ticker, screen_ticker_windows, screen_photos, screen_claims, screen_pins,
       screen_pin_tenants CASCADE`,
  );
}

/** A fresh schema per file, migrated by the module's own files, as at start. */
export async function harness(): Promise<Harness> {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  // finally: a refused database must not leave the client open and hold the run.
  try {
    await dropTables(admin);
    await runMigrations(admin, MIGRATIONS_DIR, { ledger: "screen_migrations", lock: 1 });
  } finally {
    await admin.end();
  }
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const db = poolDb(pool);
  const clock = { now: Date.parse("2026-01-01T12:00:00Z") };
  const store = new MemoryStreamStore();
  const audits: AuditEntry[] = [];
  const failAudit = { next: false };
  const kv = new MemoryKv(() => clock.now);
  const bus = new Bus(store, "screen");
  const settings: Record<string, Record<string, SettingValue>> = {};
  const adminSettings: Record<string, Record<string, SettingValue>> = {};
  const storage = { used: {} as Record<string, number>, quota: {} as Record<string, number> };
  const filesRoot = await mkdtemp(join(tmpdir(), "canccu-screen-files-"));
  const playerDir = await mkdtemp(join(tmpdir(), "canccu-screen-player-"));
  await writeFile(join(playerDir, "player.js"), "export {};\n");
  await writeFile(join(playerDir, "player.css"), "body {}\n");
  await writeFile(join(playerDir, "sw.js"), "self;\n");
  const oembedStatus = { value: 200 };
  const fake: FakeSources = {
    theme: null,
    revisions: {},
    event: null,
    agenda: null,
    agendaItems: null,
    venue: null,
    hosts: [],
    tenants: [],
    checkin: null,
    checkinReads: [],
  };
  const answer = <T>(seen: string[], key: string, value: T): Promise<T> => {
    seen.push(key);
    return Promise.resolve(value);
  };
  const quota: StorageQuota = {
    module: "screen",
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
    repair: (bytes) => {
      storage.used[requireTenant()] = bytes;
      return Promise.resolve();
    },
  };
  const queue = new MemoryRenderQueue();
  const publicEvents: Record<string, PublicEvent> = {};
  const tenants = new TenantResolver({
    tenantsUrl: "http://tenants",
    fetch: fakeTenants,
    platformHosts: [SUPERADMIN_HOST, SIGNIN_HOST],
  });
  const rights = new RightsChecker(new AdminClient("http://admin", { fetch: fakeAdmin }));
  const app = buildApp({
    db,
    kv,
    bus,
    rights,
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
    tenants,
    superadminHost: SUPERADMIN_HOST,
    health: createHealth({ module: "screen", version: "dev", checks: {} }),
    settings: {
      ensure: () => Promise.resolve(),
      get: (key: string, fallback: SettingValue) => settings[requireTenant()]?.[key] ?? fallback,
    },
    adminSettings: {
      ensure: () => Promise.resolve(),
      get: (key: string, fallback: SettingValue) =>
        adminSettings[requireTenant()]?.[key] ?? fallback,
    },
    storage: quota,
    renderQueue: queue,
    filesRoot,
    fetch: () => Promise.resolve(new Response("{}", { status: oembedStatus.value })),
    now: () => clock.now,
    bundleVersion: "test",
    playerDir,
    streamPingMs: 200,
    publicEvent: (host) => Promise.resolve(publicEvents[host ?? ""] ?? null),
    sources: {
      theme: (tenantId) => answer(fake.tenants, tenantId, fake.theme),
      themeRevision: (tenantId, revision) =>
        answer(fake.tenants, tenantId, fake.revisions[revision] ?? null),
      event: (host) => answer(fake.hosts, host, fake.event),
      agendaNow: (tenantId) => answer(fake.tenants, tenantId, fake.agenda),
      agendaItems: (tenantId) => answer(fake.tenants, tenantId, fake.agendaItems),
      venueInfo: (tenantId) => answer(fake.tenants, tenantId, fake.venue),
      checkinCode: (_tenantId, purpose) => answer(fake.checkinReads, purpose, fake.checkin),
    },
  });
  // A stand-in for the device routes later slices add (the state, the stream): it runs only the check.
  app.get(
    "/api/screen/device/_probe",
    { preHandler: requireDevice(db, { now: () => new Date(clock.now) }) },
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
    adminSettings,
    storage,
    quota,
    filesRoot,
    playerDir,
    oembedStatus,
    sources: fake,
    publicEvents,
    tenants,
    rights,
    sweep: () => sweepOffline({ db, kv, bus, now: () => clock.now }),
    queue,
    dispatch: (socketPath, opts = {}) =>
      dispatchOnce({ ...renderDeps, socketPath, renewMs: 50, ...opts }),

    sweepLeases: () => sweepLeases(renderDeps),
    close: async () => {
      await app.close();
      await pool.end();
      await rm(filesRoot, { recursive: true, force: true });
      await rm(playerDir, { recursive: true, force: true });
    },
  };
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

export { fixture, png, upload } from "./uploads.js";
export { call, code, events, setCookie } from "./calls.js";
export type { Call } from "./calls.js";
