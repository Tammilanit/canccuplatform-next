/** The screen module's Fastify app: health, tenancy, and the device, pairing, heartbeat, zone, assignment and asset routes. */
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import type { FastifyInstance, FastifyServerOptions } from "fastify";
import { FILES_ROOT, createHealth, postgresCheck, valkeyCheck } from "@canccu/kit";
import type { Bus, Health, Logger, RightsChecker, StreamStore, TenantResolver } from "@canccu/kit";
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
import { pairingRoutes } from "./pairing.js";
import { zoneRoutes } from "./zones.js";

export interface ScreenDeps {
  db: Db;
  kv: Kv;
  bus: Bus;
  rights: RightsChecker;
  audit: Audit;
  log?: Logger;
  tenants: TenantResolver;
  health: Health;
  settings: Settings;
  storage: StorageQuota;
  /** The shared files volume; tests point it at a temporary directory. */
  filesRoot?: string;
  ffprobe?: Ffprobe;
  /** For the YouTube oEmbed probe. */
  fetch?: typeof fetch;
  now?: () => number;
}

export function screenHealth(opts: {
  module: string;
  version: string;
  store: StreamStore;
  query: () => Promise<unknown>;
}): Health {
  return createHealth({
    module: opts.module,
    version: opts.version,
    checks: {
      valkey: valkeyCheck(opts.store),
      postgres: postgresCheck(opts.query),
      files: async () => {
        await access(FILES_ROOT, constants.W_OK);
        return { status: "ok" };
      },
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
  installTenancy(app, deps.tenants);
  app.decorateRequest("device", null);
  pairingRoutes(app, deps);
  deviceRoutes(app, deps);
  heartbeatRoutes(app, deps);
  zoneRoutes(app, deps);
  assignmentRoutes(app, deps);
  void app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, fieldSize: 1024, parts: 5 },
  });
  const assets = {
    ...deps,
    filesRoot: deps.filesRoot ?? FILES_ROOT,
    ffprobe: deps.ffprobe ?? ffprobe(),
    fetch: deps.fetch ?? fetch,
  };
  assetRoutes(app, assets);
  versionRoutes(app, assets);
  fileRoutes(app, assets);
  return app;
}
