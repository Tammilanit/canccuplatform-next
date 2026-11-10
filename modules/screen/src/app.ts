/**
 * The screen module's Fastify app: health, tenancy, and the device, pairing, heartbeat, zone,
 * assignment, playlist, schedule and push routes.
 */
import Fastify from "fastify";
import type { FastifyInstance, FastifyServerOptions } from "fastify";
import { createHealth, postgresCheck, valkeyCheck } from "@canccu/kit";
import type { Bus, Health, Logger, RightsChecker, StreamStore, TenantResolver } from "@canccu/kit";
import { install, installTenancy } from "@canccu/kit/fastify";
import type { Audit } from "./audit.js";
import type { Db } from "./db.js";
import { assignmentRoutes } from "./assignments.js";
import { deviceRoutes } from "./devices.js";
import type { Settings } from "./health.js";
import { heartbeatRoutes } from "./heartbeat.js";
import type { Kv } from "./kv.js";
import { pairingRoutes } from "./pairing.js";
import { playlistRoutes } from "./content/playlists.js";
import { pushRoutes } from "./content/push.js";
import { scheduleRoutes } from "./content/schedules.js";
import type { AssetReader } from "./tick/content.js";
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
  /** What simulate knows of assets; the assets slice (#217) supplies it. */
  assets?: AssetReader;
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
    checks: { valkey: valkeyCheck(opts.store), postgres: postgresCheck(opts.query) },
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
  playlistRoutes(app, deps);
  scheduleRoutes(app, deps);
  pushRoutes(app, deps);
  return app;
}
