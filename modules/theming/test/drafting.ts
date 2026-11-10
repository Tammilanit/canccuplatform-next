/**
 * The harness of the draft file tests (`PUT` and `DELETE /api/theming/draft/file?path=`): a fresh
 * app per test file, the tables and volume emptied before each test, and the requests they make.
 */
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, expect } from "vitest";
import { tenantFile, withTenant } from "@canccu/kit";
import type { LightMyRequestResponse } from "fastify";
import { VENUE_IP, harness, send } from "./helpers.js";
import type { Harness } from "./helpers.js";

export interface DraftBody {
  draft_version: number;
  mode: string;
  files?: { path: string; bytes: number }[];
  problems: { severity: string; code: string; path?: string }[];
}

export const png = (background = "#3b82f6", size = 8): Promise<Buffer> =>
  sharp({ create: { width: size, height: size, channels: 4, background } })
    .png()
    .toBuffer();

export function woff2(size = 128): Buffer {
  const b = Buffer.alloc(size);
  b.write("wOF2", 0, "latin1");
  b.writeUInt32BE(0x00010000, 4);
  b.writeUInt32BE(size, 8);
  b.writeUInt16BE(3, 12);
  b.writeUInt32BE(size - 48, 20);
  return b;
}

export const SCRIPTED = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>',
);

/** Registers a fresh harness for the calling `describe`, and the requests its tests make. */
export function draftFiles() {
  const ctx = {} as { h: Harness };
  beforeAll(async () => {
    ctx.h = await harness();
    // A failure after the file is placed, as a dropped connection or a bug would cause one.
    await ctx.h.pool.query(`
      CREATE OR REPLACE FUNCTION theming_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected failure'; END $$;
      CREATE TRIGGER theming_test_fail BEFORE INSERT ON theming_package_files
        FOR EACH ROW WHEN (NEW.path = 'images/fails.png') EXECUTE FUNCTION theming_test_fail();`);
  });
  afterAll(async () => {
    await ctx.h.close();
  });
  beforeEach(async () => {
    for (const tenant of ["alpha", "beta"]) {
      await withTenant(tenant, () =>
        ctx.h.db.tenant(async (c) => {
          for (const table of [
            "theming_drafts",
            "theming_revisions",
            "theming_file_refs",
            "theming_package_files",
            "theming_embed_files",
            "theming_files",
          ]) {
            await c.query(`DELETE FROM ${table}`);
          }
        }),
      );
    }
    for (const tenant of ["alpha", "beta"]) {
      await rm(join(ctx.h.root, tenant), { recursive: true, force: true });
    }
    ctx.h.storage.used = {};
    ctx.h.storage.quota = {};
  });

  const fresh = async (host = "alpha.test"): Promise<DraftBody> => {
    const res = await send(ctx.h, "POST", "/api/theming/draft", { from: "defaults" }, { host });
    expect(res.statusCode).toBe(201);
    return res.json<DraftBody>();
  };

  const put = (
    path: string,
    version: number,
    body: Buffer,
    opts: { host?: string; session?: string; type?: string } = {},
  ): Promise<LightMyRequestResponse> =>
    ctx.h.app.inject({
      method: "PUT",
      url: `/api/theming/draft/file?path=${encodeURIComponent(path)}&draft_version=${version}`,
      headers: {
        host: opts.host ?? "alpha.test",
        "x-forwarded-for": VENUE_IP,
        cookie: `canccu_session=${opts.session ?? "admin"}`,
        "content-type": opts.type ?? "application/octet-stream",
      },
      payload: body,
    });

  const remove = (path: string, version: number): Promise<LightMyRequestResponse> =>
    send(
      ctx.h,
      "DELETE",
      `/api/theming/draft/file?path=${encodeURIComponent(path)}&draft_version=${version}`,
    );

  /** The stored file at `path` of `owner`, as the served name. */
  const fileAt = (path: string, owner = "draft", tenant = "alpha"): Promise<string | undefined> =>
    withTenant(tenant, () =>
      ctx.h.db.tenant(async (c) => {
        const { rows } = await c.query(
          `SELECT file FROM theming_package_files WHERE owner = $1 AND path = $2`,
          [owner, path],
        );
        return (rows[0] as { file: string | null } | undefined)?.file ?? undefined;
      }),
    );

  const onDisk = (tenant = "alpha"): Promise<string[]> =>
    withTenant(tenant, async () => {
      const dir = tenantFile("theming", "files", ctx.h.root);
      return existsSync(dir) ? (await readdir(dir)).sort() : [];
    });

  const storedBytes = (tenant = "alpha"): Promise<number> =>
    withTenant(tenant, () =>
      ctx.h.db.tenant(async (c) => {
        const { rows } = await c.query(`SELECT coalesce(sum(bytes), 0) AS n FROM theming_files`);
        return Number((rows[0] as { n: string }).n);
      }),
    );

  return {
    get h(): Harness {
      return ctx.h;
    },
    fresh,
    put,
    remove,
    fileAt,
    onDisk,
    storedBytes,
  };
}
