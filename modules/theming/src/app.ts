/** The theming module's Fastify app: health, tenancy, the current theme, the served files and the sandbox. */
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import Fastify from "fastify";
import type { FastifyInstance, FastifyServerOptions } from "fastify";
import { createHealth, postgresCheck, valkeyCheck } from "@canccu/kit";
import type { CheckFn, Health, RightsChecker, StreamStore, TenantResolver } from "@canccu/kit";
import { install, installTenancy } from "@canccu/kit/fastify";
import type { Db } from "./db.js";
import type { FileStore } from "./files.js";
import { themeRoutes } from "./routes.js";
import { sandboxRoutes } from "./sandbox.js";
import type { ProfileSource } from "./profile.js";

export interface ThemingDeps {
  db: Db;
  files: FileStore;
  profile: ProfileSource;
  rights: RightsChecker;
  tenants: TenantResolver;
  health: Health;
  /** The IP-mode demo stack (contracts/theming.md, The sandbox). */
  ipMode: boolean;
}

/**
 * The files volume holds every revision's files, so without it no theme file can be served. Only
 * readability is checked: this slice writes nothing at run time, and the shared volume is owned by
 * root on today's stack (making it writable comes with publishing, #241).
 */
export function filesCheck(root: string): CheckFn {
  return async () => {
    try {
      await access(root, constants.R_OK | constants.X_OK);
      return { status: "ok" };
    } catch {
      return { status: "down", detail: "the files volume is not readable" };
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
  installTenancy(app, deps.tenants);
  themeRoutes(app, deps);
  sandboxRoutes(app, deps);
  return app;
}
