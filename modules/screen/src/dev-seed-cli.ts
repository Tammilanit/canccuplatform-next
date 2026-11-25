/**
 * `docker compose exec screen node dist/dev-seed-cli.js [--force]`: the dev server's demo screen
 * content (dev-seed.ts). Refused before anything connects outside dev mode.
 *
 * It builds a Screen app of its own with the routes the seed writes through (assets, photos,
 * playlists, schedules, the ticker), wired as main.ts wires them, and injects its requests on the
 * demo event's primary hostname; no port is opened. The requests carry a session of the seed's
 * own, which only this process's rights checker knows, with only the rights those writes need.
 */
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { Valkey } from "iovalkey";
import pg from "pg";
import {
  AdminClient,
  Bus,
  DEMO_TENANT,
  FILES_ROOT,
  RightsChecker,
  ServiceIdentity,
  SettingsClient,
  TenantResolver,
  ValkeyStreamStore,
  createLogger,
  loadConfig,
  serviceKeyFromEnv,
  tailscaleCidrs,
  tenantsStorage,
  withTenant,
} from "@canccu/kit";
import { install, installTenancy } from "@canccu/kit/fastify";
import { ffprobe } from "./assets/probe.js";
import { assetRoutes } from "./assets/routes.js";
import { MAX_UPLOAD_BYTES } from "./assets/upload.js";
import { tenantsAudit } from "./audit.js";
import { playlistRoutes } from "./content/playlists.js";
import { scheduleRoutes } from "./content/schedules.js";
import { poolDb } from "./db.js";
import { Refused, seedDemoScreen } from "./dev-seed.js";
import { injectApi } from "./dev-seed-api.js";
import { photoRoutes } from "./photos.js";
import { ValkeyRenderQueue } from "./render/queue.js";
import { tickerRoutes } from "./ticker/routes.js";
import { seedMainZone } from "./zones.js";

const SESSION = "dev-seed";
const RIGHTS = [
  "screen.content.read",
  "screen.content.write",
  "screen.photos.write",
  "screen.ticker.write",
];

/** Admin's session answer for the seed's own session; any other is not signed in. */
const seedSession: typeof fetch = (_url, init) => {
  const cookie = (init?.headers as Record<string, string> | undefined)?.cookie ?? "";
  if (cookie !== `canccu_session=${SESSION}`)
    return Promise.resolve(
      Response.json({ error: { code: "not_signed_in", message: "sign in" } }, { status: 401 }),
    );
  return Promise.resolve(
    Response.json({
      user: { id: "u_demo_seed", name: "Demo seed" },
      rights: RIGHTS,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      superadmin: false,
    }),
  );
};

/** An address of the first Tailscale prefix: admin pages' address rule lets it in. */
function tailnetAddress(): string {
  const [base = "100.64.0.0"] = (tailscaleCidrs()[0] ?? "100.64.0.0/10").split("/");
  if (base.includes(":")) return base.endsWith("::") ? `${base}1` : base;
  const octets = base.split(".").map(Number);
  octets[3] = (octets[3] ?? 0) + 1;
  return octets.join(".");
}

async function run(force: boolean): Promise<string[]> {
  const config = loadConfig();
  if (config.version !== "dev")
    throw new Refused(`CANCCU_VERSION is ${config.version}, not dev: nothing changed`);
  const missing = ["CANCCU_DATABASE_URL", "CANCCU_TENANTS_URL"].filter((n) => !process.env[n]);
  if (missing.length > 0) throw new Error(`missing environment variable(s): ${missing.join(", ")}`);
  const tenantsUrl = process.env.CANCCU_TENANTS_URL ?? "";
  const service = new ServiceIdentity({ module: config.module, key: serviceKeyFromEnv() });
  const tenants = new TenantResolver({ tenantsUrl, service });
  const event = await tenants.byId(DEMO_TENANT);
  if (event === null) throw new Refused("there is no demo event: nothing changed");
  if (event.primary_hostname === null)
    throw new Refused("the demo event has no hostname: nothing changed");
  const log = createLogger(config.module);
  const pool = new pg.Pool({ connectionString: process.env.CANCCU_DATABASE_URL });
  const queueClient = new Valkey(config.valkeyUrl, { maxRetriesPerRequest: 2 });
  queueClient.on("error", () => undefined);
  const db = poolDb(pool);
  const bus = new Bus(ValkeyStreamStore.fromUrl(config.valkeyUrl), config.module, log);
  const rights = new RightsChecker(new AdminClient("http://dev-seed", { fetch: seedSession }));
  const audit = tenantsAudit(tenantsUrl, service);
  const settings = new SettingsClient(new AdminClient(config.adminUrl), config.module, {
    service,
  });
  // As main.ts: one trusted hop, so the request's address is the one the seed gives.
  const app = Fastify({ logger: false, trustProxy: (_address: string, hop: number) => hop === 0 });
  install(app);
  installTenancy(app, tenants);
  void app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, fieldSize: 1024, parts: 5 },
  });
  const content = { db, bus, rights, audit, settings, now: Date.now };
  const assets = {
    ...content,
    log,
    storage: tenantsStorage(tenantsUrl, service),
    filesRoot: FILES_ROOT,
    ffprobe: ffprobe(),
    fetch,
    queue: new ValkeyRenderQueue(queueClient),
  };
  assetRoutes(app, assets);
  photoRoutes(app, assets);
  playlistRoutes(app, content);
  scheduleRoutes(app, content);
  tickerRoutes(app, content);
  try {
    await app.ready();
    // The zone a new event starts with, which the demo loop is scheduled in.
    await withTenant(DEMO_TENANT, seedMainZone(db, bus));
    return await seedDemoScreen(
      injectApi(app, {
        host: event.primary_hostname,
        cookie: `canccu_session=${SESSION}`,
        ip: tailnetAddress(),
      }),
      {
        version: config.version,
        media: process.env.CANCCU_DEMO_MEDIA_DIR ?? "/repo/events/demo/media",
        filesRoot: FILES_ROOT,
        tenant: DEMO_TENANT,
        now: () => new Date(),
        force,
      },
    );
  } finally {
    await app.close();
    await pool.end();
    queueClient.disconnect();
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
    // The Valkey connections would keep the process alive.
    process.exit(0);
  },
  (err: unknown) => {
    const refused = err instanceof Refused;
    process.stderr.write(`${refused ? "refused: " : "error: "}${(err as Error).message}\n`);
    process.exit(1);
  },
);
