/**
 * Replace, revert and delete over HTTP: one undo version, files shared by content and removed
 * with their last reference, and the quota following them. Ported from the legacy
 * `asset-replace` and `asset-catalog` delete tests.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, call, code, fixture, harness, png, upload } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Asset {
  id: string;
  version: number;
  url: string;
  size_bytes: number;
  can_revert: boolean;
}

describe.skipIf(!DATABASE_URL)("asset versions", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  const admin = { host: "alpha.test", session: "admin" };
  const add = async (file: Buffer, name = "x.png") =>
    (await upload(h, "/api/screen/assets", file, name, admin)).json<Asset>();
  const replace = (id: string, file: Buffer, name = "x.png") =>
    upload(h, `/api/screen/assets/${id}/replace`, file, name, admin);
  const stored = () => readdirSync(join(h.filesRoot, "alpha", "screen", "files")).sort();
  const nameOf = (asset: Asset) => asset.url.split("/").at(-1) ?? "";
  const used = () => h.storage.used.alpha ?? 0;

  it("replaces a file and keeps the previous version for one undo", async () => {
    const v1 = await add(await png(10));
    const res = await replace(v1.id, await png(11));
    expect(res.statusCode).toBe(200);
    const v2 = res.json<Asset>();
    expect(v2).toMatchObject({ id: v1.id, version: 2, can_revert: true });
    expect(stored()).toEqual([nameOf(v1), nameOf(v2)].sort());
    expect(used()).toBe(v1.size_bytes + v2.size_bytes);
    expect(h.audits.at(-1)).toMatchObject({
      action: "screen.asset.replaced",
      changes: { version: { from: 1, to: 2 } },
    });

    // A second replace drops the oldest version, and its file with it.
    const v3 = (await replace(v1.id, await png(12))).json<Asset>();
    expect(v3.version).toBe(3);
    expect(stored()).toEqual([nameOf(v2), nameOf(v3)].sort());
    expect(used()).toBe(v2.size_bytes + v3.size_bytes);

    const reverted = await call(h, "POST", `/api/screen/assets/${v1.id}/revert`, admin);
    expect(reverted.json<Asset>()).toMatchObject({ version: 2, url: v2.url, can_revert: false });
    expect(stored()).toEqual([nameOf(v2)]);
    expect(used()).toBe(v2.size_bytes);
    const again = await call(h, "POST", `/api/screen/assets/${v1.id}/revert`, admin);
    expect(again.statusCode).toBe(409);
    expect(code(again)).toBe("nothing_to_revert");

    // Version numbers are never reused: renders are addressed by them.
    expect((await replace(v1.id, await png(13))).json<Asset>().version).toBe(4);
    await call(h, "DELETE", `/api/screen/assets/${v1.id}`, admin);
  });

  it("replaces only with the same kind, and never a link", async () => {
    const image = await add(await png(20));
    const video = await replace(image.id, fixture("clip-h264-faststart.mp4"), "clip.mp4");
    expect(video.statusCode).toBe(400);
    expect(video.json<{ error: { message: string } }>().error.message).toBe(
      "This asset is an image; replace it with an image, not a video.",
    );
    const link = await call(h, "POST", "/api/screen/assets", {
      ...admin,
      body: { kind: "youtube", url: "https://youtu.be/dQw4w9WgXcQ", title: "t" },
    });
    const onLink = await replace(link.json<Asset>().id, await png(21));
    expect(code(onLink)).toBe("invalid_request");
    expect(code(await replace("as_missing", await png(21)))).toBe("not_found");
    // Nothing of the refused replaces stayed behind.
    expect(stored()).toEqual([nameOf(image)]);
    expect(readdirSync(join(h.filesRoot, "alpha", "screen", "tmp"))).toEqual([]);
    await call(h, "DELETE", `/api/screen/assets/${image.id}`, admin);
    await call(h, "DELETE", `/api/screen/assets/${link.json<Asset>().id}`, admin);
  });

  it("deletes a file only with its last reference, also a kept undo version", async () => {
    const a = await add(await png(30));
    const b = await add(await png(31));
    await replace(b.id, await png(30));
    expect(stored()).toEqual([nameOf(a), nameOf(b)].sort());

    expect((await call(h, "DELETE", `/api/screen/assets/${a.id}`, admin)).statusCode).toBe(204);
    // b's current version is a's bytes: the file stays, counted once.
    expect(stored()).toEqual([nameOf(a), nameOf(b)].sort());
    expect(used()).toBe(a.size_bytes + b.size_bytes);
    expect(h.audits.at(-1)).toMatchObject({ action: "screen.asset.deleted", target: { id: a.id } });

    await call(h, "DELETE", `/api/screen/assets/${b.id}`, admin);
    expect(stored()).toEqual([]);
    expect(used()).toBe(0);
    expect((await call(h, "DELETE", `/api/screen/assets/${b.id}`, admin)).statusCode).toBe(404);
  });

  it("refuses to delete the asset screens fall back to (asset_in_use)", async () => {
    const asset = await add(await png(40));
    h.settings.alpha = { ready_fallback_asset_id: asset.id };
    const res = await call(h, "DELETE", `/api/screen/assets/${asset.id}`, admin);
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("asset_in_use");
    h.settings.alpha = {};
    expect((await call(h, "DELETE", `/api/screen/assets/${asset.id}`, admin)).statusCode).toBe(204);
  });

  it("keeps one file and one count when the same new bytes arrive at once", async () => {
    const bytes = await png(50);
    const [x, y] = await Promise.all([add(bytes), add(bytes)]);
    expect(x.url).toBe(y.url);
    expect(stored()).toEqual([nameOf(x)]);
    expect(used()).toBe(x.size_bytes);
    await Promise.all([
      call(h, "DELETE", `/api/screen/assets/${x.id}`, admin),
      call(h, "DELETE", `/api/screen/assets/${y.id}`, admin),
    ]);
    expect(stored()).toEqual([]);
    expect(used()).toBe(0);
  });

  it("gives back reserved bytes and the file when the audit fails", async () => {
    h.failAudit.next = true;
    const res = await upload(h, "/api/screen/assets", await png(60), "x.png", admin);
    expect(res.statusCode).toBe(503);
    expect(stored()).toEqual([]);
    expect(used()).toBe(0);
  });

  it("keeps each event's assets and files to itself", async () => {
    const asset = await add(await png(70));
    const beta = { host: "beta.test", session: "admin" };
    expect(
      (await call(h, "PATCH", `/api/screen/assets/${asset.id}`, { ...beta, body: { title: "x" } }))
        .statusCode,
    ).toBe(404);
    expect((await call(h, "DELETE", `/api/screen/assets/${asset.id}`, beta)).statusCode).toBe(404);
    expect((await call(h, "GET", "/api/screen/assets", beta)).json()).toEqual({
      assets: [],
      next_cursor: null,
    });
    // The same bytes in another event are its own file and its own count.
    const theirs = (
      await upload(h, "/api/screen/assets", await png(70), "x.png", beta)
    ).json<Asset>();
    expect(theirs.url).toBe(asset.url);
    expect(h.storage.used.beta).toBe(theirs.size_bytes);
    expect(existsSync(join(h.filesRoot, "beta", "screen", "files", nameOf(theirs)))).toBe(true);
  });
});
