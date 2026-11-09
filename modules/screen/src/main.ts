/** Start screen: config, migrations as the migration role, then serve as the app role. */
import pg from "pg";
import {
  AdminClient,
  Bus,
  RightsChecker,
  ServiceIdentity,
  TenantResolver,
  ValkeyStreamStore,
  checkLoginRole,
  createLogger,
  loadConfig,
  runMigrations,
  serviceKeyFromEnv,
} from "@canccu/kit";
import { buildApp, screenHealth } from "./app.js";
import { tenantsAudit } from "./audit.js";
import { APP_ROLE, MIGRATIONS_DIR, poolDb } from "./db.js";
import { ValkeyKv } from "./kv.js";

const PORT = 8080;
/** pg_advisory_lock key of the screen migrations; each module has its own. */
const MIGRATION_LOCK = 0x5c4ee7;

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
  const rights = new RightsChecker(new AdminClient(config.adminUrl));
  // One loop for both sources, so neither waits behind the other's blocking read.
  listener.subscribe(["tenants", "admin"], (event) => {
    if (event.source === "tenants") tenants.handleEvent(event);
    else rights.handleEvent(event);
  });

  const app = buildApp({
    db: poolDb(pool),
    kv,
    bus,
    rights,
    audit: tenantsAudit(tenantsUrl, service),
    log,
    tenants,
    health: screenHealth({
      module: config.module,
      version: config.version,
      store,
      query: () => pool.query("SELECT 1"),
    }),
  });
  await app.listen({ host: "0.0.0.0", port: PORT });
  log.info({ port: PORT, version: config.version }, "screen started");

  const stop = async (): Promise<void> => {
    await app.close();
    // A dependency that is down may never answer; do not let it hold the exit.
    const grace = new Promise((resolve) => setTimeout(resolve, 2000).unref());
    await Promise.race([
      Promise.allSettled([store.close(), listenStore.close(), kv.close(), pool.end()]),
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
