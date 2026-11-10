/**
 * The storage upkeep (contracts/tenants.md, Storage quota, Repair): the recount of theming's bytes
 * through tenants' repair path, and the sweep of files no row keeps.
 */
import { existsSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { holdCount, requireTenant, tenantFile, withTenant } from "@canccu/kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recount, sweepFiles, upkeepAll } from "../src/upkeep.js";
import { DATABASE_URL, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

const name = (c: string, ext: string): string => `${c.repeat(64)}.${ext}`;

describe.skipIf(!DATABASE_URL)("storage upkeep", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    for (const tenant of ["alpha", "beta"]) {
      await withTenant(tenant, () =>
        h.db.tenant(async (c) => {
          await c.query("DELETE FROM theming_files");
          await c.query("DELETE FROM theming_embed_files");
        }),
      );
      await rm(join(h.root, tenant), { recursive: true, force: true });
    }
    h.storage.used = {};
  });

  const inAlpha = <T>(fn: () => Promise<T>): Promise<T> => withTenant("alpha", fn);
  const deps = () => ({ db: h.db, files: h.files, storage: h.quota });

  /** A file on the volume, with a theme row, an embed row, or none. */
  const seed = (file: string, bytes: number, row: "theme" | "embed" | "none", tenant = "alpha") =>
    withTenant(tenant, async () => {
      const dir = tenantFile("theming", "files", h.root);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, file), Buffer.alloc(bytes));
      await h.db.tenant(async (c) => {
        if (row === "theme") {
          await c.query(`INSERT INTO theming_files (sha256, ext, bytes) VALUES ($1, $2, $3)`, [
            file.slice(0, 64),
            file.slice(65),
            bytes,
          ]);
        } else if (row === "embed") {
          await c.query(
            `INSERT INTO theming_embed_files (owner, embed, path, file, bytes, entry)
             VALUES ('draft', 'e', $1, $2, $3, false)`,
            [`f${Math.random().toString(36).slice(2)}.css`, file, bytes],
          );
        }
      });
    });

  const exists = (file: string, tenant = "alpha"): Promise<boolean> =>
    withTenant(tenant, () =>
      Promise.resolve(existsSync(join(tenantFile("theming", "files", h.root), file))),
    );

  it("sets the count to what theme and embed files take, each stored file once", async () => {
    await seed(name("a", "png"), 100, "theme");
    await seed(name("b", "css"), 20, "embed");
    // The same bytes as an embed's file and a theme's: one file on the volume.
    await seed(name("c", "css"), 7, "theme");
    await inAlpha(() =>
      h.db.tenant((c) =>
        c.query(
          `INSERT INTO theming_embed_files (owner, embed, path, file, bytes, entry)
           VALUES ('draft', 'e', 'shared.css', $1, 7, false)`,
          [name("c", "css")],
        ),
      ),
    );
    h.storage.used.alpha = 999_999;
    await inAlpha(() => recount(deps()));
    expect(h.storage.used.alpha).toBe(127);
  });

  it("waits for a write's open reservation, so its bytes are not lost from the count", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const write = inAlpha(() =>
      h.db.tenant(async (c) => {
        await holdCount(c, h.quota);
        await h.quota.reserve(50);
        held();
        await gate;
        await c.query(`INSERT INTO theming_files (sha256, ext, bytes) VALUES ($1, 'png', 50)`, [
          "d".repeat(64),
        ]);
      }),
    );
    await holding;
    let done = false;
    const counting = inAlpha(() => recount(deps())).then(() => (done = true));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(done).toBe(false);
    release();
    await write;
    await counting;
    expect(h.storage.used.alpha).toBe(50);
  });

  it("removes files no row keeps and crashed writes' temporary files, and keeps the rest", async () => {
    await seed(name("a", "png"), 10, "theme");
    await seed(name("b", "js"), 10, "embed");
    await seed(name("e", "svg"), 10, "none");
    const stale = `${name("f", "png")}.0123456789ab.tmp`;
    const fresh = `${name("f", "png")}.ba9876543210.tmp`;
    await seed(stale, 5, "none");
    await seed(fresh, 5, "none");
    await seed("README", 1, "none");
    const old = new Date(Date.now() - 2 * 3_600_000);
    await inAlpha(() => utimes(join(tenantFile("theming", "files", h.root), stale), old, old));

    await inAlpha(() => sweepFiles(deps()));
    expect(await exists(name("a", "png"))).toBe(true);
    expect(await exists(name("b", "js"))).toBe(true);
    expect(await exists(name("e", "svg"))).toBe(false);
    expect(await exists(stale)).toBe(false);
    expect(await exists(fresh)).toBe(true);
    expect(await exists("README")).toBe(true);
  });

  it("runs for every event with theming files, one event's failure holding back none", async () => {
    await seed(name("a", "png"), 30, "theme", "alpha");
    await seed(name("e", "svg"), 10, "none", "alpha");
    await seed(name("b", "png"), 40, "theme", "beta");
    await mkdir(join(h.root, "_platform", "theming"), { recursive: true });
    // Alpha comes first and fails: tenants refuses its repair.
    const failing = {
      ...h.quota,
      repair: (bytes: number) =>
        requireTenant() === "alpha"
          ? Promise.reject(new Error("tenants down"))
          : h.quota.repair(bytes),
    };
    await upkeepAll({ ...deps(), storage: failing, filesRoot: h.root });
    expect(h.storage.used.beta).toBe(40);
    expect(await exists(name("e", "svg"), "alpha")).toBe(false);
    await upkeepAll({ ...deps(), filesRoot: h.root });
    expect(h.storage.used.alpha).toBe(30);
  });
});
