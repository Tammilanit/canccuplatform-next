// Ported from the legacy signage `playback-timing.test.ts`, the frame half of `scheduler.test.ts`
// and the play-once half of `advt-play-once.test.ts`, with the bookmark now paused and resumed
// by the tick instead of written by the screen.
import { describe, expect, test } from "vitest";

import {
  pauseBookmark,
  resolveFrame,
  resumeBookmark,
  START_BOOKMARK,
  type Bookmark,
} from "../src/playback/engine.js";
import {
  clampSlideRange,
  cycleSeconds,
  itemSeconds,
  type PlaybackAsset,
  type PlaybackItem,
  type PlaybackPlaylist,
} from "../src/playback/timeline.js";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");

function asset(id: string, kind: PlaybackAsset["kind"], extra: Partial<PlaybackAsset> = {}) {
  const value: PlaybackAsset = {
    id,
    kind,
    durationSeconds: null,
    slideCount: null,
    health: "ok",
    ...extra,
  };
  return value;
}

function item(
  id: string,
  assetId: string,
  seconds: number | null,
  extra: Partial<PlaybackItem> = {},
) {
  const value: PlaybackItem = {
    id,
    assetId,
    durationSeconds: seconds,
    slideStart: null,
    slideEnd: null,
    slideSeconds: null,
    ...extra,
  };
  return value;
}

function playlist(items: PlaybackItem[], extra: Partial<PlaybackPlaylist> = {}): PlaybackPlaylist {
  return { id: "p1", type: "regular", items, slideshowImageSeconds: null, ...extra };
}

const assets = (...list: PlaybackAsset[]) => new Map(list.map((a) => [a.id, a]));

/** A bookmark running since T0 from the start of `itemId` (and `slideNumber`) plus `offset` s. */
function runningFrom(itemId: string | null, slideNumber: number | null = null, offset = 0) {
  const bookmark: Bookmark = { itemId, slideNumber, offsetMs: offset * 1000, runningSince: T0 };
  return bookmark;
}

const deck5 = asset("a1", "pptx", { slideCount: 5 });

describe("item length", () => {
  test("a manual length wins; auto plays a video's real length, rounded up", () => {
    const video = asset("v", "video", { durationSeconds: 12.2 });
    expect(itemSeconds(item("i", "v", 20), video)).toBe(20);
    expect(itemSeconds(item("i", "v", null), video)).toBe(13);
    expect(itemSeconds(item("i", "v", null), asset("v", "video"))).toBe(30);
  });

  test("clampSlideRange fills missing slide bounds from the deck", () => {
    expect(clampSlideRange(7, null, null)).toEqual({ startSlide: 1, endSlide: 7 });
    expect(clampSlideRange(3, 2, 9)).toEqual({ startSlide: 2, endSlide: 3 });
  });

  test("an asset in error, an unrendered deck and audio are left out of the timeline", () => {
    const list = assets(
      asset("ok", "image"),
      asset("bad", "youtube", { health: "error" }),
      asset("deck", "pdf"),
      asset("snd", "audio"),
    );
    const items = [item("i1", "ok", 10), item("i2", "bad", 10), item("i3", "deck", 10)];
    expect(cycleSeconds(playlist([...items, item("i4", "snd", 5)]), list)).toBe(10);
  });
});

