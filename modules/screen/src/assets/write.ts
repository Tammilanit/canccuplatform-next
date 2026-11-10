/** The one way a request writes a stored file and the rows that use it (plan #108, D9). */
import { rm } from "node:fs/promises";
import type { Bus, Logger, RightsChecker, SqlClient } from "@canccu/kit";
import type { Audit } from "../audit.js";
import type { Db } from "../db.js";
import type { Settings } from "../health.js";
import { collect, dropUnreferenced, place } from "./files.js";
import type { Dropped, Placed } from "./files.js";
import type { Ffprobe } from "./probe.js";
import type { StorageQuota } from "./storage.js";
import type { Prepared } from "./upload.js";
import type { RenderQueue } from "../render/queue.js";

export interface AssetDeps {
  db: Db;
  rights: RightsChecker;
  audit: Audit;
  settings: Settings;
  storage: StorageQuota;
  filesRoot: string;
  ffprobe: Ffprobe;
  fetch: typeof fetch;
  /** A deck upload submits its render job; a version's render goes with the version. */
  queue: RenderQueue;
  bus: Bus;
  now: () => number;
  log?: Logger;
}

/** What a write that only drops files needs. */
export type FileDeps = Pick<AssetDeps, "db" | "storage" | "filesRoot" | "log">;

export function fileName(prepared: Prepared): string {
  return `${prepared.temp.sha256}.${prepared.ext}`;
}

/**
 * Runs `fn` in one tenant transaction. `fn` calls `placeFile` once it holds its other locks (an
 * asset row comes before any file, the order every writer keeps) and returns the files it
 * stopped using. After the commit those go if nothing else uses them; on a rollback a file this
 * placed goes with its reserved bytes.
 */
export async function writeWithFile<T>(
  deps: AssetDeps,
  prepared: Prepared,
  fn: (c: SqlClient, placeFile: () => Promise<string>) => Promise<{ result: T; unused: string[] }>,
): Promise<T> {
  let placed: Placed | null = null;
  let dropped: Dropped[] = [];
  try {
    const result = await deps.db.tenant(async (c) => {
      const out = await fn(c, async () => {
        placed = await place(c, deps.filesRoot, deps.storage, prepared.temp, prepared);
        return placed.name;
      });
      dropped = await dropUnreferenced(c, out.unused);
      return out.result;
    });
    await collect(deps.db, deps.filesRoot, deps.storage, dropped, deps.log);
    return result;
  } catch (err) {
    const orphan = placed as Placed | null;
    if (orphan !== null && orphan.reserved > 0) {
      const lost = [{ name: orphan.name, bytes: orphan.reserved }];
      await collect(deps.db, deps.filesRoot, deps.storage, lost, deps.log);
    }
    throw err;
  } finally {
    await rm(prepared.temp.path, { force: true });
  }
}

/** As `writeWithFile`, for a write that only stops using files (delete, revert). */
export async function writeDroppingFiles<T>(
  deps: FileDeps,
  fn: (c: SqlClient) => Promise<{ result: T; unused: string[] }>,
): Promise<T> {
  let dropped: Dropped[] = [];
  const result = await deps.db.tenant(async (c) => {
    const out = await fn(c);
    dropped = await dropUnreferenced(c, out.unused);
    return out.result;
  });
  await collect(deps.db, deps.filesRoot, deps.storage, dropped, deps.log);
  return result;
}
