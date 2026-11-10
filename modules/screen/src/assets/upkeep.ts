/**
 * The storage upkeep (contracts/tenants.md, Storage quota, Repair): once a period per event, in
 * one container, screen removes the files nothing refers to and the scratch of render attempts
 * that ended, then sets its count at tenants to what its files take. A crash between a reserve
 * and its release, or a cleanup that failed, so lasts at most one period.
 */
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { lockCount, tenantFile, tenantKey, tenantsWithFiles, withTenant } from "@canccu/kit";
import type { Logger, StorageQuota } from "@canccu/kit";
import type { Db } from "../db.js";
import type { Kv } from "../kv.js";
import { lockFiles } from "./files.js";

export const UPKEEP_MS = 3_600_000;
/** A stored file's name (files.ts, place): its sha256 and its extension. */
const STORED_NAME = /^[0-9a-f]{64}\.[a-z0-9]+$/;
/** A render attempt's scratch (render/jobs.ts, attemptDir). */
const ATTEMPT_DIR = /^render-(.+)-(\d+)$/;

export interface UpkeepDeps {
  db: Db;
  storage: StorageQuota;
  filesRoot: string;
  log?: Logger;
}

/**
 * Sets screen's count of the current event at tenants to what its files take: the stored files,
 * the kept renders and the render attempts' reservations (a cancelled one's too, until its container
 * gives them back in settle). Under the exclusive count lock,
 * so no reserve or release runs between the read and the set: both happen before the commit of
 * the rows that hold the bytes, under the shared lock (the kit's `holdCount` and `releaseHeld`), so
 * the read sees rows and bytes together.
 */
export async function recount(deps: UpkeepDeps): Promise<void> {
  await deps.db.tenant(async (c) => {
    await lockCount(c, deps.storage);
    // One statement, so one snapshot for all three sums.
    const { rows } = await c.query(
      `SELECT (SELECT COALESCE(SUM(size_bytes), 0) FROM screen_files)
            + (SELECT COALESCE(SUM(bytes), 0) FROM screen_render_jobs WHERE state = 'succeeded')
            + (SELECT COALESCE(SUM(reserved_bytes), 0) FROM screen_render_jobs) AS total`,
      [],
    );
    await deps.storage.repair(Number(rows[0]?.total ?? 0));
  });
}

async function entries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if ((err as { code?: unknown }).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Removes the stored files without a row (written for a transaction that rolled back, whose
 * cleanup failed too) and the scratch of render attempts that are not running.
 */
export async function sweepFiles(deps: UpkeepDeps): Promise<void> {
  const filesDir = tenantFile("screen", "files", deps.filesRoot);
  const onDisk = (await entries(filesDir)).filter((name) => STORED_NAME.test(name));
  const known = new Set(
    await deps.db.tenant(async (c) =>
      (await c.query("SELECT name FROM screen_files", [])).rows.map((r) => r.name as string),
    ),
  );
  for (const name of onDisk.filter((n) => !known.has(n))) {
    // Under the file's lock and read again: an upload placing the same bytes holds the lock
    // from before its rename until its commit, so its file is never taken for an orphan.
    await deps.db.tenant(async (c) => {
      await lockFiles(c, [name]);
      const { rows } = await c.query("SELECT 1 FROM screen_files WHERE name = $1", [name]);
      if (rows.length === 0) await rm(join(filesDir, name), { force: true });
    });
  }
  const tmpDir = tenantFile("screen", "tmp", deps.filesRoot);
  for (const dir of await entries(tmpDir)) {
    const match = ATTEMPT_DIR.exec(dir);
    if (match === null) continue;
    const [, jobId, attempt] = match;
    // The job row's lock keeps the dispatcher from starting this attempt while it is removed.
    await deps.db.tenant(async (c) => {
      const { rows } = await c.query(
        "SELECT state, attempts FROM screen_render_jobs WHERE id = $1 FOR UPDATE",
        [jobId],
      );
      const job = rows[0] as { state: string; attempts: number } | undefined;
      if (job?.state === "running" && job.attempts === Number(attempt)) return;
      await rm(join(tmpDir, dir), { recursive: true, force: true });
    });
  }
}

/** Every event with screen files, each once per `periodMs` across all containers. */
export async function upkeepAll(deps: UpkeepDeps & { kv: Kv; periodMs?: number }): Promise<void> {
  for (const tenant of await tenantsWithFiles(deps.filesRoot, "screen")) {
    try {
      await withTenant(tenant, async () => {
        const claim = tenantKey("screen", "storage", "upkeep");
        if (!(await deps.kv.setIfAbsent(claim, "1", deps.periodMs ?? UPKEEP_MS))) return;
        try {
          await sweepFiles(deps);
        } catch (err) {
          deps.log?.warn({ err, tenant_id: tenant }, "sweeping screen's files failed");
        }
        await recount(deps);
      });
    } catch (err) {
      // One event's failure never holds back the others'.
      deps.log?.warn({ err, tenant_id: tenant }, "recounting screen's storage failed");
    }
  }
}
