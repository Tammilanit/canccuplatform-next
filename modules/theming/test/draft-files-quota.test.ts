/**
 * Draft files and the storage quota (contracts/tenants.md, Storage quota): bytes reserved before
 * they are written, given back when the file goes or the write rolls back; and the refusals.
 */
import { describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import { fileName } from "../src/files.js";
import { checkFile } from "../src/uploads.js";
import { DATABASE_URL, VENUE_IP, code, get, send } from "./helpers.js";
import { draftFiles, png } from "./drafting.js";
import type { DraftBody } from "./drafting.js";

describe.skipIf(!DATABASE_URL)("draft files and the quota", () => {
  const d = draftFiles();
  const { fresh, put, remove, fileAt, onDisk, storedBytes } = d;

  describe("the storage quota", () => {
    it("refuses an upload that would pass it, with tenants' code, and changes nothing", async () => {
      const draft = await fresh();
      d.h.storage.quota.alpha = 10;
      const res = await put("images/logo.png", draft.draft_version, await png());
      expect(res.statusCode).toBe(413);
      expect(code(res)).toBe("storage_quota_exceeded");
      expect(await onDisk()).toEqual([]);
      expect(await storedBytes()).toBe(0);
      const after = await get(d.h, "/api/theming/draft", { session: "admin" });
      expect(after.json<DraftBody>().draft_version).toBe(draft.draft_version);
    });

    it("gets the bytes back, and the file is gone, when the write rolls back after placing it", async () => {
      const draft = await fresh();
      const res = await put("images/fails.png", draft.draft_version, await png());
      expect(res.statusCode).toBe(500);
      expect(d.h.storage.used.alpha ?? 0).toBe(0);
      expect(await onDisk()).toEqual([]);
      expect(await storedBytes()).toBe(0);
    });

    it("reserves nothing for a stale draft_version", async () => {
      const draft = await fresh();
      const res = await put("images/logo.png", draft.draft_version + 5, await png());
      expect(res.statusCode).toBe(409);
      expect(code(res)).toBe("version_conflict");
      expect(d.h.storage.used.alpha ?? 0).toBe(0);
      expect(await onDisk()).toEqual([]);
    });

    it("reports images changed when a file only moves to another path", async () => {
      const draft = await fresh();
      const bytes = await png();
      await put("images/a.png", draft.draft_version, bytes);
      await send(d.h, "POST", "/api/theming/draft/publish", {
        draft_version: draft.draft_version + 1,
      });
      const again = (
        await send(d.h, "POST", "/api/theming/draft", { from: "current" })
      ).json<DraftBody>();
      await put("images/b.png", again.draft_version, bytes);
      await remove("images/a.png", again.draft_version + 1);
      const res = await send(d.h, "POST", "/api/theming/draft/publish", {
        draft_version: again.draft_version + 2,
      });
      expect(res.statusCode).toBe(201);
      expect(d.h.events("alpha").at(-1)?.data.changed).toEqual(["images"]);
    });

    it("keeps a file a revision holds when the draft lets go of it", async () => {
      const draft = await fresh();
      await put("images/logo.png", draft.draft_version, await png());
      const published = await send(d.h, "POST", "/api/theming/draft/publish", {
        draft_version: draft.draft_version + 1,
      });
      expect(published.statusCode).toBe(201);
      const name = await fileAt("images/logo.png", "r:1");
      expect(name).toMatch(/\.png$/);
      const again = await send(d.h, "POST", "/api/theming/draft", { from: "current" });
      expect(again.json<DraftBody>().files).toEqual([
        { path: "images/logo.png", bytes: expect.any(Number) as number },
      ]);
      const res = await remove("images/logo.png", again.json<DraftBody>().draft_version);
      expect(res.statusCode).toBe(200);
      expect(await onDisk()).toContain(name);
      const served = await get(d.h, `/theming/a/${name}`);
      expect(served.statusCode).toBe(200);
    });

    it("gets back the bytes of the files only a discarded draft held", async () => {
      const draft = await fresh();
      await put("images/logo.png", draft.draft_version, await png());
      expect(d.h.storage.used.alpha).toBeGreaterThan(0);
      const res = await send(
        d.h,
        "DELETE",
        `/api/theming/draft?draft_version=${draft.draft_version + 1}`,
      );
      expect(res.statusCode).toBe(204);
      expect(d.h.storage.used.alpha).toBe(0);
      expect(await onDisk()).toEqual([]);
    });
  });

  describe("bytes an embed holds", () => {
    it("are reserved once, and the theme's row goes with the draft that held both", async () => {
      const draft = await fresh();
      const checked = await checkFile("images/logo.png", await png());
      if (!checked.ok) throw new Error("the fixture must pass");
      const name = fileName(checked.bytes, "png");
      await withTenant("alpha", () =>
        d.h.db.tenant((c) =>
          c.query(
            `INSERT INTO theming_embed_files (owner, embed, path, file, bytes, entry)
             VALUES ('draft', 'e', 'logo.png', $1, $2, false)`,
            [name, checked.bytes.length],
          ),
        ),
      );
      const res = await put("images/logo.png", draft.draft_version, await png());
      expect(res.statusCode).toBe(200);
      expect(await fileAt("images/logo.png")).toBe(name);
      expect(d.h.storage.used.alpha ?? 0).toBe(0);
      const gone = await send(
        d.h,
        "DELETE",
        `/api/theming/draft?draft_version=${draft.draft_version + 1}`,
      );
      expect(gone.statusCode).toBe(204);
      expect(await storedBytes()).toBe(0);
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
      const missing = await d.h.app.inject({
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
