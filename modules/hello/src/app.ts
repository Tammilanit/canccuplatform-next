/** The hello test module: a Fastify app that serves the shared /health, nothing else. */
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createHealth, postgresCheck, valkeyCheck } from "@canccu/kit";
import type { Check, CheckFn, Health, StreamStore } from "@canccu/kit";
import { install } from "@canccu/kit/fastify";
import { deployCheck } from "./deploy.js";

export interface HelloDeps {
  module: string;
  version: string;
  store: StreamStore;
  /** Runs `SELECT 1` against Postgres. */
  query: () => Promise<unknown>;
  /** The auto-deploy's status file (CANCCU_DEPLOY_STATUS_FILE); without it, no `deploy` check. */
  deployStatusFile?: string;
}

/**
 * Valkey and Postgres are essential: either one down makes the module down (503). The deploy
 * check is not: a failing deploy makes hello degraded (200), so the old version keeps passing
 * the deploy's and Docker's health checks.
 */
export function helloHealth(deps: HelloDeps, timeoutMs?: number): Health {
  const checks: Record<string, Check | CheckFn> = {
    valkey: valkeyCheck(deps.store),
    postgres: postgresCheck(deps.query),
  };
  if (deps.deployStatusFile !== undefined) {
    checks.deploy = { run: deployCheck(deps.deployStatusFile), essential: false };
  }
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
