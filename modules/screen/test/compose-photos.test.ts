import { describe, expect, it } from "vitest";
import { featuredUntil, photoNow } from "../src/compose/photos.js";
import type { PhotoRow } from "../src/compose/photos.js";

const T0 = Date.parse("2026-01-01T12:00:00Z");

const photo = (id: string, createdAt: number): PhotoRow => ({
  id,
  url: `/api/screen/files/${id}.jpg`,
  caption: `Caption ${id}`,
  author_name: null,
  posted_at: new Date(createdAt).toISOString(),
  created_at: createdAt,
});

describe("photoNow", () => {
  it("is null without photos", () => {
    expect(photoNow([], 8, T0)).toBeNull();
  });

  it("features a new photo first, for one dwell", () => {
    const photos = [photo("old", T0 - 3_600_000), photo("new", T0 - 2_000)];
    const now = photoNow(photos, 8, T0);
    expect(now?.view).toEqual({
      url: "/api/screen/files/new.jpg",
      caption: "Caption new",
      author_name: null,
      posted_at: new Date(T0 - 2_000).toISOString(),
      featured: true,
    });
    expect(now?.changesAt).toBe(T0 + 6_000);
  });

  it("features photos that arrive together one after another", () => {
    const photos = [photo("a", T0), photo("b", T0 + 1_000)];
    expect(photoNow(photos, 8, T0 + 9_000)?.view).toMatchObject({
      url: "/api/screen/files/b.jpg",
      featured: true,
    });
    expect(photoNow(photos, 8, T0 + 9_000)?.changesAt).toBe(T0 + 16_000);
  });

  it("then shows every photo in turn, newest first, on the epoch-anchored dwell", () => {
    const photos = [photo("a", T0 - 100_000), photo("b", T0 - 90_000), photo("c", T0 - 80_000)];
    const slot = Math.floor(T0 / 8_000);
    const order = ["c", "b", "a"];
    const at = (ms: number) => photoNow(photos, 8, ms);
    expect(at(slot * 8_000)?.view).toMatchObject({
      url: `/api/screen/files/${order[slot % 3] ?? ""}.jpg`,
      featured: false,
    });
    expect(at(slot * 8_000 + 7_999)?.view).toEqual(at(slot * 8_000)?.view);
    expect(at(slot * 8_000 + 8_000)?.view).toMatchObject({
      url: `/api/screen/files/${order[(slot + 1) % 3] ?? ""}.jpg`,
    });
    expect(at(slot * 8_000)?.changesAt).toBe(slot * 8_000 + 8_000);
  });

  it("plans no change for a single photo past its feature: it turns into itself", () => {
    expect(photoNow([photo("a", T0 - 100_000)], 8, T0)?.changesAt).toBeNull();
  });
});

describe("featuredUntil", () => {
  it("chains the features in the order the photos came", () => {
    const until = featuredUntil([photo("b", T0 + 1_000), photo("a", T0)], 8);
    expect(until.get("a")).toBe(T0 + 8_000);
    expect(until.get("b")).toBe(T0 + 16_000);
  });
});
