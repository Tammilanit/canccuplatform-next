/**
 * The photo carousel's API on Postgres: uploads of images only, stored as the event's files,
 * newest first, a source's message once, removal with the file, and a deleted user's photos.
 * Ported from the API part of the legacy `carousel-api` tests (adapted: one photo per request,
 * rights and the flag instead of a bearer token, no designated playlist).
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { KitError, withTenant } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteUserPhotos } from "../src/photos.js";
import {
  DATABASE_URL,
  TENANTS,
  call,
  code,
  context,
  events,
  fixture,
  harness,
  png,
  upload,
} from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Photo {
  id: string;
  url: string;
  caption: string | null;
  author_name: string | null;
  author_user_id: string | null;
  posted_at: string;
  featured: boolean;
}

const HOST = "iota.test";
const POSTED = "2026-01-01T11:59:00.000Z";

describe.skipIf(!DATABASE_URL)("photos", () => {
  let h: Harness;
  beforeAll(async () => {
    TENANTS[HOST] = context("iota", { flags: { "screen.photos": true } });
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  const add = (
    file: Buffer,
    fields: Record<string, string> = {},
    session = "photos",
    host = HOST,
  ) =>
    upload(h, "/api/screen/photos", file, "party.png", {
      host,
      session,
      fields: { posted_at: POSTED, ...fields },
    });
  const list = async () =>
    (await call(h, "GET", "/api/screen/photos", { host: HOST, session: "content" })).json<{
      photos: Photo[];
    }>().photos;
  const stored = (url: string) =>
    existsSync(join(h.filesRoot, "iota", "screen", "files", url.split("/").at(-1) ?? ""));
  const tmpFiles = () => {
    const dir = join(h.filesRoot, "iota", "screen", "tmp");
    return existsSync(dir) ? readdirSync(dir) : [];
  };

  it("is off unless the event turns the carousel on", async () => {
    const res = await add(await png(1), {}, "admin", "alpha.test");
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe("feature_off");
    const read = await call(h, "GET", "/api/screen/photos", { session: "admin" });
    expect(code(read)).toBe("feature_off");
    expect(h.storage.used.alpha ?? 0).toBe(0);
  });

  it("needs the photos right to add and the content right to list", async () => {
    expect((await add(await png(1), {}, "content")).statusCode).toBe(403);
    expect(
      (await call(h, "GET", "/api/screen/photos", { host: HOST, session: "photos" })).statusCode,
    ).toBe(403);
  });

  it("stores a photo as the event's file, featured, and announces it", async () => {
    const res = await add(await png(1), {
      caption: "  Finals crowd  ",
      author_name: "Sam",
      author_user_id: "u_sam",
      source_ref: "msg-1",
    });
    expect(res.statusCode).toBe(201);
    const photo = res.json<Photo>();
    expect(photo).toEqual({
      id: expect.stringMatching(/^ph_/) as string,
      url: expect.stringMatching(/^\/api\/screen\/files\/[a-f0-9]{64}\.png$/) as string,
      caption: "Finals crowd",
      author_name: "Sam",
      author_user_id: "u_sam",
      posted_at: POSTED,
      featured: true,
    });
    expect(stored(photo.url)).toBe(true);
    expect(h.storage.used.iota).toBeGreaterThan(0);
    expect(tmpFiles()).toEqual([]);
    expect(events(h, "screen.photo.added", "iota")).toEqual([
      { photo_id: photo.id, actor_user_id: "u_photos" },
    ]);
    const served = await call(h, "GET", photo.url, { host: HOST, session: "content" });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
  });

  it("leaves the optional fields empty", async () => {
    const res = await add(await png(2));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ caption: null, author_name: null, author_user_id: null });
  });

  it("refuses anything but a photo with its fields in bounds", async () => {
    const used = h.storage.used.iota;
    for (const fields of [
      { posted_at: "" },
      { posted_at: "yesterday" },
      { caption: "x".repeat(201) },
      { author_name: "x".repeat(81) },
      { source_ref: "x".repeat(65) },
      { title: "not a photo field" },
    ]) {
      const res = await add(await png(3), fields);
      expect(res.statusCode, JSON.stringify(fields)).toBe(400);
      expect(code(res)).toBe("invalid_request");
    }
    const video = await add(fixture("clip-h264-aac.mp4"));
    expect(video.statusCode).toBe(400);
    expect(video.json<{ error: { message: string } }>().error.message).toMatch(/JPEG or PNG/);
    expect(h.storage.used.iota).toBe(used);
    expect(tmpFiles()).toEqual([]);
  });

  it("adds a source's message once", async () => {
    const used = h.storage.used.iota;
    const res = await add(await png(4), { source_ref: "msg-1" });
    expect(res.statusCode).toBe(409);
    expect(code(res)).toBe("photo_exists");
    expect(h.storage.used.iota).toBe(used);
    expect(tmpFiles()).toEqual([]);
  });

  it("lists the photos newest first", async () => {
    h.clock.now += 1000;
    const newest = (await add(await png(5), { caption: "Newest" })).json<Photo>();
    const photos = await list();
    expect(photos).toHaveLength(3);
    expect(photos[0]).toEqual(newest);
    expect(photos.map((p) => p.caption)).toEqual(["Newest", null, "Finals crowd"]);
  });

  it("removes a photo with its file, and announces it", async () => {
    const photo = (await add(await png(6))).json<Photo>();
    const used = h.storage.used.iota ?? 0;
    const res = await call(h, "DELETE", `/api/screen/photos/${photo.id}`, {
      host: HOST,
      session: "photos",
    });
    expect(res.statusCode).toBe(204);
    expect(stored(photo.url)).toBe(false);
    expect(h.storage.used.iota).toBeLessThan(used);
    expect(events(h, "screen.photo.removed", "iota").at(-1)).toEqual({
      photo_id: photo.id,
      actor_user_id: "u_photos",
    });
    const again = await call(h, "DELETE", `/api/screen/photos/${photo.id}`, {
      host: HOST,
      session: "photos",
    });
    expect(again.statusCode).toBe(404);
  });

  it("takes a photo down while tenants is down, and leaves its bytes to the recount", async () => {
    const photo = (await add(await png(16))).json<Photo>();
    const used = h.storage.used.iota ?? 0;
    const release = h.quota.release.bind(h.quota);
    h.quota.release = () =>
      Promise.reject(
        new KitError("the storage quota is unreachable", {
          status: 503,
          code: "tenants_unavailable",
        }),
      );
    try {
      const res = await call(h, "DELETE", `/api/screen/photos/${photo.id}`, {
        host: HOST,
        session: "photos",
      });
      expect(res.statusCode).toBe(204);
    } finally {
      h.quota.release = release;
    }
    expect((await list()).map((p) => p.id)).not.toContain(photo.id);
    expect(stored(photo.url)).toBe(false);
    // Still counted: the safe direction, until the storage upkeep's recount.
    expect(h.storage.used.iota).toBe(used);
  });

  it("keeps a file an asset still uses", async () => {
    const bytes = await png(7);
    const asset = await upload(h, "/api/screen/assets", bytes, "same.png", {
      host: HOST,
      session: "admin",
    });
    const photo = (await add(bytes)).json<Photo>();
    expect(asset.json<{ url: string }>().url).toBe(photo.url);
    await call(h, "DELETE", `/api/screen/photos/${photo.id}`, { host: HOST, session: "photos" });
    expect(stored(photo.url)).toBe(true);
    const served = await call(h, "GET", photo.url, { host: HOST, session: "content" });
    expect(served.statusCode).toBe(200);
  });

  it("keeps a file a photo still uses when its asset goes", async () => {
    const bytes = await png(9);
    const photo = (await add(bytes)).json<Photo>();
    const asset = await upload(h, "/api/screen/assets", bytes, "same.png", {
      host: HOST,
      session: "admin",
    });
    const id = asset.json<{ id: string }>().id;
    const gone = await call(h, "DELETE", `/api/screen/assets/${id}`, {
      host: HOST,
      session: "admin",
    });
    expect(gone.statusCode).toBe(204);
    expect(stored(photo.url)).toBe(true);
    await call(h, "DELETE", `/api/screen/photos/${photo.id}`, { host: HOST, session: "photos" });
    expect(stored(photo.url)).toBe(false);
  });

  it("keeps photos per event", async () => {
    TENANTS["kappa.test"] = context("kappa", { flags: { "screen.photos": true } });
    const read = await call(h, "GET", "/api/screen/photos", {
      host: "kappa.test",
      session: "admin",
    });
    expect(read.json()).toEqual({ photos: [] });
  });

  it("deletes a deleted user's photos, and only theirs", async () => {
    await add(await png(8), { author_user_id: "u_sam" });
    const before = (await list()).length;
    const removed = await withTenant("iota", () =>
      deleteUserPhotos({ ...h, storage: h.quota }, "u_sam"),
    );
    expect(removed).toBe(2);
    const after = await list();
    expect(after).toHaveLength(before - 2);
    expect(after.every((p) => p.author_user_id !== "u_sam")).toBe(true);
    expect(events(h, "screen.photo.removed", "iota").at(-1)).toMatchObject({ actor_user_id: null });
  });
});