describe("frames", () => {
  const hero = asset("hero", "image");
  const sponsorDeck = asset("deck", "pptx", { slideCount: 3 });
  const sponsorWeb = asset("web", "web");

  test("expands a deck's slide range into one segment per slide", () => {
    const items = [item("hero-item", "hero", 10), item("deck-item", "deck", 5, { slideStart: 2 })];
    const frame = resolveFrame(
      playlist(items),
      assets(hero, sponsorDeck),
      runningFrom(null),
      T0 + 17_000,
    );
    expect(frame).toMatchObject({
      playlistId: "p1",
      itemId: "deck-item",
      assetId: "deck",
      kind: "slide",
      slideNumber: 3,
      offsetSeconds: 2,
      durationSeconds: 3,
      cycleSeconds: 20,
      muted: true,
    });
  });

  test("web, video and YouTube frames", () => {
    const web = resolveFrame(
      playlist([item("w", "web", 20)]),
      assets(sponsorWeb),
      runningFrom(null),
      T0 + 5_000,
    );
    expect(web).toMatchObject({ kind: "web", offsetSeconds: 5, durationSeconds: 15, muted: true });
    const clip = asset("clip", "video", { durationSeconds: 8 });
    const video = resolveFrame(
      playlist([item("v", "clip", null)]),
      assets(clip),
      runningFrom(null),
      T0,
    );
    expect(video).toMatchObject({ kind: "video", durationSeconds: 8, muted: false });
  });

  test("a one-slide deck does not cycle on its slide timer", () => {
    const single = asset("single", "pptx", { slideCount: 1 });
    const items = [item("s", "single", 30, { slideSeconds: 5 })];
    const frame = resolveFrame(playlist(items), assets(single), runningFrom(null), T0 + 12_000);
    expect(frame).toMatchObject({ slideNumber: 1, offsetSeconds: 12, durationSeconds: 18 });
    expect(frame?.timing).toEqual({
      sceneSeconds: 30,
      sceneElapsedSeconds: 12,
      pageSeconds: null,
      pageElapsedSeconds: null,
    });
  });

  test("cycles a deck's slides within one item when the slide time is set", () => {
    const items = [
      item("hero-item", "hero", 10),
      item("deck-item", "deck", 30, { slideStart: 2, slideEnd: 3, slideSeconds: 5 }),
    ];
    const frame = resolveFrame(
      playlist(items),
      assets(hero, sponsorDeck),
      runningFrom(null),
      T0 + 17_000,
    );
    expect(frame).toMatchObject({
      itemId: "deck-item",
      slideNumber: 3,
      offsetSeconds: 7,
      durationSeconds: 3,
      cycleSeconds: 40,
    });
  });

  test("wraps to the first item after one pass", () => {
    const items = [item("i1", "hero", 10), item("i2", "hero", 10)];
    const frame = resolveFrame(playlist(items), assets(hero), runningFrom(null), T0 + 25_000);
    expect(frame).toMatchObject({ itemId: "i1", offsetSeconds: 5 });
  });

  test("nothing playable has no frame", () => {
    expect(resolveFrame(playlist([]), assets(), runningFrom(null), T0)).toBeNull();
  });
});

describe("timing", () => {
  test("single item: scene only, no pages", () => {
    const frame = resolveFrame(
      playlist([item("i1", "a1", 30)]),
      assets(asset("a1", "image")),
      runningFrom("i1"),
      T0 + 12_000,
    );
    expect(frame?.timing).toEqual({
      sceneSeconds: 30,
      sceneElapsedSeconds: 12,
      pageSeconds: null,
      pageElapsedSeconds: null,
    });
  });

  test("deck with a slide time: the scene is the item, the page the slide", () => {
    const items = [item("i1", "a1", 60, { slideSeconds: 10 })];
    const frame = resolveFrame(playlist(items), assets(deck5), runningFrom("i1"), T0 + 25_000);
    expect(frame?.timing).toEqual({
      sceneSeconds: 60,
      sceneElapsedSeconds: 25,
      pageSeconds: 10,
      pageElapsedSeconds: 5,
    });
  });

  test("elapsed carries the sub-second part so the bar ends at the real switch", () => {
    const items = [item("i1", "a1", 60, { slideSeconds: 10 })];
    const frame = resolveFrame(playlist(items), assets(deck5), runningFrom("i1"), T0 + 25_400);
    expect(frame?.timing.sceneElapsedSeconds).toBeCloseTo(25.4, 5);
    expect(frame?.timing.pageElapsedSeconds).toBeCloseTo(5.4, 5);
  });

  test("the last slide is cut short when the item is not a multiple of the slide time", () => {
    const items = [item("i1", "a1", 25, { slideSeconds: 10 })];
    const frame = resolveFrame(playlist(items), assets(deck5), runningFrom("i1"), T0 + 21_000);
    expect(frame?.timing.pageSeconds).toBe(5);
    expect(frame?.timing.pageElapsedSeconds).toBe(1);
  });
});

describe("slideshow playlists", () => {
  const images = assets(asset("a1", "image"), asset("a2", "image"), asset("a3", "image"));
  const items = [item("i1", "a1", 99), item("i2", "a2", 99), item("i3", "a3", 99)];

  test("the scene is the cycle, the page one image", () => {
    const show = playlist(items, { type: "slideshow", slideshowImageSeconds: 8 });
    const frame = resolveFrame(show, images, runningFrom("i1"), T0 + 11_000);
    expect(frame).toMatchObject({
      itemId: "i2",
      kind: "image",
      imageIndex: 1,
      offsetSeconds: 3,
      durationSeconds: 5,
      cycleSeconds: 24,
    });
    expect(frame?.timing).toEqual({
      sceneSeconds: 24,
      sceneElapsedSeconds: 11,
      pageSeconds: 8,
      pageElapsedSeconds: 3,
    });
  });

  test("shows images only and wraps after the cycle", () => {
    const mixed = new Map([...images, ["v", asset("v", "video")]]);
    const show = playlist([item("iv", "v", 5), ...items], {
      type: "slideshow",
      slideshowImageSeconds: 5,
    });
    expect(resolveFrame(show, mixed, runningFrom(null), T0 + 16_000)).toMatchObject({
      itemId: "i1",
      imageIndex: 0,
      cycleSeconds: 15,
    });
  });
});

