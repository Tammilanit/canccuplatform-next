/**
 * `PUT` and `DELETE /api/theming/draft/file?path=` (contracts/theming.md, Draft, preview, publish):
 * what an upload that passes or fails its checks leaves on the draft.
 */
import { describe, expect, it } from "vitest";
import { DATABASE_URL, code, get, send } from "./helpers.js";
import { SCRIPTED, draftFiles, png, woff2 } from "./drafting.js";
import type { DraftBody } from "./drafting.js";

describe.skipIf(!DATABASE_URL)("draft files", () => {
  const d = draftFiles();
  const { fresh, put, remove, fileAt, onDisk, storedBytes } = d;

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
      expect(d.h.storage.used.alpha).toBe(await storedBytes());
      const served = await get(d.h, `/theming/draft/${name}`, { session: "admin" });
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-type"]).toBe("image/png");
      expect(served.headers["x-content-type-options"]).toBe("nosniff");
      // Another event never reaches it.
      const other = await get(d.h, `/theming/draft/${name}`, {
        host: "beta.test",
        session: "admin",
      });
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
      expect(d.h.storage.used.alpha).toBe(await storedBytes());
    });

    it("counts the same bytes once, however many paths hold them", async () => {
      const draft = await fresh();
      const bytes = await png();
      await put("images/a.png", draft.draft_version, bytes);
      await put("images/b.png", draft.draft_version + 1, bytes);
      const once = d.h.storage.used.alpha;
      expect(once).toBe(await storedBytes());
      const res = await remove("images/a.png", draft.draft_version + 2);
      expect(res.statusCode).toBe(200);
      expect(d.h.storage.used.alpha).toBe(once);
      await remove("images/b.png", draft.draft_version + 3);
      expect(d.h.storage.used.alpha).toBe(0);
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
      expect(d.h.storage.used.alpha ?? 0).toBe(0);

      // The problem stays through other edits, and publishing refuses the draft.
      const edit = await send(d.h, "PATCH", "/api/theming/draft/tokens", {
        draft_version: body.draft_version,
        tokens: { motion: "calm" },
      });
      expect(edit.json<DraftBody>().problems.map((p) => p.code)).toContain("svg_forbidden");
      const refused = await send(d.h, "POST", "/api/theming/draft/publish", {
        draft_version: body.draft_version + 1,
      });
      expect(refused.statusCode).toBe(422);
      expect(code(refused)).toBe("theme_invalid");

      const cleared = await remove("images/logo.svg", body.draft_version + 1);
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json<DraftBody>().problems.map((p) => p.code)).not.toContain("svg_forbidden");
      const published = await send(d.h, "POST", "/api/theming/draft/publish", {
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
      expect(d.h.storage.used.alpha).toBe(0);
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
});
