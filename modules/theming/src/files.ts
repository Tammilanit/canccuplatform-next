/** Theme files: content-addressed on the shared files volume, recorded per tenant (contracts/theming.md, Tenancy). */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { tenantFile } from "@canccu/kit";
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
const STORED_NAME = /^[0-9a-f]{64}\.(css|woff2|png|jpg|webp|svg|html|js|json)$/;

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
      const name = await write(bytes, ext);
      // Not undone when the caller's transaction rolls back: the file stays on disk without a row.
      // Harmless while nothing writes at run time; publishing (#241) and uploads (#242) reserve
      // first and clean up on rollback (docs/plans/issue-185.md, D3).
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
  };
}
