/** The theming module's Fastify app: health, tenancy, the theme, its draft and history, the served files and the sandbox. */
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import Fastify from "fastify";
import type { FastifyInstance, FastifyServerOptions } from "fastify";
import { createHealth, postgresCheck, valkeyCheck } from "@canccu/kit";
import type {
  Bus,
  CheckFn,
  Health,
  RightsChecker,
  ServiceIdentity,
  StreamStore,
  TenantResolver,
} from "@canccu/kit";
import { install, installServiceIdentity, installTenancy } from "@canccu/kit/fastify";
import type { Audit } from "./audit.js";
import type { Db } from "./db.js";
import { draftRoutes } from "./draft-routes.js";
import type { FileStore } from "./files.js";
import { internalRoutes, revisionRoutes } from "./revision-routes.js";
import { themeRoutes } from "./routes.js";
import { sandboxGuard, sandboxRoutes } from "./sandbox.js";
import type { ProfileSource } from "./profile.js";

export interface ThemingDeps {
  db: Db;
  files: FileStore;
  profile: ProfileSource;
  rights: RightsChecker;
  tenants: TenantResolver;
  bus: Bus;
  audit: Audit;
  /** Verifies the modules that call /internal/theming/. */
  service: ServiceIdentity;
  health: Health;
  /** The IP-mode demo stack (contracts/theming.md, The sandbox). */
  ipMode: boolean;
}

/** The files volume holds every revision's files, and publishing writes the generated ones there. */
export function filesCheck(root: string): CheckFn {
  return async () => {
    try {
      await access(root, constants.R_OK | constants.W_OK | constants.X_OK);
      return { status: "ok" };
    } catch {
      return { status: "down", detail: "the files volume is not readable and writable" };
    }
  };
}

export function themingHealth(opts: {
  module: string;
  version: string;
  store: StreamStore;
  query: () => Promise<unknown>;
  filesRoot: string;
}): Health {
  return createHealth({
    module: opts.module,
    version: opts.version,
    checks: {
      valkey: valkeyCheck(opts.store),
      postgres: postgresCheck(opts.query),
      files: filesCheck(opts.filesRoot),
    },
  });
}

export function buildApp(deps: ThemingDeps): FastifyInstance {
  // One trusted hop, Caddy: request.ip is the address Caddy appended, never one a client sent.
  // The info-page and admin address checks depend on it.
  const options: FastifyServerOptions = {
    logger: false,
    trustProxy: (_address: string, hop: number) => hop === 0,
  };
  const app = Fastify(options);
  install(app, { health: deps.health });
  // At the root, so the sandbox's own 404s (no route matched) keep its headers too.
  sandboxGuard(app);
  // Internal paths name their tenant in `tenant_id`: the Host is the module's own, never an event's.
  void app.register((internal, _opts, done) => {
    installServiceIdentity(internal, deps.service);
    internalRoutes(internal, deps);
    done();
  });
  void app.register((event, _opts, done) => {
    installTenancy(event, deps.tenants);
    themeRoutes(event, deps);
    draftRoutes(event, deps);
    revisionRoutes(event, deps);
    sandboxRoutes(event, deps);
    done();
  });
  return app;
}
