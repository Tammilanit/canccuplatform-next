/**
 * `docker compose exec moments node dist/dev-seed-cli.js [--force]`: the dev server's demo
 * Moments (dev-seed.ts). Refused before anything connects outside dev mode.
 */
import pg from "pg";
import { DEMO_TENANT, ServiceIdentity, loadConfig, serviceKeyFromEnv } from "@canccu/kit";
import { httpAgenda } from "./agenda.js";
import { poolDb } from "./db.js";
import { Refused, seedDemoMoments } from "./dev-seed.js";

async function run(force: boolean): Promise<string> {
  const config = loadConfig();
  if (config.version !== "dev")
    throw new Refused(`CANCCU_VERSION is ${config.version}, not dev: nothing changed`);
  const missing = ["CANCCU_DATABASE_URL", "CANCCU_AGENDA_URL"].filter((n) => !process.env[n]);
  if (missing.length > 0) throw new Error(`missing environment variable(s): ${missing.join(", ")}`);
  const service = new ServiceIdentity({ module: config.module, key: serviceKeyFromEnv() });
  const agenda = await httpAgenda(process.env.CANCCU_AGENDA_URL ?? "", service)(DEMO_TENANT);
  if (agenda === null) throw new Error("the agenda module did not answer");
  const pool = new pg.Pool({ connectionString: process.env.CANCCU_DATABASE_URL });
  try {
    return await seedDemoMoments(
      { db: poolDb(pool), now: () => new Date() },
      { version: config.version, items: agenda.items, force },
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
    process.stdout.write(said + "\n");
  },
  (err: unknown) => {
    const refused = err instanceof Refused;
    process.stderr.write(`${refused ? "refused: " : "error: "}${(err as Error).message}\n`);
    process.exitCode = 1;
  },
);
