/**
 * `docker compose exec pizza node dist/dev-seed-cli.js [--force]`: the dev server's demo food
 * (dev-seed.ts). Refused before anything connects outside dev mode.
 */
import pg from "pg";
import {
  AdminClient,
  Bus,
  DEMO_TENANT,
  FILES_ROOT,
  Outbox,
  ServiceIdentity,
  SettingsClient,
  TenantResolver,
  ValkeyStreamStore,
  createLogger,
  loadConfig,
  serviceKeyFromEnv,
} from "@canccu/kit";
import { poolDb } from "./db.js";
import { settingsReader } from "./settings.js";
import { Refused, demoPizzerias, seedDemoFood } from "./dev-seed.js";

async function run(force: boolean): Promise<string[]> {
  const config = loadConfig();
  if (config.version !== "dev")
    throw new Refused(`CANCCU_VERSION is ${config.version}, not dev: nothing changed`);
  const missing = ["CANCCU_DATABASE_URL", "CANCCU_TENANTS_URL"].filter((n) => !process.env[n]);
  if (missing.length > 0) throw new Error(`missing environment variable(s): ${missing.join(", ")}`);
  const pizzerias = await demoPizzerias(process.env.CANCCU_DEMO_EVENT_DIR ?? "/repo/events/demo");
  const service = new ServiceIdentity({ module: config.module, key: serviceKeyFromEnv() });
  const tenants = new TenantResolver({ tenantsUrl: process.env.CANCCU_TENANTS_URL ?? "", service });
  const event = await tenants.byId(DEMO_TENANT);
  if (event === null) throw new Refused("there is no demo event: nothing changed");
  const pool = new pg.Pool({ connectionString: process.env.CANCCU_DATABASE_URL });
  try {
    const log = createLogger(config.module);
    const db = poolDb(pool);
    const bus = new Bus(ValkeyStreamStore.fromUrl(config.valkeyUrl), config.module, log);
    // Admin's dev seed has loaded the profile's settings by now; the seed follows them.
    const settings = settingsReader(
      new SettingsClient(new AdminClient(config.adminUrl), config.module, { service }),
    );
    const { settle_to_payer: settleToPayer } = await settings(DEMO_TENANT);
    return await seedDemoFood(
      { db, outbox: new Outbox(bus, db, { log }), now: () => new Date(), filesRoot: FILES_ROOT },
      { version: config.version, timeZone: event.time_zone, pizzerias, settleToPayer, force },
    );
  } finally {
    await pool.end();
  }
}

const args = process.argv.slice(2);
if (args.some((a) => a !== "--force")) {
  process.stderr.write("usage: node dist/dev-seed-cli.js [--force]\n");
  process.exit(2);
}
run(args.includes("--force")).then(
  (said) => {
    process.stdout.write(said.join("\n") + "\n");
    // The Valkey connection would keep the process alive.
    process.exit(0);
  },
  (err: unknown) => {
    const refused = err instanceof Refused;
    process.stderr.write(`${refused ? "refused: " : "error: "}${(err as Error).message}\n`);
    process.exit(1);
  },
);
