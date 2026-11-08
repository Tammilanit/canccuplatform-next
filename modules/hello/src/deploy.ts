/**
 * The `deploy` health check: setup/deploy (the host's auto-deploy) writes each run's result to a
 * status file that the stack mounts read-only into hello, so a deploy that keeps failing while
 * the old containers keep serving shows in /api/hello/health (issue #197).
 */
import { readFile } from "node:fs/promises";
import type { CheckFn, CheckResult } from "@canccu/kit";

/** One failure can be a blip (a registry hiccup); two runs in a row is a deploy that fails. */
const FAILING_AFTER = 2;

interface DeployStatus {
  time: string;
  commit: string;
  result: "ok" | "failed";
  error: string;
  failures: number;
  failing_since: string;
}

function parse(text: string): DeployStatus {
  const s = JSON.parse(text) as Partial<DeployStatus> | null;
  const fieldsOk =
    s !== null &&
    typeof s === "object" &&
    typeof s.time === "string" &&
    typeof s.commit === "string" &&
    (s.result === "ok" || s.result === "failed") &&
    typeof s.error === "string" &&
    typeof s.failures === "number" &&
    typeof s.failing_since === "string";
  if (!fieldsOk) throw new Error("not the shape setup/deploy writes");
  return s as DeployStatus;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Never `down`: a failing deploy leaves the old version serving, which must stay reachable. */
export function deployCheck(file: string): CheckFn {
  return async (): Promise<CheckResult> => {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "ok", detail: "no auto-deploy on this host" };
      }
      return { status: "degraded", detail: `cannot read the deploy status: ${message(err)}` };
    }
    let s: DeployStatus;
    try {
      s = parse(text);
    } catch (err) {
      return { status: "degraded", detail: `cannot read the deploy status: ${message(err)}` };
    }
    const commit = s.commit.slice(0, 7) || "unknown commit";
    if (s.result === "failed" && s.failures >= FAILING_AFTER) {
      return {
        status: "degraded",
        detail: `failing since ${s.failing_since} (${s.failures} runs in a row): ${s.error}; ${commit} still runs`,
      };
    }
    const last = s.result === "ok" ? `ok at ${s.time}` : `failed at ${s.time}: ${s.error}`;
    return { status: "ok", detail: `${commit} deployed; last run ${last}` };
  };
}
