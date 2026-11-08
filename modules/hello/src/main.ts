/** Start hello: read the kit config, connect to Valkey and Postgres, serve /health. */
import pg from "pg";
import { ValkeyStreamStore, createLogger, loadConfig } from "@canccu/kit";
import { buildApp, helloHealth } from "./app.js";

const PORT = 8080;

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.module);
  const databaseUrl = process.env.CANCCU_DATABASE_URL;
  if (!databaseUrl) throw new Error("missing environment variable(s): CANCCU_DATABASE_URL");

  const deployStatusFile = process.env.CANCCU_DEPLOY_STATUS_FILE;
  const store = ValkeyStreamStore.fromUrl(config.valkeyUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 1500 });
  pool.on("error", (err) => {
    log.warn({ err }, "postgres connection lost");
  });

  const app = buildApp(
    helloHealth({
      module: config.module,
      version: config.version,
      store,
      query: () => pool.query("SELECT 1"),
      ...(deployStatusFile ? { deployStatusFile } : {}),
    }),
  );
  await app.listen({ host: "0.0.0.0", port: PORT });
  log.info({ port: PORT, version: config.version }, "hello started");

  const stop = async (): Promise<void> => {
    await app.close();
    // A dependency that is down may never answer quit/end; do not let it hold the exit.
    const grace = new Promise((resolve) => setTimeout(resolve, 2000).unref());
    await Promise.race([Promise.allSettled([store.close(), pool.end()]), grace]);
    process.exit(0);
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  process.exit(1);
});
