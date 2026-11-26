/**
 * Video backgrounds (contracts/theming.md, The theme package and The two backgrounds; plan
 * issue-784 D19): MP4 and WebM by content, at most 20 MB and one a theme, served like images, and
 * a video backdrop only over its picture, which is its poster.
 */
import { describe, expect, it } from "vitest";
import { schemaErrors } from "../src/schema.js";
import { checkUpload } from "../src/uploads.js";
import { draftFiles, png } from "./drafting.js";
import type { DraftBody } from "./drafting.js";
import { mp4, webm } from "./videos.js";
import { DATABASE_URL, get, send } from "./helpers.js";

const MB = 1024 * 1024;
const codeOf = (c: Awaited<ReturnType<typeof checkUpload>>): string | undefined =>
  c.ok ? undefined : c.problem.code;

describe("a video upload", () => {
  it("takes an MP4 or a WebM by its content", async () => {
    const a = await checkUpload("videos/loop.mp4", mp4());
    expect(a.ok && a.ext).toBe("mp4");
    const b = await checkUpload("videos/loop.webm", webm());
    expect(b.ok && b.ext).toBe("webm");
  });

  it("refuses HTML named .mp4, a WebM named .mp4 and another brand", async () => {
    expect(codeOf(await checkUpload("videos/x.mp4", Buffer.from("<html><script>1</script>")))).toBe(
      "file_type",
    );
    expect(codeOf(await checkUpload("videos/x.mp4", webm()))).toBe("file_type");
    const qt = mp4();
    qt.write("qt  ", 8, "latin1");
    qt.write("qt  qt  ", 16, "latin1");
    expect(codeOf(await checkUpload("videos/x.mp4", qt))).toBe("file_type");
    expect(codeOf(await checkUpload("videos/x.mov", mp4()))).toBe("file_type");
  });

  it("refuses 20 MB and a byte", async () => {
    expect((await checkUpload("videos/x.mp4", mp4(20 * MB - 32))).ok).toBe(true);
    expect(codeOf(await checkUpload("videos/x.mp4", mp4(20 * MB - 31)))).toBe("file_too_large");
  });

  it("needs the picture as the video's poster", () => {
    const manifest = (backdrop: Record<string, unknown>) => ({
      name: "Video",
      platform: ">=0.1",
      mode: "simple",
      brand: { primary: "#3ddcff", accent: "#b98cff", scheme: "dark", backdrop },
    });
    expect(schemaErrors(manifest({ video: "videos/loop.mp4" })).length).toBeGreaterThan(0);
    expect(schemaErrors(manifest({ video: "videos/loop.mp4", image: "images/still.png" }))).toEqual(
      [],
    );
    expect(schemaErrors(manifest({ video: "images/loop.mp4", image: "images/still.png" })).length)
      .toBeGreaterThan(0); // prettier-ignore
  });
});

describe.skipIf(!DATABASE_URL)("a video in the draft", () => {
  const t = draftFiles();

  it("takes one video, keeps the mode, and makes a second a problem", async () => {
    const fresh = await t.fresh();
    const one = await t.put("videos/a.mp4", fresh.draft_version, mp4());
    expect(one.statusCode).toBe(200);
    expect(one.json<DraftBody>().mode).toBe("simple");
    expect(one.json<DraftBody>().problems).toEqual([]);
    const two = await t.put("videos/b.webm", one.json<DraftBody>().draft_version, webm());
    expect(two.json<DraftBody>().problems).toContainEqual(
      expect.objectContaining({ severity: "error", code: "file_too_large", path: "videos/b.webm" }),
    );
  });

  it("takes a video of 20 MB, above the 5 MB of other files", async () => {
    const fresh = await t.fresh();
    const big = await t.put("videos/a.mp4", fresh.draft_version, mp4(20 * MB - 32));
    expect(big.statusCode).toBe(200);
    expect(big.json<DraftBody>().problems).toEqual([]);
    const image = await t.put("images/x.png", big.json<DraftBody>().draft_version, mp4(6 * MB));
    expect(image.statusCode).toBe(413);
  });

  it("serves it with nosniff, same-origin CORP and inline, and sets it as the backdrop", async () => {
    const fresh = await t.fresh();
    const video = await t.put("videos/a.mp4", fresh.draft_version, mp4());
    const still = await t.put(
      "images/still.png",
      video.json<DraftBody>().draft_version,
      await png("#223344", 16),
    );
    const name = await t.fileAt("videos/a.mp4");
    expect(name).toMatch(/^[0-9a-f]{64}\.mp4$/);
    const res = await get(t.h, `/theming/draft/${name}`, { session: "admin" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(res.headers["content-disposition"]).toBe("inline");

    const brand = await send(t.h, "PUT", "/api/theming/draft/brand", {
      draft_version: still.json<DraftBody>().draft_version,
      primary: "#3ddcff",
      accent: "#b98cff",
      scheme: "dark",
    });
    const parts = await send(t.h, "PATCH", "/api/theming/draft/parts", {
      draft_version: brand.json<{ draft: DraftBody }>().draft.draft_version,
      backdrop_image: "images/still.png",
      backdrop_video: "videos/a.mp4",
    });
    expect(parts.statusCode).toBe(200);
    const set = parts.json<DraftBody & { manifest: { brand: { backdrop: unknown } } }>();
    expect(set.manifest.brand.backdrop).toEqual({
      image: "images/still.png",
      video: "videos/a.mp4",
    });
    expect(set.problems.filter((p) => p.severity === "error")).toEqual([]);
    const published = await send(t.h, "POST", "/api/theming/draft/publish", {
      draft_version: set.draft_version,
    });
    expect(published.statusCode).toBe(201);
    const current = await get(t.h, "/api/theming/current", { session: "admin" });
    const backdrop = current.json<{ backdrop: { video_url?: string; image_url?: string } }>()
      .backdrop;
    expect(backdrop.video_url).toBe(`/theming/a/${name}`);
    expect(backdrop.image_url).toMatch(/^\/theming\/a\/[0-9a-f]{64}\.png$/);
    const served = await get(t.h, backdrop.video_url ?? "");
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("video/mp4");
  });

  it("refuses a video backdrop without its picture", async () => {
    const fresh = await t.fresh();
    const video = await t.put("videos/a.mp4", fresh.draft_version, mp4());
    const brand = await send(t.h, "PUT", "/api/theming/draft/brand", {
      draft_version: video.json<DraftBody>().draft_version,
      primary: "#3ddcff",
      accent: "#b98cff",
      scheme: "dark",
    });
    const parts = await send(t.h, "PATCH", "/api/theming/draft/parts", {
      draft_version: brand.json<{ draft: DraftBody }>().draft.draft_version,
      backdrop_video: "videos/a.mp4",
    });
    expect(parts.statusCode).toBe(200);
    expect(parts.json<DraftBody>().problems).toContainEqual(
      expect.objectContaining({ severity: "error", code: "schema" }),
    );
  });
});
