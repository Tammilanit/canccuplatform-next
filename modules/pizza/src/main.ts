/** Start pizza: config, migrations as the migration role, then serve as the app role. */
import pg from "pg";
import {
  AdminClient,
  Bus,
  Outbox,
  RightsChecker,
  ServiceIdentity,
  SettingsClient,
  TenantResolver,
  ValkeyStreamStore,
  checkLoginRole,
  createHealth,
  createLogger,
  loadConfig,
  postgresCheck,
  runMigrations,
  serviceKeyFromEnv,
  valkeyCheck,
  withTenant,
} from "@canccu/kit";
import { buildApp } from "./app.js";
import { tenantsAudit } from "./audit.js";
import { handlePlatformEvent, handleTenantEvent } from "./consumer.js";
import { hostFetch } from "./host-fetch.js";
import { LiveHub } from "./live.js";
import { APP_ROLE, MIGRATIONS_DIR, poolDb } from "./db.js";
import { dropOldKeys } from "./idempotency.js";
import { everySessionIsMember, tenantsPeople } from "./people.js";
import { Scheduler, TICK_MS } from "./scheduler.js";
import { settingsReader } from "./settings.js";

const PORT = 8080;
/** pg_advisory_lock key of the pizza migrations; each module has its own. */
const MIGRATION_LOCK = 0x7122a;
const OUTBOX_RETRY_MS = 2000;
const UPKEEP_MS = 3_600_000;

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
      ledger: "pizza_migrations",
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
  // Subscriptions block in XREAD on their connection; the health check's PING gets its own.
  const listenStore = ValkeyStreamStore.fromUrl(config.valkeyUrl);
  const listener = new Bus(listenStore, config.module, log);
  // The pages' live streams read pizza's own event streams, on a connection of their own.
  const liveStore = ValkeyStreamStore.fromUrl(config.valkeyUrl);
  const tenantsUrl = env("CANCCU_TENANTS_URL");
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
  // Admin's own settings hold the event's language, the one module's settings another may read.
  const adminSettings = new SettingsClient(admin, "admin", { service });
  const db = poolDb(pool);
  const outbox = new Outbox(new Bus(store, config.module, log), db, { log });
  const now = () => new Date();
  const base = {
    db,
    outbox,
    rights,
    tenants,
    audit: tenantsAudit(tenantsUrl, service),
    log,
    now,
    members: everySessionIsMember,
    people: tenantsPeople(tenantsUrl, service),
    settings: settingsReader(settings),
  };
  const scheduler = new Scheduler(base);
  const live = new LiveHub();
  const deps = {
    ...base,
    live,
    // The Food settings page calls admin's settings API as the person, on the event's Host.
    admin: new AdminClient(config.adminUrl, { fetch: hostFetch }),
    language: (tenant: string) =>
      withTenant(tenant, async () => {
        await adminSettings.ensure();
        return String(adminSettings.get("language", "en"));
      }),
    health: createHealth({
      module: config.module,
      version: config.version,
      checks: {
        valkey: valkeyCheck(store),
        postgres: postgresCheck(() => pool.query("SELECT 1")),
        // O8: a late scheduler degrades the module; it never takes it down.
        scheduler: { run: scheduler.check(), essential: false },
      },
    }),
  };
  listener.subscribe(["tenants", "admin"], async (event) => {
    if (event.source === "tenants") {
      tenants.handleEvent(event);
      await handlePlatformEvent(deps, event);
    } else rights.handleEvent(event);
  });
  listener.subscribeTenants(["tenants", "admin"], async (event) => {
    if (event.source === "admin") {
      await settings.handleEvent(event);
      await adminSettings.handleEvent(event);
    } else await handleTenantEvent(deps, event);
  });

  new Bus(liveStore, config.module, log).subscribeTenants([config.module], (event) => {
    live.handle(event);
  });

  const app = buildApp(deps);
  await app.listen({ host: "0.0.0.0", port: PORT });
  log.info({ port: PORT, version: config.version }, "pizza started");

  const resend = setInterval(() => {
    outbox.flushAll().catch((err: unknown) => {
      log.warn({ err }, "sending the outbox failed");
    });
  }, OUTBOX_RETRY_MS);
  const hourly = setInterval(() => {
    void (async () => {
      const { rows } = await db.global((c) => c.query(`SELECT tenant_id FROM pizza_tenants`, []));
      for (const { tenant_id } of rows as { tenant_id: string }[]) {
        await withTenant(tenant_id, () => db.tenant((c) => dropOldKeys(c, now())));
      }
    })().catch((err: unknown) => {
      log.warn({ err }, "pizza upkeep failed");
    });
  }, UPKEEP_MS);
  const runTick = () => {
    scheduler.tick().catch((err: unknown) => {
      log.warn({ err }, "the pizza scheduler failed");
    });
  };
  // At once, so a restart catches up on what fell due while it was down.
  runTick();
  const tick = setInterval(runTick, TICK_MS);
  for (const t of [resend, hourly, tick]) t.unref();

  const stop = async (): Promise<void> => {
    for (const t of [resend, hourly, tick]) clearInterval(t);
    await app.close();
    // A dependency that is down may never answer; do not let it hold the exit.
    const grace = new Promise((resolve) => setTimeout(resolve, 2000).unref());
    await Promise.race([
      Promise.allSettled([store.close(), listenStore.close(), liveStore.close(), pool.end()]),
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
