/**
 * The screen module's Fastify app: health, tenancy, and the device, pairing, heartbeat, moving,
 * registry, zone, assignment, playlist, schedule, push, asset, ticker, photo and render-job routes,
 * and the composed state.
 */
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import type { FastifyInstance, FastifyServerOptions } from "fastify";
import { FILES_ROOT, createHealth, postgresCheck } from "@canccu/kit";
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
import { composeRoutes } from "./compose/routes.js";
import { noSources } from "./compose/sources.js";
import type { Sources } from "./compose/sources.js";
import { deviceRoutes } from "./devices.js";
import type { Settings } from "./health.js";
import { heartbeatRoutes } from "./heartbeat.js";
import type { Kv } from "./kv.js";
import { notFound } from "./http.js";
import { movingRoutes } from "./moving.js";
import { pairingRoutes } from "./pairing.js";
import { photoRoutes } from "./photos.js";
import { PushHub } from "./push/hub.js";
import { streamRoutes } from "./push/routes.js";
import { MemoryFanout, MemoryZoneStore } from "./push/store.js";
import type { Fanout, ZoneStore } from "./push/store.js";
import { playlistRoutes } from "./content/playlists.js";
import { pushRoutes } from "./content/push.js";
import { scheduleRoutes } from "./content/schedules.js";
import type { RenderQueue } from "./render/queue.js";
import { REGISTRY_PREFIX, onSuperadminHost, registryRoutes } from "./registry.js";
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
  /** The agenda, tenants and theming reads behind the composed state; none in tests. */
  sources?: Sources;
  /** The platform version, the bundle `/screen/` loads unless pinned. */
  bundleVersion?: string;
  /** The zones' states and the fan-out between containers; main gives the Valkey ones. */
  push?: { zones: ZoneStore; fanout: Fanout };
  /** How often an open stream pings (15 s); tests shorten it. */
  streamPingMs?: number;
}

declare module "fastify" {
  interface FastifyInstance {
    /** This container's open push streams; main feeds it the bus. */
    pushHub: PushHub;
  }
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

/**
 * Under the kit's 2 s per check, so a ping that hangs (a lost streams connection queues it offline
 * and never rejects) is named here instead of the whole check timing out unnamed.
 */
const PING_TIMEOUT_MS = 1500;

function answersWithin(ping: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`no answer within ${ms / 1000} s`));
    }, ms);
  });
  return Promise.race([ping, late]).finally(() => {
    clearTimeout(timer);
  });
}

export function screenHealth(opts: {
  module: string;
  version: string;
  store: StreamStore;
  kv: Kv;
  query: () => Promise<unknown>;
  renderQueue: RenderQueue;
}): Health {
  return createHealth({
    module: opts.module,
    version: opts.version,
    checks: {
      // Pairing, commands and device health run on the key-value connection, not the streams'
      // one: either lost is Valkey down for this module. Both at once, so one slow connection
      // does not eat the other's time, and the detail names the one that failed.
      valkey: async () => {
        const [kv, bus] = await Promise.allSettled([
          answersWithin(opts.kv.ping(), PING_TIMEOUT_MS),
          answersWithin(opts.store.ping(), PING_TIMEOUT_MS),
        ]);
        const lost = (name: string, result: PromiseSettledResult<unknown>): string[] =>
          result.status === "rejected"
            ? [
                `${name} connection: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
              ]
            : [];
        const failed = [...lost("key-value", kv), ...lost("streams", bus)];
        if (failed.length > 0) throw new Error(failed.join("; "));
        return { status: "ok" };
      },
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
    // The registry off its hostname is 404 here, before the body is parsed, so no body can make
    // it answer anything an unknown route would not.
    const hidden = path.startsWith(REGISTRY_PREFIX)
      ? !onSuperadminHost(deps.superadminHost, request.headers.host)
      : request.tenant === null && path !== "/health";
    if (hidden) throw notFound();
    await Promise.resolve();
  });
  app.decorateRequest("device", null);
  app.decorateRequest("deviceToken", null);
  const fanout = deps.push?.fanout ?? new MemoryFanout();
  const zones = deps.push?.zones ?? new MemoryZoneStore(fanout, deps.now);
  const compose = {
    ...deps,
    fanout,
    zones,
    sources: deps.sources ?? noSources,
    bundleVersion: deps.bundleVersion ?? "dev",
  };
  const push = {
    ...compose,
    contextOf: async (host: string) => {
      const found = await deps.tenants.resolve(host);
      return found.kind === "tenant" ? found.context : null;
    },
  };
  const hub = new PushHub(push);
  app.decorate("pushHub", hub);
  pairingRoutes(app, deps);
  deviceRoutes(app, compose);
  heartbeatRoutes(app, deps);
  movingRoutes(app, deps);
  registryRoutes(app, deps);
  zoneRoutes(app, deps);
  assignmentRoutes(app, compose);
  playlistRoutes(app, deps);
  scheduleRoutes(app, deps);
  pushRoutes(app, deps);
  tickerRoutes(app, deps);
  composeRoutes(app, compose);
  streamRoutes(app, { ...push, hub });
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
