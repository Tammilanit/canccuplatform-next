/** The shared /health shape (contracts/admin.md, Health). */
import { utcNowIso } from "./log.js";
import type { StreamStore } from "./store.js";

export type HealthStatus = "ok" | "degraded" | "down";

export interface CheckResult {
  status: HealthStatus;
  detail?: string;
}

export type CheckFn = () => Promise<CheckResult>;

export interface Check {
  run: CheckFn;
  /** When an essential check is down the module is down; otherwise it is degraded. Default true. */
  essential?: boolean;
}

export interface HealthBody {
  status: HealthStatus;
  module: string;
  version: string;
  time: string;
  checks: Record<string, CheckResult>;
}

export interface HealthResult {
  httpStatus: 200 | 503;
  body: HealthBody;
}

export interface Health {
  run(): Promise<HealthResult>;
}

async function runOne(check: Check, timeoutMs: number): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ status: "down", detail: `no answer within ${timeoutMs / 1000} s` });
    }, timeoutMs);
  });
  try {
    return await Promise.race([check.run(), timeout]);
  } catch (err) {
    return {
      status: "down",
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createHealth(options: {
  module: string;
  version: string;
  checks?: Record<string, Check | CheckFn>;
  timeoutMs?: number;
}): Health {
  const timeoutMs = options.timeoutMs ?? 2000;
  const named = Object.entries(options.checks ?? {}).map(([name, c]): [string, Check] => [
    name,
    typeof c === "function" ? { run: c } : c,
  ]);
  return {
    async run() {
      const results = await Promise.all(named.map(([, c]) => runOne(c, timeoutMs)));
      const levels: HealthStatus[] = named.map(([, check], i): HealthStatus => {
        const r = results[i];
        if (r === undefined || r.status === "ok") return "ok";
        return r.status === "down" && check.essential !== false ? "down" : "degraded";
      });
      const status: HealthStatus = levels.includes("down")
        ? "down"
        : levels.includes("degraded")
          ? "degraded"
          : "ok";
      const checks: Record<string, CheckResult> = {};
      named.forEach(([name], i) => {
        const r = results[i];
        if (r !== undefined) checks[name] = r;
      });
      return {
        httpStatus: status === "down" ? 503 : 200,
        body: {
          status,
          module: options.module,
          version: options.version,
          time: utcNowIso(),
          checks,
        },
      };
    },
  };
}

export function valkeyCheck(store: StreamStore): CheckFn {
  return async () => {
    await store.ping();
    return { status: "ok" };
  };
}

/** `query` runs e.g. `SELECT 1` with the module's own driver. */
export function postgresCheck(query: () => Promise<unknown>): CheckFn {
  return async () => {
    await query();
    return { status: "ok" };
  };
}
