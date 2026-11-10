/**
 * `PUT` and `DELETE /api/theming/draft/file?path=` (contracts/theming.md, Draft, preview, publish):
 * every upload checked, its bytes reserved against the storage quota before they are written and
 * given back when the file goes or the write rolls back.
 */
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tenantFile, withTenant } from "@canccu/kit";
import type { LightMyRequestResponse } from "fastify";
import { DATABASE_URL, VENUE_IP, code, get, harness, send } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface DraftBody {
  draft_version: number;
  mode: string;
  files?: { path: string; bytes: number }[];
  problems: { severity: string; code: string; path?: string }[];
}

const png = (background = "#3b82f6", size = 8): Promise<Buffer> =>
  sharp({ create: { width: size, height: size, channels: 4, background } })
    .png()
    .toBuffer();

function woff2(size = 128): Buffer {
  const b = Buffer.alloc(size);
  b.write("wOF2", 0, "latin1");
  b.writeUInt32BE(0x00010000, 4);
  b.writeUInt32BE(size, 8);
  b.writeUInt16BE(3, 12);
  b.writeUInt32BE(size - 48, 20);
  return b;
}

const SCRIPTED = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>',
);

describe.skipIf(!DATABASE_URL)("draft files", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    // A failure after the file is placed, as a dropped connection or a bug would cause one.
    await h.pool.query(`
      CREATE OR REPLACE FUNCTION theming_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected failure'; END $$;
      CREATE TRIGGER theming_test_fail BEFORE INSERT ON theming_package_files
        FOR EACH ROW WHEN (NEW.path = 'images/fails.png') EXECUTE FUNCTION theming_test_fail();`);
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    for (const tenant of ["alpha", "beta"]) {
      await withTenant(tenant, () =>
        h.db.tenant(async (c) => {
          for (const table of [
            "theming_drafts",
            "theming_revisions",
            "theming_file_refs",
            "theming_package_files",
            "theming_files",
          ]) {
            await c.query(`DELETE FROM ${table}`);
          }
        }),
      );
    }
    for (const tenant of ["alpha", "beta"]) {
      await rm(join(h.root, tenant), { recursive: true, force: true });
    }
    h.storage.used = {};
    h.storage.quota = {};
  });

  const fresh = async (host = "alpha.test"): Promise<DraftBody> => {
    const res = await send(h, "POST", "/api/theming/draft", { from: "defaults" }, { host });
    expect(res.statusCode).toBe(201);
    return res.json<DraftBody>();
  };

  const put = (
    path: string,
    version: number,
    body: Buffer,
    opts: { host?: string; session?: string; type?: string } = {},
  ): Promise<LightMyRequestResponse> =>
    h.app.inject({
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
      h,
      "DELETE",
      `/api/theming/draft/file?path=${encodeURIComponent(path)}&draft_version=${version}`,
    );

  /** The stored file at `path` of `owner`, as the served name. */
  const fileAt = (path: string, owner = "draft", tenant = "alpha"): Promise<string | undefined> =>
    withTenant(tenant, () =>
      h.db.tenant(async (c) => {
        const { rows } = await c.query(
          `SELECT file FROM theming_package_files WHERE owner = $1 AND path = $2`,
          [owner, path],
        );
        return (rows[0] as { file: string | null } | undefined)?.file ?? undefined;
      }),
    );

  const onDisk = (tenant = "alpha"): Promise<string[]> =>
    withTenant(tenant, async () => {
      const dir = tenantFile("theming", "files", h.root);
      return existsSync(dir) ? (await readdir(dir)).sort() : [];
    });

  const storedBytes = (tenant = "alpha"): Promise<number> =>
    withTenant(tenant, () =>
      h.db.tenant(async (c) => {
        const { rows } = await c.query(`SELECT coalesce(sum(bytes), 0) AS n FROM theming_files`);
        return Number((rows[0] as { n: string }).n);
      }),
    );

  describe("an upload that passes", () => {
    it("is stored as checked, listed on the draft, served to the draft and counted", async () => {
      const draft = await fresh();
      const res = await put("images/logo.png", draft.draft_version, await png());
      expect(res.statusCode).toBe(200);
      const body = res.json<DraftBody>();
      expect(body.draft_version).toBe(draft.draft_version + 1);
      expect(body.mode).toBe("simple");
      expect(body.problems.filter((p) => p.path === "images/logo.png")).toEqual([]);
      const name = await fileAt("images/logo.png");
      expect(name).toMatch(/^[0-9a-f]{64}\.png$/);
      expect(body.files).toEqual([{ path: "images/logo.png", bytes: await storedBytes() }]);
      expect(h.storage.used.alpha).toBe(await storedBytes());
      const served = await get(h, `/theming/draft/${name}`, { session: "admin" });
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-type"]).toBe("image/png");
      expect(served.headers["x-content-type-options"]).toBe("nosniff");
      // Another event never reaches it.
      const other = await get(h, `/theming/draft/${name}`, { host: "beta.test", session: "admin" });
      expect(other.statusCode).toBe(404);
    });

    it("goes by its content, whatever Content-Type was sent", async () => {
      const draft = await fresh();
      const res = await put("images/logo.png", draft.draft_version, await png(), {
        type: "application/json",
      });
      expect(res.statusCode).toBe(200);
      const svg = await put(
        "images/mark.svg",
        draft.draft_version + 1,
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        { type: "image/png" },
      );
      expect(svg.statusCode).toBe(200);
      expect(await fileAt("images/mark.svg")).toMatch(/\.svg$/);
    });

    it("makes the theme advanced for anything but an image", async () => {
      const draft = await fresh();
      const res = await put("fonts/body.woff2", draft.draft_version, woff2());
      expect(res.statusCode).toBe(200);
      expect(res.json<DraftBody>().mode).toBe("advanced");
    });

    it("replaces the file at its path, and the old one goes with its bytes", async () => {
      const draft = await fresh();
      await put("images/logo.png", draft.draft_version, await png("#111111"));
      const first = await fileAt("images/logo.png");
      const res = await put("images/logo.png", draft.draft_version + 1, await png("#eeeeee"));
      expect(res.statusCode).toBe(200);
      const second = await fileAt("images/logo.png");
      expect(second).not.toBe(first);
      expect(await onDisk()).toEqual([second]);
      expect(h.storage.used.alpha).toBe(await storedBytes());
    });

    it("counts the same bytes once, however many paths hold them", async () => {
      const draft = await fresh();
      const bytes = await png();
      await put("images/a.png", draft.draft_version, bytes);
      await put("images/b.png", draft.draft_version + 1, bytes);
      const once = h.storage.used.alpha;
      expect(once).toBe(await storedBytes());
      const res = await remove("images/a.png", draft.draft_version + 2);
      expect(res.statusCode).toBe(200);
      expect(h.storage.used.alpha).toBe(once);
      await remove("images/b.png", draft.draft_version + 3);
      expect(h.storage.used.alpha).toBe(0);
      expect(await onDisk()).toEqual([]);
    });
  });

  describe("an upload that fails a check", () => {
    it("stores nothing and names the path in the draft's problems until it is removed", async () => {
      const draft = await fresh();
      const res = await put("images/logo.svg", draft.draft_version, SCRIPTED);
      expect(res.statusCode).toBe(200);
      const body = res.json<DraftBody>();
      expect(body.problems).toContainEqual(
        expect.objectContaining({
          severity: "error",
          code: "svg_forbidden",
          path: "images/logo.svg",
        }),
      );
      expect(body.files).toEqual([]);
      expect(await onDisk()).toEqual([]);
      expect(h.storage.used.alpha ?? 0).toBe(0);

      // The problem stays through other edits, and publishing refuses the draft.
      const edit = await send(h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: body.draft_version,
        tokens: { motion: "calm" },
      });
      expect(edit.json<DraftBody>().problems.map((p) => p.code)).toContain("svg_forbidden");
      const refused = await send(h, "POST", "/api/theming/draft/publish", {
        draft_version: body.draft_version + 1,
      });
      expect(refused.statusCode).toBe(422);
      expect(code(refused)).toBe("theme_invalid");

      const cleared = await remove("images/logo.svg", body.draft_version + 1);
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json<DraftBody>().problems.map((p) => p.code)).not.toContain("svg_forbidden");
      const published = await send(h, "POST", "/api/theming/draft/publish", {
        draft_version: body.draft_version + 2,
      });
      expect(published.statusCode).toBe(201);
    });

    it("takes the place of a good file at its path, which goes with its bytes", async () => {
      const draft = await fresh();
      await put("images/logo.png", draft.draft_version, await png());
      const res = await put("images/logo.png", draft.draft_version + 1, Buffer.from("GIF89a"));
      expect(res.json<DraftBody>().problems).toContainEqual(
        expect.objectContaining({ code: "file_type", path: "images/logo.png" }),
      );
      expect(h.storage.used.alpha).toBe(0);
      expect(await onDisk()).toEqual([]);
    });

    it("is file_too_large over its kind's limit", async () => {
      const draft = await fresh();
      const res = await put("fonts/big.woff2", draft.draft_version, woff2(1024 * 1024 + 64));
      expect(res.json<DraftBody>().problems).toContainEqual(
        expect.objectContaining({ code: "file_too_large", path: "fonts/big.woff2" }),
      );
    });
  });

  describe("the storage quota", () => {
    it("refuses an upload that would pass it, with tenants' code, and changes nothing", async () => {
      const draft = await fresh();
      h.storage.quota.alpha = 10;
      const res = await put("images/logo.png", draft.draft_version, await png());
      expect(res.statusCode).toBe(413);
      expect(code(res)).toBe("storage_quota_exceeded");
      expect(await onDisk()).toEqual([]);
      expect(await storedBytes()).toBe(0);
      const after = await get(h, "/api/theming/draft", { session: "admin" });
      expect(after.json<DraftBody>().draft_version).toBe(draft.draft_version);
    });

    it("gets the bytes back, and the file is gone, when the write rolls back after placing it", async () => {
      const draft = await fresh();
      const res = await put("images/fails.png", draft.draft_version, await png());
      expect(res.statusCode).toBe(500);
      expect(h.storage.used.alpha ?? 0).toBe(0);
      expect(await onDisk()).toEqual([]);
      expect(await storedBytes()).toBe(0);
    });

    it("reserves nothing for a stale draft_version", async () => {
      const draft = await fresh();
      const res = await put("images/logo.png", draft.draft_version + 5, await png());
      expect(res.statusCode).toBe(409);
      expect(code(res)).toBe("version_conflict");
      expect(h.storage.used.alpha ?? 0).toBe(0);
      expect(await onDisk()).toEqual([]);
    });

    it("keeps a file a revision holds when the draft lets go of it", async () => {
      const draft = await fresh();
      await put("images/logo.png", draft.draft_version, await png());
      const published = await send(h, "POST", "/api/theming/draft/publish", {
        draft_version: draft.draft_version + 1,
      });
      expect(published.statusCode).toBe(201);
      const name = await fileAt("images/logo.png", "r:1");
      expect(name).toMatch(/\.png$/);
      const again = await send(h, "POST", "/api/theming/draft", { from: "current" });
      expect(again.json<DraftBody>().files).toEqual([
        { path: "images/logo.png", bytes: expect.any(Number) as number },
      ]);
      const res = await remove("images/logo.png", again.json<DraftBody>().draft_version);
      expect(res.statusCode).toBe(200);
      expect(await onDisk()).toContain(name);
      const served = await get(h, `/theming/a/${name}`);
      expect(served.statusCode).toBe(200);
    });

    it("gets back the bytes of the files only a discarded draft held", async () => {
      const draft = await fresh();
      await put("images/logo.png", draft.draft_version, await png());
      expect(h.storage.used.alpha).toBeGreaterThan(0);
      const res = await send(
        h,
        "DELETE",
        `/api/theming/draft?draft_version=${draft.draft_version + 1}`,
      );
      expect(res.statusCode).toBe(204);
      expect(h.storage.used.alpha).toBe(0);
      expect(await onDisk()).toEqual([]);
    });
  });

  describe("refusals", () => {
    it("refuses a body over the largest file the path takes, before storing anything", async () => {
      const draft = await fresh();
      const res = await put(
        "images/huge.png",
        draft.draft_version,
        Buffer.alloc(5 * 1024 * 1024 + 1),
      );
      expect(res.statusCode).toBe(413);
      expect(code(res)).toBe("too_large");
      expect(await onDisk()).toEqual([]);
    });

    it("refuses paths outside the package rules or the folders it takes", async () => {
      const draft = await fresh();
      for (const path of [
        "images/../x.png",
        "images//x.png",
        "images/./x.png",
        "images/",
        "other/x.png",
        "/images/x.png",
        "images/x y.png",
        "css/theme.css",
        "templates/card.mustache",
        "embeds/drift/index.html",
        "fonts/LICENSE.txt",
      ]) {
        const res = await put(path, draft.draft_version, await png());
        expect([path, res.statusCode]).toEqual([path, 400]);
      }
      const missing = await h.app.inject({
        method: "PUT",
        url: "/api/theming/draft/file?path=images/a.png",
        headers: {
          host: "alpha.test",
          "x-forwarded-for": VENUE_IP,
          cookie: "canccu_session=admin",
        },
        payload: await png(),
      });
      expect(missing.statusCode).toBe(400);
    });

    it("answers no_draft, not_found, the right and the archive as every draft write does", async () => {
      expect(code(await put("images/a.png", 1, await png()))).toBe("no_draft");
      const draft = await fresh();
      expect((await remove("images/none.png", draft.draft_version)).statusCode).toBe(404);
      const member = await put("images/a.png", draft.draft_version, await png(), {
        session: "member",
      });
      expect(member.statusCode).toBe(403);
      const archived = await put("images/a.png", 1, await png(), { host: "archived.test" });
      expect(code(archived)).toBe("event_archived");
    });
  });
});
