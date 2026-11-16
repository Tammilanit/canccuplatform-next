/** Start moments: config, migrations as the migration role, then serve as the app role. */
import pg from "pg";
import {
  AdminClient,
  Bus,
  Outbox,
  RightsChecker,
  ServiceIdentity,
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
} from "@canccu/kit";
import { buildApp } from "./app.js";
import { tenantsAudit } from "./audit.js";
import {
  TENANT_STREAMS,
  handlePlatformEvent,
  handleTenantEvent,
  handleZoneReplay,
} from "./consumer.js";
import { APP_ROLE, MIGRATIONS_DIR, poolDb } from "./db.js";
import { Engine } from "./engine.js";
import { ValkeyCounters } from "./cues/counters.js";
import { screenClient } from "./cues/screen.js";
import { Cues } from "./cues/service.js";
import { SceneTicker, TICK_MS, tickAll, upkeep } from "./tick.js";
import { httpAgenda, timeZones } from "./agenda.js";

const PORT = 8080;
/** pg_advisory_lock key of the moments migrations; each module has its own. */
const MIGRATION_LOCK = 0x70e11;
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
      ledger: "moments_migrations",
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
  const tenantsUrl = env("CANCCU_TENANTS_URL");
  const superadminHost = process.env.CANCCU_SUPERADMIN_HOSTNAME || undefined;
  const tenants = new TenantResolver({
    tenantsUrl,
    service,
    platformHosts: [process.env.CANCCU_SIGNIN_HOSTNAME, superadminHost].filter(
      (h): h is string => !!h,
    ),
    ...(process.env.CANCCU_IP_MODE === "demo" ? { ipMode: { version: config.version } } : {}),
  });
  const rights = new RightsChecker(new AdminClient(config.adminUrl));
  const db = poolDb(pool);
  const outbox = new Outbox(new Bus(store, config.module, log), db, { log });
  const counters = ValkeyCounters.fromUrl(config.valkeyUrl);
  const screen = screenClient(env("CANCCU_SCREEN_URL"), service);
  const cues = new Cues({ outbox, counters, screen });
  const engine = new Engine(outbox, cues);
  const now = () => new Date();
  const agenda = httpAgenda(env("CANCCU_AGENDA_URL"), service);
  const timeZoneOf = timeZones(tenants);
  const consumer = { db, engine, flush: () => outbox.flush(), now, agenda, timeZoneOf };
  listener.subscribe(["tenants", "admin"], async (event) => {
    if (event.source === "tenants") tenants.handleEvent(event);
    else rights.handleEvent(event);
    await handlePlatformEvent(consumer, event);
  });
  listener.subscribeTenants(TENANT_STREAMS, (event) => handleTenantEvent(consumer, event));
  listener.subscribeTenants(["screen"], (event) => handleZoneReplay(consumer, event), {
    fromId: "0",
  });

  const app = buildApp({
    db,
    engine,
    cues,
    screen,
    outbox,
    rights,
    tenants,
    audit: tenantsAudit(tenantsUrl, service),
    service,
    agenda,
    log,
    now,
    superadminHost,
    health: createHealth({
      module: config.module,
      version: config.version,
      checks: { valkey: valkeyCheck(store), postgres: postgresCheck(() => pool.query("SELECT 1")) },
    }),
  });
  await app.listen({ host: "0.0.0.0", port: PORT });
  log.info({ port: PORT, version: config.version }, "moments started");

  const scenes = new SceneTicker();
  // The tick owns every TTL and patience (E2); one pass at a time, never overlapping itself.
  let ticking = false;
  const tick = setInterval(() => {
    if (ticking) return;
    ticking = true;
    tickAll({ ...consumer, log, scenes })
      .catch((err: unknown) => {
        log.warn({ err }, "the moments tick failed");
      })
      .finally(() => (ticking = false));
  }, TICK_MS);
  const resend = setInterval(() => {
    outbox.flushAll().catch((err: unknown) => {
      log.warn({ err }, "sending the outbox failed");
    });
  }, OUTBOX_RETRY_MS);
  const hourly = setInterval(() => {
    upkeep(db, now()).catch((err: unknown) => {
      log.warn({ err }, "moments upkeep failed");
    });
  }, UPKEEP_MS);
  for (const t of [tick, resend, hourly]) t.unref();

  const stop = async (): Promise<void> => {
    for (const t of [tick, resend, hourly]) clearInterval(t);
    await app.close();
    // A dependency that is down may never answer; do not let it hold the exit.
    const grace = new Promise((resolve) => setTimeout(resolve, 2000).unref());
    await Promise.race([
      Promise.allSettled([store.close(), listenStore.close(), counters.close(), pool.end()]),
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
