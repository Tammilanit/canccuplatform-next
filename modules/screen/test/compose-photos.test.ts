import { describe, expect, it } from "vitest";
import {
  photoWall,
  popUntil,
  wallKey,
  wallSettings,
  WALL_DEFAULTS,
} from "../src/compose/photos.js";
import type { PhotoRow, WallSettings } from "../src/compose/photos.js";

const T0 = Date.parse("2026-01-01T12:00:00Z");
const HOUR = 3_600_000;

const photo = (id: string, createdAt: number): PhotoRow => ({
  id,
  url: `/api/screen/files/${id}.jpg`,
  caption: `Caption ${id}`,
  author_name: null,
  posted_at: new Date(createdAt).toISOString(),
  created_at: createdAt,
});
const ids = (view: Record<string, unknown> | undefined): string[] =>
  ((view?.tiles ?? []) as { url: string }[]).map((t) => /files\/(.+)\.jpg/.exec(t.url)?.[1] ?? "");
const wall = (s: Partial<WallSettings> = {}): WallSettings => ({ ...WALL_DEFAULTS, ...s });
// Seven photos, all long past their pop: a-g, oldest first.
const SEVEN = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => photo(id, T0 - HOUR + i * 1000));

describe("wallSettings", () => {
  it("reads the props, and any out of range or unknown falls back to its default", () => {
    expect(wallSettings({})).toEqual({ seconds: 8, order: "newest", popNew: true });
    const set = { photo_seconds: 20, order: "shuffle", pop_new: false };
    expect(wallSettings(set)).toEqual({ seconds: 20, order: "shuffle", popNew: false });
    for (const seconds of [4, 61, 7.5, "10"]) {
      expect(wallSettings({ photo_seconds: seconds }).seconds).toBe(8);
    }
    expect(wallSettings({ order: "random", pop_new: "yes" })).toMatchObject({
      order: "newest",
      popNew: true,
    });
    expect(wallKey(wallSettings({}))).toBe("8:newest:pop");
  });
});

describe("photoWall", () => {
  it("is null without photos", () => {
    expect(photoWall([], wall(), "main", T0)).toBeNull();
  });

  it("shows five tiles from the lead on, newest first, a new lead every photo_seconds", () => {
    const slot = Math.floor(T0 / 8_000);
    const at = slot * 8_000;
    const newest = ["g", "f", "e", "d", "c", "b", "a"];
    const lead = slot % 7;
    const now = photoWall(SEVEN, wall(), "main", at);
    expect(ids(now?.view)).toEqual([0, 1, 2, 3, 4].map((i) => newest[(lead + i) % 7]));
    expect(now?.view).toMatchObject({ url: `/api/screen/files/${newest[lead] ?? ""}.jpg` });
    expect(now?.view.featured).toBe(false);
    expect(now?.changesAt).toBe(at + 8_000);
    expect(ids(photoWall(SEVEN, wall(), "main", at + 7_999)?.view)).toEqual(ids(now?.view));
    expect(ids(photoWall(SEVEN, wall(), "main", at + 8_000)?.view)[0]).toBe(newest[(lead + 1) % 7]);
  });

  it("follows `oldest`, and never shows a photo twice when there are fewer than five", () => {
    const at = Math.floor(T0 / 10_000) * 10_000;
    const three = SEVEN.slice(0, 3);
    const view = photoWall(three, wall({ order: "oldest", seconds: 10 }), "main", at)?.view;
    const lead = Math.floor(at / 10_000) % 3;
    expect(ids(view)).toEqual([0, 1, 2].map((i) => ["a", "b", "c"][(lead + i) % 3]));
  });

  it("shuffles each round alike on every screen of a zone, every photo leading once a round", () => {
    const s = wall({ order: "shuffle" });
    const round = Math.floor(Math.floor(T0 / 8_000) / 7);
    const leads = Array.from({ length: 7 }, (_, i) =>
      ids(photoWall(SEVEN, s, "main", (round * 7 + i) * 8_000)?.view).at(0),
    );
    expect([...leads].sort()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    const again = Array.from({ length: 7 }, (_, i) =>
      ids(photoWall(SEVEN, s, "main", (round * 7 + i) * 8_000 + 500)?.view).at(0),
    );
    expect(again).toEqual(leads);
  });

  it("pops a new photo for 10 seconds in a `pop_new` zone, then the wall goes on", () => {
    const fresh = [...SEVEN, photo("new", T0 - 2_000)];
    const now = photoWall(fresh, wall(), "main", T0);
    expect(now?.view).toMatchObject({ url: "/api/screen/files/new.jpg", featured: true });
    expect(ids(now?.view)).toHaveLength(5);
    expect(now?.changesAt).toBe(T0 + 8_000);
    expect(photoWall(fresh, wall(), "main", T0 + 8_000)?.view.featured).toBe(false);
    // Without `pop_new` the photo simply joins the wall in its place in the order.
    expect(photoWall(fresh, wall({ popNew: false }), "main", T0)?.view.featured).toBe(false);
  });

  it("pops photos that arrive together one after another, and plans each pop's start", () => {
    const pair = [...SEVEN, photo("p", T0), photo("q", T0 + 1_000)];
    expect(photoWall(pair, wall(), "main", T0 + 11_000)?.view).toMatchObject({
      url: "/api/screen/files/q.jpg",
      featured: true,
    });
    expect(photoWall(pair, wall(), "main", T0 + 9_000)?.changesAt).toBe(T0 + 10_000);
  });

  it("plans no change for a single photo past its pop: it turns into itself", () => {
    expect(photoWall([photo("a", T0 - HOUR)], wall(), "main", T0)?.changesAt).toBeNull();
  });
});

describe("popUntil", () => {
  it("chains the pop slots in the order the photos came, 10 seconds each", () => {
    const until = popUntil([photo("b", T0 + 1_000), photo("a", T0)]);
    expect(until.get("a")).toBe(T0 + 10_000);
    expect(until.get("b")).toBe(T0 + 20_000);
  });
});
