/** Start theming: config, migrations as the migration role, then serve as the app role. */
import pg from "pg";
import {
  AdminClient,
  Bus,
  FILES_ROOT,
  RightsChecker,
  ServiceIdentity,
  TenantResolver,
  ValkeyStreamStore,
  checkLoginRole,
  createLogger,
  loadConfig,
  runMigrations,
  serviceKeyFromEnv,
  tenantsStorage,
} from "@canccu/kit";
import { buildApp, themingHealth } from "./app.js";
import { tenantsAudit } from "./audit.js";
import { APP_ROLE, MIGRATIONS_DIR, poolDb } from "./db.js";
import { diskFiles } from "./files.js";
import { listenPins } from "./pins.js";
import { adminProfile } from "./profile.js";
import { UPKEEP_MS, upkeepAll } from "./upkeep.js";

const PORT = 8080;
/** pg_advisory_lock key of the theming migrations; each module has its own. */
const MIGRATION_LOCK = 0x7e3e1;

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
      ledger: "theming_migrations",
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
  // Subscriptions block in XREAD on their connection; on the shared one the health check's PING
  // would wait behind them and time out, so they get a connection of their own.
  const listenStore = ValkeyStreamStore.fromUrl(config.valkeyUrl);
  const listener = new Bus(listenStore, config.module, log);
  const ipMode = process.env.CANCCU_IP_MODE === "demo";
  const tenantsUrl = env("CANCCU_TENANTS_URL");
  const tenants = new TenantResolver({
    tenantsUrl,
    service,
    platformHosts: [
      process.env.CANCCU_SIGNIN_HOSTNAME,
      process.env.CANCCU_SUPERADMIN_HOSTNAME,
    ].filter((h): h is string => !!h),
    ...(ipMode ? { ipMode: { version: config.version } } : {}),
  });
  const rights = new RightsChecker(new AdminClient(config.adminUrl));
  listener.subscribe(["tenants", "admin"], (event) => {
    if (event.source === "tenants") tenants.handleEvent(event);
    else rights.handleEvent(event);
  });
  const profile = adminProfile(config.adminUrl, service);
  // admin.profile.loaded goes to each event's own stream.
  listener.subscribeTenants(["admin"], (event) => {
    profile.handleEvent(event);
  });

  const db = poolDb(pool);
  const files = diskFiles(FILES_ROOT);
  const storage = tenantsStorage(tenantsUrl, service);
  listenPins(listener, { db, files, storage, log });
  const app = buildApp({
    db,
    files,
    storage,
    profile: profile.read,
    rights,
    tenants,
    bus: new Bus(store, config.module, log),
    audit: tenantsAudit(tenantsUrl, service),
    log,
    service,
    ipMode,
    health: themingHealth({
      module: config.module,
      version: config.version,
      store,
      query: () => pool.query("SELECT 1"),
      filesRoot: FILES_ROOT,
    }),
  });
  await app.listen({ host: "0.0.0.0", port: PORT });
  log.info({ port: PORT, version: config.version }, "theming started");

  const upkeep = setInterval(() => {
    upkeepAll({ db, files, storage, filesRoot: FILES_ROOT, log }).catch((err: unknown) => {
      log.warn({ err }, "theming's storage upkeep failed");
    });
  }, UPKEEP_MS);
  upkeep.unref();

  const stop = async (): Promise<void> => {
    clearInterval(upkeep);
    await app.close();
    // A dependency that is down may never answer; do not let it hold the exit.
    const grace = new Promise((resolve) => setTimeout(resolve, 2000).unref());
    await Promise.race([
      Promise.allSettled([store.close(), listenStore.close(), pool.end()]),
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
