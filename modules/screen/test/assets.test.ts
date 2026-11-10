/**
 * The asset library over HTTP, on a real Postgres: uploads checked by content, links, the list,
 * name-check, edits and serving files. Ported in spirit from the legacy `asset-upload`,
 * `asset-catalog`, `web-asset` and `youtube-asset` tests, against the contract's paths.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TENANTS,
  DATABASE_URL,
  call,
  code,
  context,
  fixture,
  harness,
  pairDevice,
  png,
  upload,
} from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Asset {
  id: string;
  kind: string;
  title: string;
  version: number;
  url: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  health: string;
  health_message: string | null;
  can_revert: boolean;
}

describe.skipIf(!DATABASE_URL)("assets", () => {
  let h: Harness;
  beforeAll(async () => {
    TENANTS["theta.test"] = context("theta", { flags: { "screen.web": false } });
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  const admin = (host = "alpha.test") => ({ host, session: "admin" });
  const add = async (file: Buffer, name: string, extra: Record<string, string> = {}) =>
    upload(h, "/api/screen/assets", file, name, { ...admin(), ...extra });
  const tmpFiles = (tenant = "alpha") => {
    const dir = join(h.filesRoot, tenant, "screen", "tmp");
    return existsSync(dir) ? readdirSync(dir) : [];
  };

  it("stores an image by its content, counts it against the quota and audits it", async () => {
    const res = await add(await png(1), "Welcome.PNG");
    expect(res.statusCode).toBe(201);
    const asset = res.json<Asset>();
    expect(asset).toMatchObject({
      kind: "image",
      title: "Welcome.PNG",
      version: 1,
      mime_type: "image/png",
      health: "ok",
      can_revert: false,
    });
    expect(asset.url).toMatch(/^\/api\/screen\/files\/[a-f0-9]{64}\.png$/);
    const name = asset.url.split("/").at(-1) ?? "";
    expect(existsSync(join(h.filesRoot, "alpha", "screen", "files", name))).toBe(true);
    expect(h.storage.used.alpha).toBe(asset.size_bytes);
    expect(tmpFiles()).toEqual([]);
    expect(h.audits.at(-1)).toMatchObject({
      tenant_id: "alpha",
      actor_user_id: "u_admin",
      action: "screen.asset.added",
      target: { type: "asset", id: asset.id },
    });
  });

  it("keeps identical bytes once: one file, one count", async () => {
    const before = h.storage.used.alpha ?? 0;
    const first = (await add(await png(2), "a.png")).json<Asset>();
    const second = (await add(await png(2), "b.png", { title: "Same picture" })).json<Asset>();
    expect(second.id).not.toBe(first.id);
    expect(second.url).toBe(first.url);
    expect(second.title).toBe("Same picture");
    expect(h.storage.used.alpha).toBe(before + (first.size_bytes ?? 0));
  });

  it("reads video and sound length from the file and refuses what screens cannot play", async () => {
    const video = await add(fixture("clip-h264-aac.mp4"), "clip.mp4");
    expect(video.json<Asset>()).toMatchObject({ kind: "video", mime_type: "video/mp4" });
    expect(video.json<Asset>().duration_seconds).toBeCloseTo(2, 1);
    const sound = await add(fixture("sound.ogg"), "ding.ogg");
    expect(sound.json<Asset>()).toMatchObject({ kind: "audio", mime_type: "audio/ogg" });

    const mov = await add(fixture("clip-prores.mov"), "clip.mp4");
    expect(mov.statusCode).toBe(400);
    expect(mov.json()).toEqual({
      error: {
        code: "media_unsupported",
        message: "This file is QuickTime with ProRes video. Export it as MP4 (H.264).",
      },
    });
    expect(code(await add(fixture("sound-long.mp3"), "long.mp3"))).toBe("invalid_request");
    expect(code(await add(Buffer.from("<html><script>x</script>"), "image.png"))).toBe(
      "invalid_request",
    );
    expect(code(await add(Buffer.alloc(0), "empty.png"))).toBe("invalid_request");
    expect(tmpFiles()).toEqual([]);
  });

  it("refuses a file over 100 MiB with 413 file_too_large and keeps nothing", async () => {
    const big = Buffer.alloc(100 * 1024 * 1024 + 1);
    const res = await add(big, "big.mp4");
    expect(res.statusCode).toBe(413);
    expect(code(res)).toBe("file_too_large");
    expect(tmpFiles()).toEqual([]);
  });

  it("refuses an upload over the event's quota with the code tenants gave, storing nothing", async () => {
    h.storage.quota.beta = 10;
    const res = await add(await png(3), "x.png", { host: "beta.test" });
    expect(res.statusCode).toBe(413);
    expect(code(res)).toBe("storage_quota_exceeded");
    expect(h.storage.used.beta ?? 0).toBe(0);
    expect(existsSync(join(h.filesRoot, "beta", "screen", "files"))).toBe(false);
    expect(tmpFiles("beta")).toEqual([]);
    expect((await call(h, "GET", "/api/screen/assets", admin("beta.test"))).json()).toEqual({
      assets: [],
      next_cursor: null,
    });
  });

  it("needs screen.content.write to add, and refuses an archived event", async () => {
    const asContent = await upload(h, "/api/screen/assets", await png(4), "x.png", {
      session: "content",
    });
    expect(asContent.statusCode).toBe(403);
    const archived = await add(await png(4), "x.png", { host: "gamma.test" });
    expect(code(archived)).toBe("event_archived");
  });

  it("adds a web page only from an origin on web_allowlist", async () => {
    h.settings.alpha = { web_allowlist: ["https://info.example"] };
    const ok = await call(h, "POST", "/api/screen/assets", {
      ...admin(),
      body: { kind: "web", url: "https://info.example/today", title: "Today" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json<Asset>()).toMatchObject({ kind: "web", url: "https://info.example/today" });
    const off = await call(h, "POST", "/api/screen/assets", {
      ...admin(),
      body: { kind: "web", url: "https://elsewhere.example/", title: "No" },
    });
    expect(code(off)).toBe("origin_not_allowed");
  });

  it("normalises a YouTube link, records what oEmbed said and resets on request", async () => {
    h.oembedStatus.value = 404;
    const res = await call(h, "POST", "/api/screen/assets", {
      ...admin(),
      body: { kind: "youtube", url: "https://youtu.be/dQw4w9WgXcQ?t=5", title: "Trailer" },
    });
    const asset = res.json<Asset>();
    expect(asset).toMatchObject({ kind: "youtube", health: "error" });
    expect(asset.url).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=5&autoplay=1&rel=0&enablejsapi=1",
    );
    const reset = await call(h, "PATCH", `/api/screen/assets/${asset.id}`, {
      ...admin(),
      body: { reset_health: true, title: "Trailer 2" },
    });
    expect(reset.json<Asset>()).toMatchObject({
      health: "ok",
      health_message: null,
      title: "Trailer 2",
    });
    expect(h.audits.at(-1)).toMatchObject({
      action: "screen.asset.changed",
      changes: { title: { from: "Trailer", to: "Trailer 2" }, health: { from: "error", to: "ok" } },
    });
    h.oembedStatus.value = 200;
  });

  it("refuses web and YouTube assets while screen.web is off", async () => {
    const res = await call(h, "POST", "/api/screen/assets", {
      host: "theta.test",
      session: "admin",
      body: { kind: "youtube", url: "https://youtu.be/dQw4w9WgXcQ", title: "x" },
    });
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe("feature_off");
  });

  it("lists newest first in pages, searching titles literally and by kind", async () => {
    for (let i = 0; i < 52; i += 1) {
      await call(h, "POST", "/api/screen/assets", {
        host: "eps.test",
        session: "admin",
        body: {
          kind: "youtube",
          url: "https://youtu.be/dQw4w9WgXcQ",
          title: `Clip ${i}${i === 7 ? " 100%" : ""}`,
        },
      });
    }
    const list = (query: string) =>
      call(h, "GET", `/api/screen/assets${query}`, { host: "eps.test", session: "content" });
    const first = (await list("")).json<{ assets: Asset[]; next_cursor: string }>();
    expect(first.assets).toHaveLength(50);
    expect(first.assets[0]?.title).toBe("Clip 51");
    const second = (await list(`?cursor=${first.next_cursor}`)).json<{
      assets: Asset[];
      next_cursor: null;
    }>();
    expect(second.assets.map((a) => a.title)).toEqual(["Clip 1", "Clip 0"]);
    expect(second.next_cursor).toBeNull();
    const percent = (await list("?q=100%25")).json<{ assets: Asset[] }>();
    expect(percent.assets.map((a) => a.title)).toEqual(["Clip 7 100%"]);
    expect((await list("?kind=image")).json<{ assets: Asset[] }>().assets).toEqual([]);
    expect(code(await list("?cursor=nonsense"))).toBe("invalid_request");
    expect(
      (await call(h, "GET", "/api/screen/assets", { host: "eps.test", session: "nobody" }))
        .statusCode,
    ).toBe(403);
  });

  it("finds same-title assets before an upload, in any case", async () => {
    const res = await call(h, "POST", "/api/screen/assets/name-check", {
      ...admin(),
      body: { names: ["welcome.png", "Nothing.png"] },
    });
    const [welcome, nothing] = res.json<{ results: { name: string; asset_ids: string[] }[] }>()
      .results;
    expect(welcome).toMatchObject({ name: "welcome.png" });
    expect(welcome?.asset_ids).toHaveLength(1);
    expect(nothing).toEqual({ name: "Nothing.png", asset_ids: [] });
  });

  it("serves a file to sessions with screen.content.read and the event's devices only", async () => {
    const asset = (await add(await png(5), "serve.png")).json<Asset>();
    const get = (c: Parameters<typeof call>[3]) => call(h, "GET", asset.url, c);
    const res = await get({ session: "content" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.rawPayload.length).toBe(asset.size_bytes);
    const part = await h.app.inject({
      method: "GET",
      url: asset.url,
      headers: {
        host: "alpha.test",
        "x-forwarded-for": "10.0.0.5",
        cookie: "canccu_session=admin",
        range: "bytes=0-7",
      },
    });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 0-7/${asset.size_bytes}`);
    expect(part.rawPayload.subarray(1, 4).toString()).toBe("PNG");

    expect((await get({ session: "nobody" })).statusCode).toBe(403);
    expect((await get({})).statusCode).toBe(401);
    expect((await get({ host: "beta.test", session: "admin" })).statusCode).toBe(404);
    const device = await pairDevice(h);
    expect((await get({ cookies: { canccu_device: device.token } })).statusCode).toBe(200);
    expect(
      (await get({ cookies: { canccu_device: device.token }, ip: "192.0.2.9" })).statusCode,
    ).toBe(403);
    expect((await get({ cookies: { canccu_device: "forged" }, session: "admin" })).statusCode).toBe(
      401,
    );
    const unknown = `/api/screen/files/${"0".repeat(64)}.png`;
    expect((await call(h, "GET", unknown, admin())).statusCode).toBe(404);
  });
});