describe("bookmarks", () => {
  const twoDecks = playlist([item("i1", "a1", 20), item("i2", "a1", 10)]);
  const list = assets(deck5);

  test("position is the saved offset plus the time since it started running", () => {
    const bookmark: Bookmark = { itemId: "i1", slideNumber: 3, offsetMs: 4_000, runningSince: T0 };
    const frame = resolveFrame(twoDecks, list, bookmark, T0 + 5_000);
    expect(frame).toMatchObject({ itemId: "i1", slideNumber: 3, offsetSeconds: 9 });
  });

  test("a bookmarked slide outside the range falls back to the item's first slide", () => {
    const ranged = playlist([item("i1", "a1", 20, { slideStart: 2, slideEnd: 3 })]);
    expect(resolveFrame(ranged, list, runningFrom("i1", 5), T0)?.slideNumber).toBe(2);
  });

  test("a bookmarked item that is gone starts the playlist from the top", () => {
    expect(resolveFrame(twoDecks, list, runningFrom("gone"), T0)).toMatchObject({
      itemId: "i1",
      slideNumber: 1,
    });
  });

  test("pausing keeps the slide, so a deck resumes where it stopped (the lost slide fix)", () => {
    const paused = pauseBookmark(twoDecks, list, runningFrom("i1"), T0 + 47_500);
    expect(paused).toEqual({ itemId: "i1", slideNumber: 3, offsetMs: 7_500, runningSince: null });
    const resumed = resumeBookmark(paused, T0 + 600_000);
    expect(resolveFrame(twoDecks, list, resumed, T0 + 600_000)).toMatchObject({
      itemId: "i1",
      slideNumber: 3,
      offsetSeconds: 7,
    });
  });

  test("a paused bookmark stands still and its offset is never counted twice", () => {
    const paused = pauseBookmark(twoDecks, list, runningFrom("i1"), T0 + 30_000);
    expect(resolveFrame(twoDecks, list, paused, T0 + 999_000)?.offsetSeconds).toBe(10);
    // Pausing a paused bookmark changes nothing; resuming counts only the time since resuming.
    expect(pauseBookmark(twoDecks, list, paused, T0 + 999_000)).toEqual(paused);
    const resumed = resumeBookmark(paused, T0 + 50_000);
    expect(resolveFrame(twoDecks, list, resumed, T0 + 52_000)?.offsetSeconds).toBe(12);
    expect(resumeBookmark(resumed, T0 + 60_000)).toEqual(resumed);
  });

  test("a slideshow pauses its place in the cycle", () => {
    const images = assets(asset("x1", "image"), asset("x2", "image"));
    const show = playlist([item("s1", "x1", null), item("s2", "x2", null)], {
      type: "slideshow",
      slideshowImageSeconds: 5,
    });
    const paused = pauseBookmark(show, images, runningFrom(null), T0 + 17_000);
    expect(paused).toMatchObject({ itemId: "s2", offsetMs: 7_000, runningSince: null });
    const frame = resolveFrame(show, images, resumeBookmark(paused, T0 + 100_000), T0 + 100_000);
    expect(frame).toMatchObject({ itemId: "s2", offsetSeconds: 2 });
  });

  test("the start bookmark plays from the first item", () => {
    const frame = resolveFrame(twoDecks, list, resumeBookmark(START_BOOKMARK, T0), T0 + 1_000);
    expect(frame).toMatchObject({ itemId: "i1", slideNumber: 1, offsetSeconds: 1 });
  });
});

describe("play once", () => {
  const ads = playlist([item("item-1", "a", 10), item("item-2", "a", 10)]);
  const list = assets(asset("a", "image"));

  test("never wraps to the first item past the end of one pass", () => {
    const resolveAt = (s: number) =>
      resolveFrame(ads, list, runningFrom(null), T0 + s * 1000, { playOnce: true });
    expect(resolveAt(19)?.itemId).toBe("item-2");
    expect(resolveAt(20)).toBeNull();
    expect(resolveAt(21)).toBeNull();
  });

  test("still loops when play once is off", () => {
    expect(resolveFrame(ads, list, runningFrom(null), T0 + 20_000)?.itemId).toBe("item-1");
  });
});
