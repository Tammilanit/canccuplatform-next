/** A screen app on a real Postgres (RLS needs one) with fake tenants, admin and Valkey. */
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
  ServiceIdentity,
  TenantResolver,
  createHealth,
  requireTenant,
  runMigrations,
} from "@canccu/kit";
import type { PublicEvent, SettingValue, StorageQuota } from "@canccu/kit";
import { MemoryStreamStore, requireTestDatabase } from "@canccu/kit/testing";
import { buildApp } from "../src/app.js";
import type { Audit, AuditEntry } from "../src/audit.js";
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
import { fakeSettingsWrite } from "./settings-write.js";
import type { SettingsWrites } from "./settings-write.js";
import { ArtCache } from "../src/stage/art.js";
import { fakeAdmin } from "./admin-fake.js";
import { emptySources } from "./sources-fake.js";
import type { FakeSources } from "./sources-fake.js";

/** Tests run only on a database named `*_test` (dropTables refuses any other). */
export const DATABASE_URL = process.env.CANCCU_DATABASE_URL;
/** The platform's service key in tests: Moments signs its calls to the internal paths with it. */
export const SERVICE_KEY = "s".repeat(32);

export { VENUE_IP } from "./calls.js";
export const OUTSIDE_IP = "192.0.2.9";

export { SIGNIN_HOST, SUPERADMIN_HOST, TENANTS, context } from "./tenants.js";
export { SESSIONS } from "./admin-fake.js";
export type { FakeSources } from "./sources-fake.js";

export interface Harness {
  app: FastifyInstance;
  db: Db;
  pool: pg.Pool;
  store: MemoryStreamStore;
  bus: Bus;
  kv: MemoryKv;
  audits: AuditEntry[];
  /** The app's audit, for calls made outside a request. */
  audit: Audit;
  /** Set to make the next audit append fail, as a restarting tenants module does. */
  failAudit: { next: boolean };
  clock: { now: number };
  /** tenant → the admin settings it answers; unset keys take their default. */
  settings: Record<string, Record<string, SettingValue>>;
  /** Screen's own settings written through admin (the Motion card). */
  settingsWrites: SettingsWrites;
  /** Set to make reading Screen's own settings fail, as while admin is down and none are held. */
  settingsDown: { value: boolean };
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
  /** The covers the edge answers for the stage's art, by path, on any host. */
  covers: Record<string, Buffer>;
  /** Each path the stage's art read through the edge, in order. */
  coverReads: string[];
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

/** Drops every screen table; `assignments` too, the name before migration 007. */
export async function dropTables(admin: pg.Client): Promise<void> {
  await requireTestDatabase(admin);
  await admin.query(
    `DROP TABLE IF EXISTS screen_agenda_items, screen_zone_playback, screen_pushes, screen_schedules,
       screen_playlist_items, screen_playlists, assignments, screen_assignments, screen_zones,
       screen_zone_seeds, devices, screen_migrations, screen_render_jobs, screen_asset_versions,
       screen_assets, screen_files, screen_ticker, screen_ticker_windows, screen_photos, screen_claims, screen_scenes, screen_pins,
       screen_pin_tenants, screen_previews, screen_outbox, screen_outbox_tenants, screen_zone_sounds, screen_moments_prefetch CASCADE`,
  );
}

/**
 * A fresh schema per file, migrated by the module's own files, as at start. `saves: false` leaves
 * out admin's settings write, as an app given none.
 */
export async function harness(options: { saves?: boolean } = {}): Promise<Harness> {
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
  const covers: Record<string, Buffer> = {};
  const coverReads: string[] = [];
  const fake = emptySources();
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
  const settingsWrites: SettingsWrites = { versions: {}, values: {}, log: [] };
  const settingsDown = { value: false };
  // Screen's held copy of what admin answered: like the kit's SettingsClient, a write through
  // admin reaches it only on load() (or admin's event, which the harness does not send).
  const heldVersions: Record<string, number> = {};
  const audit: Audit = (entry) => {
    if (failAudit.next) {
      failAudit.next = false;
      return Promise.reject(
        new KitError("audit down", { status: 503, code: "tenants_unavailable" }),
      );
    }
    audits.push(entry);
    return Promise.resolve();
  };
  const app = buildApp({
    db,
    kv,
    bus,
    rights,
    audit,
    tenants,
    superadminHost: SUPERADMIN_HOST,
    service: new ServiceIdentity({ module: "screen", key: SERVICE_KEY }),
    health: createHealth({ module: "screen", version: "dev", checks: {} }),
    settings: {
      ensure: () =>
        settingsDown.value ? Promise.reject(new Error("admin is down")) : Promise.resolve(),
      get: (key: string, fallback: SettingValue) => settings[requireTenant()]?.[key] ?? fallback,
      get settingsVersion() {
        return heldVersions[requireTenant()] ?? 0;
      },
      load: (tenant: string) => {
        settings[tenant] = { ...settings[tenant], ...settingsWrites.values[tenant] };
        heldVersions[tenant] = settingsWrites.versions[tenant] ?? 0;
        return Promise.resolve();
      },
    },
    ...(options.saves === false ? {} : { writeSettings: fakeSettingsWrite(settingsWrites) }),
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
    publicEvent: (host, cookie) => {
      const e = publicEvents[host ?? ""] ?? null;
      // As tenants hides a draft from guests; it names it to a member's session.
      const hidden = e?.status === "draft" && !cookie;
      return Promise.resolve(hidden ? { id: e.id, status: e.status } : e);
    },
    art: new ArtCache(kv, (_host, path) => {
      coverReads.push(path);
      return Promise.resolve(covers[path] ?? null);
    }),
    sources: {
      theme: (tenantId) => answer(fake.tenants, tenantId, fake.theme),
      themeRevision: (tenantId, revision) =>
        answer(
          fake.tenants,
          tenantId,
          fake.revisionsDown ? null : (fake.revisions[revision] ?? "gone"),
        ),
      themePreview: (tenantId, key) =>
        answer(fake.tenants, tenantId, fake.draftsDown ? null : (fake.drafts[key] ?? "gone")),
      event: (host) => answer(fake.hosts, host, fake.event),
      agendaNow: (tenantId) => answer(fake.tenants, tenantId, fake.agenda),
      agendaItems: (tenantId) => answer(fake.tenants, tenantId, fake.agendaItems),
      // Not counted in `tenants`: the kept copy is no read of agenda.
      agendaDay: () => Promise.resolve(fake.agendaDay),
      venueInfo: (tenantId) => answer(fake.tenants, tenantId, fake.venue),
      checkinCode: (_tenantId, purpose) => answer(fake.checkinReads, purpose, fake.checkin),
      checkinCount: (_tenantId, purpose) => answer(fake.countReads, purpose, fake.checkins),
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
    audit,
    failAudit,
    clock,
    settings,
    settingsWrites,
    settingsDown,
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
    covers,
    coverReads,
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
