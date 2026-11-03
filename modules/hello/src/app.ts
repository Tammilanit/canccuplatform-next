/** The hello test module: a Fastify app that serves the shared /health, nothing else. */
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createHealth, postgresCheck, valkeyCheck } from "@cp/kit";
import type { CheckFn, Health, StreamStore } from "@cp/kit";
import { install } from "@cp/kit/fastify";

export interface HelloDeps {
  module: string;
  version: string;
  store: StreamStore;
  /** Runs `SELECT 1` against Postgres. */
  query: () => Promise<unknown>;
}

/** Both checks are essential: either one down makes the module down (503). */
export function helloHealth(deps: HelloDeps, timeoutMs?: number): Health {
  const checks: Record<string, CheckFn> = {
    valkey: valkeyCheck(deps.store),
    postgres: postgresCheck(deps.query),
  };
  return createHealth({
    module: deps.module,
    version: deps.version,
    checks,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

export function buildApp(health: Health): FastifyInstance {
  const app = Fastify({ logger: false });
  install(app, { health });
  return app;
}
