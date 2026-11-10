/**
 * The storage upkeep (contracts/tenants.md, Storage quota, Repair): once a period per event,
 * theming removes the files on the volume no row keeps, then sets its count at tenants to what its
 * stored files take. A crash between a reserve and its release, a cleanup that failed, or files
 * written without a reserve (publish's generated CSS, files.ts) so stay wrong at most one period.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { isTenantId, lockCount, withTenant } from "@canccu/kit";
import type { Logger, StorageQuota } from "@canccu/kit";
import type { Db } from "./db.js";
import { STORED_NAME, TEMP_NAME, lockFiles } from "./files.js";
import type { FileStore } from "./files.js";
import { QUOTA_MODULE, isKept } from "./stored.js";

export const UPKEEP_MS = 3_600_000;
/** A temporary name this old is a write that crashed between writing and renaming (files.ts). */
const STALE_TEMP_MS = 3_600_000;

export interface UpkeepDeps {
  db: Db;
  files: FileStore;
  storage: StorageQuota;
  log?: Logger;
}

/**
 * Sets theming's count of the current event to what its stored files take, each once: theme files
 * and embed files share the folder and its content addresses. Under the exclusive count lock, so
 * no reserve or release runs between the read and the set: writers do both before the commit of
 * the rows that hold the bytes, under the shared lock (stored.ts, `writingFiles`).
 */
export async function recount(deps: UpkeepDeps): Promise<void> {
  await deps.db.tenant(async (c) => {
    await lockCount(c, QUOTA_MODULE);
    const { rows } = await c.query(
      `SELECT coalesce(sum(bytes), 0) AS total FROM (
         SELECT sha256 || '.' || ext AS name, bytes FROM theming_files
         UNION SELECT file, bytes FROM theming_embed_files) stored`,
    );
    await deps.storage.repair(Number((rows[0] as { total: string }).total));
  });
}

/**
 * Removes the stored files no row keeps (written for a transaction that rolled back, whose cleanup
 * failed too) and the temporary files of writes that crashed.
 */
export async function sweepFiles(deps: UpkeepDeps, now = Date.now()): Promise<void> {
  for (const { name, modifiedMs } of await deps.files.entries()) {
    if (TEMP_NAME.test(name)) {
      if (now - modifiedMs > STALE_TEMP_MS) await deps.files.remove(name);
      continue;
    }
    if (!STORED_NAME.test(name)) continue;
    // Under the file's lock and read again: a write of the same bytes holds the lock from before
    // it writes until its commit, so its file is never taken for an orphan.
    await deps.db.tenant(async (c) => {
      await lockFiles(c, [name]);
      if (!(await isKept(c, name))) await deps.files.remove(name);
    });
  }
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
 * Every event with theming files. Every container runs it each period, with no claim between
 * them: the sweep and the recount are safe to run twice, under their locks, and cost little.
 */
export async function upkeepAll(deps: UpkeepDeps & { filesRoot: string }): Promise<void> {
  for (const tenant of (await entries(deps.filesRoot)).filter(isTenantId)) {
    // Only events that ever had theming files; `_platform` is no tenant id.
    if ((await entries(join(deps.filesRoot, tenant, "theming"))).length === 0) continue;
    try {
      await withTenant(tenant, async () => {
        try {
          await sweepFiles(deps);
        } catch (err) {
          deps.log?.warn({ err, tenant_id: tenant }, "sweeping theming's files failed");
        }
        await recount(deps);
      });
    } catch (err) {
      // One event's failure never holds back the others'.
      deps.log?.warn({ err, tenant_id: tenant }, "recounting theming's storage failed");
    }
  }
}
