/**
 * Stored files and the storage quota (contracts/theming.md, The theme package; contracts/tenants.md,
 * Storage quota). A file new to the event has its bytes reserved before it is written; identical
 * bytes share one file and one count; a file and its count go when nothing refers to it any more,
 * or when the write that placed it rolls back.
 */
import { holdCount, releaseHeld } from "@canccu/kit";
import type { Logger, SqlClient, StorageQuota } from "@canccu/kit";
import type { Db } from "./db.js";
import { fileName, lockFiles } from "./files.js";
import type { EmbedExt, FileStore, StoredExt } from "./files.js";

export interface StoredDeps {
  db: Db;
  files: FileStore;
  storage: StorageQuota;
  log: Logger;
}

interface Placed {
  name: string;
  /** Bytes reserved for a file new to the event, given back if the write rolls back. */
  reserved: number;
}

/**
 * Makes `bytes` the event's file inside the caller's transaction: when the event has no such file
 * yet, reserves its bytes, records it and writes it; otherwise refers to the one there is.
 */
async function place(
  c: SqlClient,
  deps: StoredDeps,
  bytes: Buffer,
  ext: StoredExt,
): Promise<Placed> {
  const name = fileName(bytes, ext);
  await lockFiles(c, [name]);
  const { rows } = await c.query(
    `SELECT EXISTS (SELECT 1 FROM theming_files WHERE sha256 = $1 AND ext = $2) AS theme,
            EXISTS (SELECT 1 FROM theming_embed_files WHERE file = $3) AS embed`,
    [name.slice(0, 64), ext, name],
  );
  const held = rows[0] as { theme: boolean; embed: boolean };
  if (held.theme) return { name, reserved: 0 };
  if (held.embed) {
    // An embed's file with these bytes is already on the volume: the bytes count once, so the
    // row only records them, with nothing reserved again.
    await c.query(`INSERT INTO theming_files (sha256, ext, bytes) VALUES ($1, $2, $3)`, [
      name.slice(0, 64),
      ext,
      bytes.length,
    ]);
    return { name, reserved: 0 };
  }
  // The caller holds the count lock until this transaction ends (`writingFiles`), so a recount
  // sees these bytes in the row or not at all.
  await deps.storage.reserve(bytes.length);
  try {
    // The row first: if the write then fails, the rollback takes the row, and no file is left on
    // disk without one.
    await c.query(`INSERT INTO theming_files (sha256, ext, bytes) VALUES ($1, $2, $3)`, [
      name.slice(0, 64),
      ext,
      bytes.length,
    ]);
    await deps.files.write(bytes, ext);
  } catch (err) {
    await releaseHeld(deps.storage, bytes.length, deps.log);
    throw err;
  }
  return { name, reserved: bytes.length };
}

interface Dropped {
  name: string;
  bytes: number;
}

/** Deletes the rows of those `names` nothing refers to any more: no owner and no embed. */
async function dropUnreferenced(c: SqlClient, names: string[]): Promise<Dropped[]> {
  if (names.length === 0) return [];
  await lockFiles(c, names);
  const { rows } = await c.query(
    `DELETE FROM theming_files f
      WHERE (f.sha256, f.ext) IN (SELECT split_part(n, '.', 1), split_part(n, '.', 2)
                                    FROM unnest($1::text[]) AS n)
       AND NOT EXISTS (SELECT 1 FROM theming_file_refs r WHERE r.file = f.sha256 || '.' || f.ext)
       AND NOT EXISTS (SELECT 1 FROM theming_embed_files e WHERE e.file = f.sha256 || '.' || f.ext)
     RETURNING f.sha256 || '.' || f.ext AS name, f.bytes`,
    [names],
  );
  return (rows as { name: string; bytes: string }[]).map((r) => ({
    name: r.name,
    bytes: Number(r.bytes),
  }));
}

/** Whether a row still keeps the stored file `name`: a theme file or an embed's. */
export async function isKept(c: SqlClient, name: string): Promise<boolean> {
  const { rows } = await c.query(
    `SELECT 1 FROM theming_files WHERE sha256 = split_part($1, '.', 1) AND ext = split_part($1, '.', 2)
     UNION ALL SELECT 1 FROM theming_embed_files WHERE file = $1 LIMIT 1`,
    [name],
  );
  return rows.length > 0;
}

