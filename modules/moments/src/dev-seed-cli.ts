/**
 * `docker compose exec moments node dist/dev-seed-cli.js [--force]`: the dev server's demo
 * Moments (dev-seed.ts) and its announcements (dev-seed-announce.ts). Refused before anything
 * connects outside dev mode.
 */
import pg from "pg";
import {
  DEMO_TENANT,
  ServiceIdentity,
  TenantResolver,
  loadConfig,
  serviceKeyFromEnv,
} from "@canccu/kit";
import { httpAgenda } from "./agenda.js";
import { poolDb } from "./db.js";
import { Refused, seedDemoMoments } from "./dev-seed.js";
import { seedDemoAnnouncements } from "./dev-seed-announce.js";

/** The demo profile's name (events/demo/profile.yaml); no text of the seed's names the event. */
const EVENT_NAME = "Demo Event";

async function run(force: boolean): Promise<string> {
  const config = loadConfig();
  if (config.version !== "dev")
    throw new Refused(`CANCCU_VERSION is ${config.version}, not dev: nothing changed`);
  const missing = ["CANCCU_DATABASE_URL", "CANCCU_AGENDA_URL", "CANCCU_TENANTS_URL"].filter(
    (n) => !process.env[n],
  );
  if (missing.length > 0) throw new Error(`missing environment variable(s): ${missing.join(", ")}`);
  const service = new ServiceIdentity({ module: config.module, key: serviceKeyFromEnv() });
  const agenda = await httpAgenda(process.env.CANCCU_AGENDA_URL ?? "", service)(DEMO_TENANT);
  if (agenda === null) throw new Error("the agenda module did not answer");
  const tenants = new TenantResolver({ tenantsUrl: process.env.CANCCU_TENANTS_URL ?? "", service });
  const event = await tenants.byId(DEMO_TENANT);
  if (event === null) throw new Refused("there is no demo event: nothing changed");
  const pool = new pg.Pool({ connectionString: process.env.CANCCU_DATABASE_URL });
  try {
    const deps = { db: poolDb(pool), now: () => new Date() };
    const stories = await seedDemoMoments(deps, {
      version: config.version,
      items: agenda.items,
      force,
    });
    const announced = await seedDemoAnnouncements(deps, {
      version: config.version,
      items: agenda.items,
      timeZone: event.time_zone,
      eventName: EVENT_NAME,
      force,
    });
    return `${stories}\n${announced}`;
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
    process.stdout.write(said + "\n");
  },
  (err: unknown) => {
    const refused = err instanceof Refused;
    process.stderr.write(`${refused ? "refused: " : "error: "}${(err as Error).message}\n`);
    process.exitCode = 1;
  },
);
