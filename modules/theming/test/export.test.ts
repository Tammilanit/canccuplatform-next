/**
 * `GET /api/theming/revisions/{revision}/package` (contracts/theming.md, Reuse: series and export):
 * a revision as a package zip, the format of an upload, so it goes into another event unchanged.
 */
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { withTenant } from "@canccu/kit";
import { readPackage } from "../src/zip.js";
import { DATABASE_URL, code, get, send } from "./helpers.js";
import { draftFiles, png } from "./drafting.js";
import type { DraftBody } from "./drafting.js";
import { demoFiles, putPackage } from "./packaging.js";
import { packageZip } from "./zips.js";

describe.skipIf(!DATABASE_URL)("GET /api/theming/revisions/{revision}/package", () => {
  const d = draftFiles();

  /** The level-up demo, whole: CSS, templates, fonts, images, an embed and every layout. */
  async function publishDemo(host = "alpha.test"): Promise<Record<string, Buffer>> {
    const files = await demoFiles("level-up");
    const put = await putPackage(d.h, packageZip(files), { session: "embedder", host });
    expect(put.json<DraftBody>().problems.filter((p) => p.severity === "error")).toEqual([]);
    const published = await send(
      d.h,
      "POST",
      "/api/theming/draft/publish",
      { draft_version: put.json<DraftBody>().draft_version },
      { session: "embedder", host },
    );
    expect(published.statusCode).toBe(201);
    return files;
  }

  it("answers the revision as a zip an upload takes back unchanged", async () => {
    const files = await publishDemo();
    const res = await get(d.h, "/api/theming/revisions/1/package", { session: "admin" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="theme-1.zip"');
    expect(res.headers["cache-control"]).toBe("no-store");
    const read = await readPackage(res.rawPayload);
    if (!read.ok) throw new Error(read.why);
    const paths = [...read.files.keys()].sort();
    expect(paths).toEqual(Object.keys(files).sort());
    // Fonts, licences and embed scripts come back byte for byte; images as stored (re-encoded).
    for (const path of paths.filter((p) => /\.(woff2|txt|js|html)$/.test(p))) {
      expect(read.files.get(path)).toEqual(files[path]);
    }
    const revision = await get(d.h, "/api/theming/revisions/1", { session: "admin" });
    const manifest = parse(String(read.files.get("theme.yaml"))) as unknown;
    expect(manifest).toEqual(revision.json<{ manifest: unknown }>().manifest);

    // Into another event: the same manifest and paths, no problem.
    const upload = await putPackage(d.h, res.rawPayload, {
      session: "embedder",
      host: "beta.test",
    });
    expect(upload.statusCode).toBe(200);
    const body = upload.json<DraftBody & { manifest: unknown }>();
    expect(body.manifest).toEqual(manifest);
    expect(body.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(body.files?.map((f) => f.path).sort()).toEqual(paths.filter((p) => p !== "theme.yaml"));
  });

  it("is the theme right's, of the event's own revisions only", async () => {
    await publishDemo();
    const member = await get(d.h, "/api/theming/revisions/1/package", { session: "member" });
    expect(member.statusCode).toBe(403);
    const other = await get(d.h, "/api/theming/revisions/1/package", {
      session: "admin",
      host: "beta.test",
    });
    expect(other.statusCode).toBe(404);
    const unknown = await get(d.h, "/api/theming/revisions/9/package", { session: "admin" });
    expect(code(unknown)).toBe("not_found");
  });
});

describe.skipIf(!DATABASE_URL)("GET /api/theming/draft/package", () => {
  const d = draftFiles();

  /** The stored file of every draft path, by path: the same bytes give the same name. */
  const held = (host: string) =>
    withTenant(host.split(".")[0]!, () =>
      d.h.db.tenant(async (c) => {
        const { rows } = await c.query(
          `SELECT path, file FROM theming_package_files WHERE owner = 'draft' AND file IS NOT NULL
           UNION ALL SELECT 'embeds/' || embed || '/' || path, file FROM theming_embed_files
            WHERE owner = 'draft' ORDER BY 1`,
        );
        return rows as { path: string; file: string }[];
      }),
    );

  it("exports the draft as a zip that gives another event the same draft (the round trip)", async () => {
    // A preset with its schemes, the event's logo on a plate, a pair, roundness and a picture.
    const applied = await send(
      d.h,
      "PUT",
      "/api/theming/draft/preset",
      { preset: "level-up", scheme: "sunset" },
      { session: "embedder" },
    );
    expect(applied.statusCode).toBe(200);
    const up = await d.put(
      "images/hall.png",
      applied.json<DraftBody>().draft_version,
      await png("#223344", 64),
    );
    expect(up.statusCode).toBe(200);
    const brand = await send(d.h, "PUT", "/api/theming/draft/brand", {
      draft_version: up.json<DraftBody>().draft_version,
      primary: "#ff9a3c",
      accent: "#ff6fae",
      scheme: "dark",
      logo: "images/logo.svg",
      logo_plate: { kind: "dark", shape: "circle", padding: "large" },
      font_pair: "space-inter",
      roundness: "round",
      backdrop: { looks: ["glows", "waves"], image: "images/hall.png" },
    });
    expect(brand.statusCode).toBe(200);
    const draft = brand.json<{ draft: DraftBody & { manifest: Record<string, unknown> } }>().draft;
    expect(draft.manifest.schemes).toBeDefined();
    expect(draft.manifest.preset).toEqual({ id: "level-up", scheme: "sunset" });

    const res = await get(d.h, "/api/theming/draft/package", { session: "admin" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="theme-draft.zip"');
    expect(res.headers["cache-control"]).toBe("no-store");

    const upload = await putPackage(d.h, res.rawPayload, {
      session: "embedder",
      host: "beta.test",
    });
    expect(upload.statusCode).toBe(200);
    expect(upload.json<{ manifest: unknown }>().manifest).toEqual(draft.manifest);
    expect(await held("beta.test")).toEqual(await held("alpha.test"));
  });

  it("is the theme right's, and 404 without a draft", async () => {
    expect(code(await get(d.h, "/api/theming/draft/package", { session: "admin" }))).toBe(
      "no_draft",
    );
    await d.fresh();
    const member = await get(d.h, "/api/theming/draft/package", { session: "member" });
    expect(member.statusCode).toBe(403);
  });
});
