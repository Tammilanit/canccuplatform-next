/** The screen module's Fastify app: health, tenancy, and the device and pairing routes. */
import Fastify from "fastify";
import type { FastifyInstance, FastifyServerOptions } from "fastify";
import { createHealth, postgresCheck, valkeyCheck } from "@canccu/kit";
import type { Bus, Health, Logger, RightsChecker, StreamStore, TenantResolver } from "@canccu/kit";
import { install, installTenancy } from "@canccu/kit/fastify";
import type { Audit } from "./audit.js";
import type { Db } from "./db.js";
import { deviceRoutes } from "./devices.js";
import type { Kv } from "./kv.js";
import { pairingRoutes } from "./pairing.js";

export interface ScreenDeps {
  db: Db;
  kv: Kv;
  bus: Bus;
  rights: RightsChecker;
  audit: Audit;
  log?: Logger;
  tenants: TenantResolver;
  health: Health;
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
  return app;
}
