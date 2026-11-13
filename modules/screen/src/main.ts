/** Start screen: config, migrations as the migration role, then serve as the app role. */
import { Valkey } from "iovalkey";
import pg from "pg";
import {
  AdminClient,
  Bus,
  FILES_ROOT,
  RightsChecker,
  ServiceIdentity,
  SettingsClient,
  TenantResolver,
  ValkeyStreamStore,
  checkLoginRole,
  createLogger,
  isTenantId,
  loadConfig,
  runMigrations,
  serviceKeyFromEnv,
  tenantsStorage,
  withTenant,
} from "@canccu/kit";
import { buildApp, screenHealth } from "./app.js";
import { readAssets } from "./assets/reader.js";
import { upkeepAll } from "./assets/upkeep.js";
import { tenantsAudit } from "./audit.js";
import { APP_ROLE, MIGRATIONS_DIR, poolDb } from "./db.js";
import { sweepOffline } from "./health.js";
import { ValkeyKv } from "./kv.js";
import { applyAgendaEvent } from "./content/agenda.js";
import { applyOverrideEvent } from "./compose/overrides.js";
import { httpSources } from "./compose/sources.js";
import { BundleStore, bundlesDir } from "./pins/bundles.js";
import { keepBundles } from "./pins/store.js";
import { pinTickRunner } from "./pins/tick.js";
import { PLAYER_DIR } from "./player.js";
import { REFRESH_MS } from "./push/hub.js";
import { ValkeyFanout, ValkeyZoneStore } from "./push/store.js";
import { renderLoop } from "./render/dispatch.js";
import { ValkeyRenderQueue } from "./render/queue.js";
import { TICK_MS, tickRunner } from "./tick/run.js";
import { seedMainZone } from "./zones.js";

