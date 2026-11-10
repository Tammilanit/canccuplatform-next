/**
 * The screen module's Fastify app: health, tenancy, and the device, pairing, heartbeat, moving,
 * registry, zone, assignment, playlist, schedule, push, asset, ticker, photo and render-job routes.
 */
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import type { FastifyInstance, FastifyServerOptions } from "fastify";
import { FILES_ROOT, createHealth, postgresCheck, valkeyCheck } from "@canccu/kit";
import type {
  Bus,
  CheckFn,
  Health,
  Logger,
  RightsChecker,
  StreamStore,
  TenantResolver,
} from "@canccu/kit";
import { install, installTenancy } from "@canccu/kit/fastify";
import type { Audit } from "./audit.js";
import type { Db } from "./db.js";
import { ffprobe } from "./assets/probe.js";
import type { Ffprobe } from "./assets/probe.js";
import { assetRoutes } from "./assets/routes.js";
import { fileRoutes } from "./assets/serve.js";
import type { StorageQuota } from "./assets/storage.js";
import { MAX_UPLOAD_BYTES } from "./assets/upload.js";
import { versionRoutes } from "./assets/versions.js";
import { assignmentRoutes } from "./assignments.js";
import { deviceRoutes } from "./devices.js";
import type { Settings } from "./health.js";
import { heartbeatRoutes } from "./heartbeat.js";
import type { Kv } from "./kv.js";
import { notFound } from "./http.js";
import { movingRoutes } from "./moving.js";
import { pairingRoutes } from "./pairing.js";
import { photoRoutes } from "./photos.js";
import { playlistRoutes } from "./content/playlists.js";
import { pushRoutes } from "./content/push.js";
import { scheduleRoutes } from "./content/schedules.js";
import type { RenderQueue } from "./render/queue.js";
import { REGISTRY_PREFIX, registryRoutes } from "./registry.js";
import { renderRoutes } from "./render/routes.js";
import { tickerRoutes } from "./ticker/routes.js";
import { zoneRoutes } from "./zones.js";

export interface ScreenDeps {
  db: Db;
  kv: Kv;
  bus: Bus;
  rights: RightsChecker;
  audit: Audit;
  log?: Logger;
  tenants: TenantResolver;
  /** `CANCCU_SUPERADMIN_HOSTNAME`, the one host the device registry answers on. */
  superadminHost?: string;
  health: Health;
  settings: Settings;
  storage: StorageQuota;
  /** The shared files volume; tests point it at a temporary directory. */
  filesRoot?: string;
  ffprobe?: Ffprobe;
  /** For the YouTube oEmbed probe. */
  fetch?: typeof fetch;
  /** The fair render queue; main gives the Valkey one. */
  renderQueue: RenderQueue;
  now?: () => number;
}

/** How long a deck may wait for the renderer before health says `degraded` (contracts/screen.md, Health). */
const RENDER_WAIT_MS = 10 * 60_000;

/** `render`: degraded while any event's deck has waited over 10 minutes. */
export function renderCheck(queue: RenderQueue, now: () => number = Date.now): CheckFn {
  return async () => {
    const oldest = await queue.oldestWaiting();
    if (oldest === null || now() - oldest <= RENDER_WAIT_MS) return { status: "ok" };
    const minutes = Math.floor((now() - oldest) / 60_000);
    return { status: "degraded", detail: `a deck has waited ${minutes} minutes for the renderer` };
  };
}

export function screenHealth(opts: {
  module: string;
  version: string;
  store: StreamStore;
  query: () => Promise<unknown>;
  renderQueue: RenderQueue;
}): Health {
  return createHealth({
    module: opts.module,
    version: opts.version,
    checks: {
      valkey: valkeyCheck(opts.store),
      postgres: postgresCheck(opts.query),
      // Readability only, as theming checks it: the shared volume is owned by root on today's
      // stack, and making it writable for uploads is deploy work (#241). A write check here
      // would mark the whole module down for a volume every read still works on.
      files: async () => {
        await access(FILES_ROOT, constants.R_OK | constants.X_OK);
        return { status: "ok" };
      },
      render: { run: renderCheck(opts.renderQueue), essential: false },
    },
  });
}

export function buildApp(deps: ScreenDeps): FastifyInstance {
  // One trusted hop, Caddy: request.ip is the address Caddy appended, never one a client sent.
  // The venue check depends on it (packages/kit-ts README, Access).
  const options: FastifyServerOptions = {
    logger: false,
    trustProxy: (_address: string, hop: number) => hop === 0,
  };
  const app = Fastify(options);
  install(app, { health: deps.health });
  // The platform hostnames are served for the registry alone; every other route needs an event.
  installTenancy(app, deps.tenants, { platformHosts: "serve" });
  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0] ?? "";
    if (request.tenant === null && path !== "/health" && !path.startsWith(REGISTRY_PREFIX)) {
      throw notFound();
    }
    await Promise.resolve();
  });
  app.decorateRequest("device", null);
  app.decorateRequest("deviceToken", null);
  pairingRoutes(app, deps);
  deviceRoutes(app, deps);
  heartbeatRoutes(app, deps);
  movingRoutes(app, deps);
  registryRoutes(app, deps);
  zoneRoutes(app, deps);
  assignmentRoutes(app, deps);
  playlistRoutes(app, deps);
  scheduleRoutes(app, deps);
  pushRoutes(app, deps);
  tickerRoutes(app, deps);
  void app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, fieldSize: 1024, parts: 5 },
  });
  const assets = {
    ...deps,
    filesRoot: deps.filesRoot ?? FILES_ROOT,
    ffprobe: deps.ffprobe ?? ffprobe(),
    fetch: deps.fetch ?? fetch,
    queue: deps.renderQueue,
    now: deps.now ?? Date.now,
  };
  assetRoutes(app, assets);
  versionRoutes(app, assets);
  fileRoutes(app, assets);
  photoRoutes(app, assets);
  renderRoutes(app, assets);
  return app;
}
