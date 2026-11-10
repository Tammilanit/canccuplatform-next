/** Theme files: content-addressed on the shared files volume, recorded per tenant (contracts/theming.md, Tenancy). */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { requireTenant, tenantFile } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";

/** The only types the event's hostname serves outside the sandbox (contracts/theming.md, Where files are served). */
export const CONTENT_TYPES = {
  css: "text/css; charset=utf-8",
  woff2: "font/woff2",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
} as const;
export type Ext = keyof typeof CONTENT_TYPES;

/** An embed's types: the above plus what only the sandbox serves (contracts/theming.md, The sandbox). */
export const EMBED_TYPES = {
  ...CONTENT_TYPES,
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
} as const;
export type EmbedExt = keyof typeof EMBED_TYPES;

/** `<sha256>.<ext>`, the served name: the ServedFile pattern of contracts/theming.openapi.yaml. */
export const FILE_NAME = /^[0-9a-f]{64}\.(css|woff2|png|jpg|webp|svg)$/;
export const STORED_NAME = /^[0-9a-f]{64}\.(css|woff2|png|jpg|webp|svg|html|js|json)$/;

/** A write's temporary name (`write` below): the stored name and a random part. */
export const TEMP_NAME = /^[0-9a-f]{64}\.[a-z0-9]+\.[0-9a-f]{12}\.tmp$/;

/** Advisory-lock class of theming's file names; the two-key form never meets the migration lock. */
const FILE_LOCK_CLASS = 0x7e3e2;

/**
 * Takes the locks of `names` in one order, held to the end of the transaction. Every writer of a
 * stored name holds its lock until it commits the row that keeps it, and every remover checks for
 * rows under it, so a file is never unlinked in the moment a new write of the same bytes found it.
 */
export async function lockFiles(c: SqlClient, names: Iterable<string>): Promise<void> {
  for (const name of [...new Set(names)].sort()) {
    await c.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
      FILE_LOCK_CLASS,
      `${requireTenant()}/${name}`,
    ]);
  }
}

export function fileName(bytes: Buffer, ext: EmbedExt): string {
  return `${createHash("sha256").update(bytes).digest("hex")}.${ext}`;
}

export function extOf(name: string): Ext {
  return name.slice(name.lastIndexOf(".") + 1) as Ext;
}

export interface FileStore {
  /** Store bytes for the current tenant and record them; the same bytes give the same name. */
  put(client: SqlClient, bytes: Buffer, ext: Ext): Promise<string>;
  /** Store bytes for the current tenant without recording them: embeds record theirs (embeds.ts). */
  write(bytes: Buffer, ext: EmbedExt): Promise<string>;
  /** The bytes of a stored file of the current tenant, or undefined. */
  read(name: string): Promise<Buffer | undefined>;
  /**
   * Unlinks a stored file of the current tenant (the caller holds its lock and found no row), or a
   * temporary one a crashed write left.
   */
  remove(name: string): Promise<void>;
  /** What the current tenant's folder holds, temporary names included, for the sweep (upkeep.ts). */
  entries(): Promise<{ name: string; modifiedMs: number }[]>;
}

export function diskFiles(root: string): FileStore {
  const path = (name: string): string => tenantFile("theming", `files/${name}`, root);
  const write = async (bytes: Buffer, ext: EmbedExt): Promise<string> => {
    const name = fileName(bytes, ext);
    const target = path(name);
    await mkdir(dirname(target), { recursive: true });
    // Written under a temporary name and renamed, so a half-written file is never served.
    const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temp, bytes);
    await rename(temp, target);
    return name;
  };
  return {
    write,
    async put(client, bytes, ext) {
      await lockFiles(client, [fileName(bytes, ext)]);
      const name = await write(bytes, ext);
      // Not undone when the caller's transaction rolls back: the sweep (upkeep.ts) removes a file
      // left without a row. Only publish's generated CSS and images come here, unreserved: small
      // files the recount adds, so a publish never fails on the quota; uploads
      // reserve (stored.ts).
      await client.query(
        `INSERT INTO theming_files (sha256, ext, bytes) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [name.slice(0, 64), ext, bytes.length],
      );
      return name;
    },
    async read(name) {
      if (!STORED_NAME.test(name)) return undefined;
      try {
        return await readFile(path(name));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
    },
    async remove(name) {
      if (STORED_NAME.test(name) || TEMP_NAME.test(name)) await rm(path(name), { force: true });
    },
    async entries() {
      const dir = tenantFile("theming", "files", root);
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const out: { name: string; modifiedMs: number }[] = [];
      for (const name of names) {
        const info = await stat(join(dir, name)).catch(() => undefined);
        if (info?.isFile()) out.push({ name, modifiedMs: info.mtimeMs });
      }
      return out;
    },
  };
}