const PORT = 8080;
/** pg_advisory_lock key of the screen migrations; each module has its own. */
const MIGRATION_LOCK = 0x5c4ee7;
/** How often a device past its deadline is reported offline (docs/plans/issue-107.md, D11). */
const SWEEP_MS = 5000;
/** How often each event is checked for its storage upkeep, which itself runs once an hour. */
const UPKEEP_CHECK_MS = 600_000;
/** In the `render-socket` volume, shared with screen-render alone (deploy/compose.yml). */
const RENDER_SOCKET = "/run/canccu-render/render.sock";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable(s): ${name}`);
  return value;
}

async function migrate(url: string, loginRole: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await runMigrations(client, MIGRATIONS_DIR, {
      ledger: "screen_migrations",
      lock: MIGRATION_LOCK,
      appRole: APP_ROLE,
      grantTo: loginRole,
    });
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.module);
  const databaseUrl = env("CANCCU_DATABASE_URL");
  const tenantsUrl = env("CANCCU_TENANTS_URL");
  await migrate(
    env("CANCCU_MIGRATE_DATABASE_URL"),
    decodeURIComponent(new URL(databaseUrl).username),
  );

  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 1500 });
  pool.on("error", (err) => {
    log.warn({ err }, "postgres connection lost");
  });
  const first = await pool.connect();
  try {
    await checkLoginRole(first);
  } finally {
    first.release();
  }

  const service = new ServiceIdentity({ module: config.module, key: serviceKeyFromEnv() });
  const store = ValkeyStreamStore.fromUrl(config.valkeyUrl);
  const kv = ValkeyKv.fromUrl(config.valkeyUrl);
  const queueClient = new Valkey(config.valkeyUrl, { maxRetriesPerRequest: 2 });
  // Without a listener a lost connection is an unhandled error event; /health reports it.
  queueClient.on("error", () => undefined);
  const renderQueue = new ValkeyRenderQueue(queueClient);
  // The zones' states go on the queue's connection; the fan-out's subscriber needs one of its
  // own, as a connection in subscribe mode can do nothing else.
  const pushSubscriber = new Valkey(config.valkeyUrl);
  pushSubscriber.on("error", () => undefined);
  const push = {
    zones: new ValkeyZoneStore(queueClient),
    fanout: new ValkeyFanout(pushSubscriber, queueClient, (err) => {
      log.warn({ err }, "push channel subscription failed");
    }),
  };
  const bus = new Bus(store, config.module, log);
  // Subscriptions block in XREAD on their connection; on the shared one the health check's PING
  // would wait behind them and time out, so they get a connection of their own.
  const listenStore = ValkeyStreamStore.fromUrl(config.valkeyUrl);
  const listener = new Bus(listenStore, config.module, log);
  const tenants = new TenantResolver({
    tenantsUrl,
    service,
    platformHosts: [
      process.env.CANCCU_SIGNIN_HOSTNAME,
      process.env.CANCCU_SUPERADMIN_HOSTNAME,
    ].filter((h): h is string => !!h),
    ...(process.env.CANCCU_IP_MODE === "demo" ? { ipMode: { version: config.version } } : {}),
  });
  const admin = new AdminClient(config.adminUrl);
  const rights = new RightsChecker(admin);
  const settings = new SettingsClient(admin, config.module, { service });
  // Admin's own settings hold the event's language, the one other module's settings screen reads
  // (contracts/admin.md, #394), so Studio's pages follow it.
  const adminSettings = new SettingsClient(admin, "admin", { service });
  const db = poolDb(pool);
  const seed = seedMainZone(db, bus);
  // One loop for both sources, so neither waits behind the other's blocking read.
  listener.subscribe(["tenants", "admin"], (event) => {
    if (event.source !== "tenants") {
      rights.handleEvent(event);
      void settings.handleEvent(event).catch((err: unknown) => {
        log.warn({ err }, "re-reading the screen settings failed");
      });
      void adminSettings.handleEvent(event).catch((err: unknown) => {
        log.warn({ err }, "re-reading the event's language failed");
      });
      return;
    }
    tenants.handleEvent(event);
    const id = event.data.tenant_id;
    if (event.type === "tenants.tenant.created" && typeof id === "string" && isTenantId(id)) {
      // Not awaited, so rights invalidations never queue behind a database write. A failure here
      // is not lost: the event's first zone, assignment or pairing request seeds it too.
      void withTenant(id, seed).catch((err: unknown) => {
        log.warn({ err, tenant_id: id }, "seeding the main zone failed");
      });
    }
  });

  // The run-of-show copy is rebuilt from the agenda streams' start at every boot: the bus has no
  // consumer groups, so events sent while no container ran would be lost (plan #108, D7). Its
  // own connection, as the subscriptions above block in XREAD.
  const agendaStore = ValkeyStreamStore.fromUrl(config.valkeyUrl);
  new Bus(agendaStore, config.module, log).subscribeTenants(
    ["agenda"],
    async (event) => {
      try {
        await applyAgendaEvent(db, event);
      } catch (err) {
        log.warn({ err, type: event.type }, "keeping an agenda event failed");
      }
    },
    { fromId: "0" },
  );

  const audit = tenantsAudit(tenantsUrl, service);
  const storage = tenantsStorage(tenantsUrl, service);
  // The service names of deploy/compose.yml; a stack that moves them sets the variables.
  const sources = httpSources(
    {
      agenda: process.env.CANCCU_AGENDA_URL ?? "http://agenda:8080",
      tenants: tenantsUrl,
      theming: process.env.CANCCU_THEMING_URL ?? "http://theming:8080",
      notify: process.env.CANCCU_NOTIFY_URL ?? "http://notify:8080",
    },
    service,
    log,
  );
  const bundles = new BundleStore({
    dir: bundlesDir(FILES_ROOT),
    current: config.version,
    playerDir: PLAYER_DIR,
  });
  // A failed copy leaves this version served from the image only; pins can still name it.
  await keepBundles({ db, store: bundles }).catch((err: unknown) => {
    log.warn({ err }, "keeping the player bundles failed");
  });
  const app = buildApp({
    db,
    kv,
    bus,
    rights,
    audit,
    storage,
    renderQueue,
    log,
    tenants,
    ...(process.env.CANCCU_SUPERADMIN_HOSTNAME
      ? { superadminHost: process.env.CANCCU_SUPERADMIN_HOSTNAME }
      : {}),
    settings,
    adminSettings,
    publicEvent: (host) => tenants.event(host),
    sources,
    bundleVersion: config.version,
    bundles,
    push,
    health: screenHealth({
      module: config.module,
      version: config.version,
      store,
      kv,
      query: () => pool.query("SELECT 1"),
      renderQueue,
    }),
  });
  // What changes the zones' screens draw, from now on: a stream opened later starts from a whole
  // state, and the refresh below catches what came while no container read the bus.
  const pushStore = ValkeyStreamStore.fromUrl(config.valkeyUrl);
  new Bus(pushStore, config.module, log).subscribeTenants(
    ["screen", "agenda", "tenants", "theming"],
    (event) => {
      app.pushHub.handleEvent(event);
    },
    // An event's stream that appears after the scan at start (its first event) is found at the
    // next rescan: every 5 seconds rather than the kit's 30, so a new event's first changes wait
    // less than the zone refresh would (a scan reads 1000 keys a step, of the stream type only).
    { rescanMs: 5000 },
  );
  // Moments' overrides (#307), from the streams' start at every boot as the agenda's above, so an
  // end sent while no container ran still ends its claim. Each is kept before the hub hears of
  // it, so the rebuild it starts reads it; its own connection, as XREAD blocks.
  const claimsStore = ValkeyStreamStore.fromUrl(config.valkeyUrl);
  new Bus(claimsStore, config.module, log).subscribeTenants(
    ["moments"],
    async (event) => {
      try {
        await applyOverrideEvent(db, event);
      } catch (err) {
        log.warn({ err, type: event.type }, "keeping a moments override failed");
      }
      app.pushHub.handleEvent(event);
    },
    { fromId: "0", rescanMs: 5000 },
  );
  const refresh = setInterval(() => {
    void app.pushHub.refreshAll();
  }, REFRESH_MS);
  await app.listen({ host: "0.0.0.0", port: PORT });
  log.info({ port: PORT, version: config.version }, "screen started");
  const sweep = setInterval(() => {
    sweepOffline({ db, kv, bus, now: Date.now, log }).catch((err: unknown) => {
      log.warn({ err }, "offline sweep failed");
    });
  }, SWEEP_MS);

  let upkeeping = false;
  const upkeep = setInterval(() => {
    if (upkeeping) return;
    upkeeping = true;
    upkeepAll({ db, kv, storage, filesRoot: FILES_ROOT, log })
      .catch((err: unknown) => {
        log.warn({ err }, "storage upkeep failed");
      })
      .finally(() => {
        upkeeping = false;
      });
  }, UPKEEP_CHECK_MS);

  const renders = renderLoop({
    db,
    queue: renderQueue,
    bus,
    storage,
    filesRoot: FILES_ROOT,
    now: Date.now,
    log,
    socketPath: process.env.CANCCU_RENDER_SOCKET ?? RENDER_SOCKET,
  });

  const tick = tickRunner({
    db,
    kv,
    bus,
    audit,
    settings,
    assets: readAssets,
    tenantById: (id) => tenants.byId(id),
    now: Date.now,
    log,
    played: (tenant, zones) => {
      app.pushHub.played(tenant, zones);
    },
    fanout: push.fanout,
  });
  const pinTick = pinTickRunner({
    db,
    kv,
    bus,
    audit,
    sources,
    bundles,
    fanout: push.fanout,
    tenantById: (id) => tenants.byId(id),
    now: Date.now,
    log,
  });
  let ticking = false;
  const ticker = setInterval(() => {
    // A slow step is never doubled up: the next second starts once this one is done.
    if (ticking) return;
    ticking = true;
    Promise.all([tick(), pinTick()])
      .catch((err: unknown) => {
        log.warn({ err }, "screen tick failed");
      })
      .finally(() => {
        ticking = false;
      });
  }, TICK_MS);

  const stop = async (): Promise<void> => {
    clearInterval(sweep);
    clearInterval(refresh);
    clearInterval(upkeep);
    clearInterval(ticker);
    // The running render goes back to its place before the pool and Valkey close; bounded, as a
    // dependency that is down may never answer.
    await Promise.race([
      renders.stop(),
      new Promise((resolve) => setTimeout(resolve, 5000).unref()),
    ]);
    await app.close();
    // A dependency that is down may never answer; do not let it hold the exit.
    const grace = new Promise((resolve) => setTimeout(resolve, 2000).unref());
    await Promise.race([
      Promise.allSettled([
        store.close(),
        listenStore.close(),
        agendaStore.close(),
        pushStore.close(),
        claimsStore.close(),
        pushSubscriber.quit(),
        kv.close(),
        queueClient.quit(),
        pool.end(),
      ]),
      grace,
    ]);
    process.exit(0);
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  process.exit(1);
});
