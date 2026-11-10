/**
 * Content-addressed files under `/files/<tenant>/screen/files/<sha256>.<ext>` (plan #108, D9).
 * An upload is written to a temporary name and renamed into place, so no partial file is ever
 * served. Identical bytes share one file and one quota count; a file and its count go when the
 * last row that refers to it goes.
 *
 * Placing a file and removing one are serialised per file name by a transaction-scoped advisory
 * lock: without it a delete could unlink a file in the moment a new upload of the same bytes
 * found its row and started referring to it.
 */
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { KitError, requireTenant, tenantFile } from "@canccu/kit";
import type { Logger, SqlClient, StorageQuota } from "@canccu/kit";
import type { Db } from "../db.js";

/** Advisory-lock class of screen's file names; the two-key form never meets the migration lock. */
const FILE_LOCK_CLASS = 0x5c4e;
const HEAD_BYTES = 4096;
const TAIL_BYTES = 65536;

export interface Received {
  path: string;
  bytes: number;
  sha256: string;
  head: Buffer;
  tail: Buffer;
}

export function filePath(root: string, name: string): string {
  return tenantFile("screen", `files/${name}`, root);
}

function tempPath(root: string): string {
  return tenantFile("screen", `tmp/${randomBytes(12).toString("hex")}`, root);
}

async function ends(path: string, bytes: number): Promise<{ head: Buffer; tail: Buffer }> {
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(Math.min(HEAD_BYTES, bytes));
    const tail = Buffer.alloc(Math.min(TAIL_BYTES, bytes));
    await handle.read(head, 0, head.length, 0);
    await handle.read(tail, 0, tail.length, bytes - tail.length);
    return { head, tail };
  } finally {
    await handle.close();
  }
}

/**
 * A volume the module may not write (owned by another user, mounted read-only) answers 503 with
 * a message an operator can act on, not a 500: no upload can work until it is fixed.
 */
async function onVolume<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
      throw new KitError(
        "The files volume cannot be written, so uploads are off. Tell an operator.",
        {
          status: 503,
          code: "files_unavailable",
        },
      );
    }
    throw err;
  }
}

/** Writes `source` to a temporary file of the tenant, hashing it on the way. */
export async function receive(root: string, source: Readable | Buffer): Promise<Received> {
  const path = tempPath(root);
  await onVolume(() => mkdir(dirname(path), { recursive: true }));
  const hash = createHash("sha256");
  let bytes = 0;
  const chunks = Buffer.isBuffer(source) ? [source] : source;
  try {
    await onVolume(() =>
      pipeline(
        async function* () {
          for await (const chunk of chunks as AsyncIterable<Buffer> | Buffer[]) {
            hash.update(chunk);
            bytes += chunk.length;
            yield chunk;
          }
        },
        createWriteStream(path, { flags: "wx" }),
      ),
    );
  } catch (err) {
    await rm(path, { force: true });
    throw err;
  }
  return { path, bytes, sha256: hash.digest("hex"), ...(await ends(path, bytes)) };
}

/** Takes the locks of `names` in one order, so two transactions never wait on each other. */
export async function lockFiles(c: SqlClient, names: Iterable<string>): Promise<void> {
  for (const name of [...new Set(names)].sort()) {
    await c.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
      FILE_LOCK_CLASS,
      `${requireTenant()}/${name}`,
    ]);
  }
}

export interface Placed {
  name: string;
  /** Bytes reserved for a file new to the event; the caller releases them if it rolls back. */
  reserved: number;
}

/**
 * Makes `temp` the event's file `name` inside the caller's transaction: reserves its bytes and
 * renames it into place when the event has no such file yet, otherwise drops the copy.
 */
export async function place(
  c: SqlClient,
  root: string,
  storage: StorageQuota,
  temp: Received,
  file: { ext: string; mime: string },
): Promise<Placed> {
  const name = `${temp.sha256}.${file.ext}`;
  await lockFiles(c, [name]);
  const { rows } = await c.query("SELECT 1 FROM screen_files WHERE name = $1", [name]);
  if (rows.length > 0) {
    await rm(temp.path, { force: true });
    return { name, reserved: 0 };
  }
  // The caller holds the count lock until this transaction ends (write.ts), so a recount sees
  // these bytes in the row or not at all.
  await storage.reserve(temp.bytes);
  try {
    // The row first: if the rename then fails, the caller's rollback takes the row, and no file
    // is left on disk without one.
    await c.query("INSERT INTO screen_files (name, mime_type, size_bytes) VALUES ($1, $2, $3)", [
      name,
      file.mime,
      temp.bytes,
    ]);
    const target = filePath(root, name);
    await onVolume(async () => {
      await mkdir(dirname(target), { recursive: true });
      await rename(temp.path, target);
    });
  } catch (err) {
    await storage.release(temp.bytes);
    throw err;
  }
  return { name, reserved: temp.bytes };
}

export interface Dropped {
  name: string;
  bytes: number;
}

/**
 * Deletes the rows of those `names` nothing refers to any more, in the caller's transaction,
 * which gives their bytes back as its last step (write.ts); the caller passes them to `collect`
 * after it commits. Later slices add their references (renders, claim sounds) to the `NOT EXISTS`.
 */
export async function dropUnreferenced(c: SqlClient, names: string[]): Promise<Dropped[]> {
  if (names.length === 0) return [];
  await lockFiles(c, names);
  const { rows } = await c.query(
    `DELETE FROM screen_files f WHERE f.name = ANY($1)
       AND NOT EXISTS (SELECT 1 FROM screen_asset_versions v WHERE v.file = f.name)
       AND NOT EXISTS (SELECT 1 FROM screen_photos p WHERE p.file = f.name)
     RETURNING name, size_bytes`,
    [names],
  );
  return rows.map((r) => ({ name: r.name as string, bytes: Number(r.size_bytes) }));
}

/**
 * After the commit that deleted their rows (or the rollback that never kept them): unlinks each
 * file unless an upload has brought its row back meanwhile. The caller gave their bytes back
 * already: before that commit (write.ts, under the count lock), or for a rolled-back upload just
 * before calling this. A failure leaves an orphan file, never a missing one; the storage upkeep
 * removes it.
 */
export async function collect(
  db: Db,
  root: string,
  dropped: Pick<Dropped, "name">[],
  log?: Logger,
): Promise<void> {
  for (const file of dropped) {
    try {
      await db.tenant(async (c) => {
        await lockFiles(c, [file.name]);
        const { rows } = await c.query("SELECT 1 FROM screen_files WHERE name = $1", [file.name]);
        if (rows.length === 0) await rm(filePath(root, file.name), { force: true });
      });
    } catch (err) {
      log?.warn({ err, file: file.name }, "removing an unreferenced file failed");
    }
  }
}
