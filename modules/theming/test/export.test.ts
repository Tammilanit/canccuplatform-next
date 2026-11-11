/**
 * `GET /api/theming/revisions/{revision}/package` (contracts/theming.md, Reuse: series and export):
 * a revision as a package zip, the format of an upload, so it goes into another event unchanged.
 */
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { readPackage } from "../src/zip.js";
import { DATABASE_URL, code, get, send } from "./helpers.js";
import { draftFiles } from "./drafting.js";
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