/**
 * After the commit that deleted their rows (or the rollback that never kept them): unlinks each
 * file unless a write has brought a row back meanwhile. A failure leaves an orphan file, never a
 * missing one; the sweep (upkeep.ts) removes it.
 */
async function collect(deps: StoredDeps, names: string[]): Promise<void> {
  for (const name of names) {
    try {
      await deps.db.tenant(async (c) => {
        await lockFiles(c, [name]);
        if (!(await isKept(c, name))) await deps.files.remove(name);
      });
    } catch (err) {
      deps.log.warn({ err, file: name }, "removing an unreferenced theme file failed");
    }
  }
}

/**
 * Reserves the bytes of an embed's file the caller then writes and records itself (`putEmbed`),
 * unless the event holds these bytes already: the file on the volume counts once, whoever keeps it.
 */
async function reserveEmbed(
  c: SqlClient,
  deps: StoredDeps,
  bytes: Buffer,
  ext: EmbedExt,
): Promise<Placed> {
  const name = fileName(bytes, ext);
  await lockFiles(c, [name]);
  if (await isKept(c, name)) return { name, reserved: 0 };
  await deps.storage.reserve(bytes.length);
  return { name, reserved: bytes.length };
}

/** Stores checked bytes for the write and answers the stored name. */
export type Place = (bytes: Buffer, ext: StoredExt) => Promise<string>;
/** Reserves an embed file's bytes before the caller stores it (`reserveEmbed`). */
export type Reserve = (bytes: Buffer, ext: EmbedExt) => Promise<void>;

/** What a write's `fn` returns: its result and the files it stopped referring to. */
export interface Written<T> {
  result: T;
  unused: string[];
}

/**
 * Runs `fn` in one tenant transaction under the count lock. `fn` places the files it stores
 * through `place`, reserves an embed's files through `reserve` before it stores them, and returns
 * the files it stopped referring to; those nothing else refers to go,
 * their bytes given back before the commit and their files unlinked after it. If the write rolls
 * back, what it placed goes with its reserved bytes.
 */
export async function writingFiles<T>(
  deps: StoredDeps,
  fn: (c: SqlClient, place: Place, reserve: Reserve) => Promise<Written<T>>,
): Promise<T> {
  const placed: Placed[] = [];
  // An embed's bytes reserved in this write, which `isKept` cannot see until putEmbed records them.
  const reservedEmbeds = new Set<string>();
  const reserved = (): number => placed.reduce((sum, p) => sum + p.reserved, 0);
  let given = false as boolean;
  let dropped: Dropped[] = [];
  try {
    const result = await deps.db.tenant(async (c) => {
      await holdCount(c, deps.storage);
      try {
        const out = await fn(
          c,
          async (bytes, ext) => {
            const p = await place(c, deps, bytes, ext);
            placed.push(p);
            return p.name;
          },
          async (bytes, ext) => {
            const name = fileName(bytes, ext);
            if (reservedEmbeds.has(name)) return;
            reservedEmbeds.add(name);
            placed.push(await reserveEmbed(c, deps, bytes, ext));
          },
        );
        dropped = await dropUnreferenced(c, out.unused);
        // The last statement: nothing after it can roll the rows back while tenants keeps the
        // release (the kit's `releaseHeld`). Only a failed commit can still do that.
        const freed = dropped.reduce((sum, f) => sum + f.bytes, 0);
        await releaseHeld(deps.storage, freed, deps.log);
        return out.result;
      } catch (err) {
        // Before the rollback, still under the count lock: a recount never sees the placed rows
        // gone while tenants still counts their bytes.
        if (reserved() > 0) {
          await releaseHeld(deps.storage, reserved(), deps.log);
          given = true;
        }
        throw err;
      }
    });
    await collect(
      deps,
      dropped.map((f) => f.name),
    );
    return result;
  } catch (err) {
    const orphans = placed.filter((p) => p.reserved > 0);
    if (orphans.length > 0) {
      // Only a failed commit gets here with the bytes still out.
      if (!given) {
        await deps.db
          .tenant(async (c) => {
            await holdCount(c, deps.storage);
            await releaseHeld(deps.storage, reserved(), deps.log);
          })
          .catch((failed: unknown) => {
            deps.log.warn({ err: failed }, "giving back an upload failed");
          });
      }
      await collect(
        deps,
        orphans.map((p) => p.name),
      );
    }
    throw err;
  }
}
