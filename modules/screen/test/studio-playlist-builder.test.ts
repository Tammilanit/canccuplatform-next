/**
 * The playlist builder (static/studio-playlist-builder.js), with the legacy `playlist-builder.ts`
 * rules and their tests ported: an item's length, a slide range only on a deck, order and removal
 * as the whole list the `PUT` sends; and the run order the page previews, which must agree with the
 * tick's own timeline, and the end a push may have.
 */
import { describe, expect, it } from "vitest";
import {
  checkItem,
  checkPlaylist,
  clock,
  moveItem,
  newItem,
  nextAt,
  pushUntil,
  removeItem,
  runOrder,
} from "../static/studio-playlist-builder.js";
import type {
  BuilderAsset,
  BuilderItem,
  BuilderPlaylist,
} from "../static/studio-playlist-builder.js";
import { cycleSeconds } from "../src/playback/timeline.js";
import type { PlaybackAsset } from "../src/playback/timeline.js";

const ASSETS = {
  poster: {
    kind: "image",
    title: "poster.png",
    duration_seconds: null,
    slides: null,
    health: "ok",
  },
  trailer: {
    kind: "video",
    title: "trailer.mp4",
    duration_seconds: 101.4,
    slides: null,
    health: "ok",
  },
  welcome: {
    kind: "pptx",
    title: "welcome.pptx",
    duration_seconds: null,
    slides: 12,
    health: "ok",
  },
  draft: { kind: "pdf", title: "draft.pdf", duration_seconds: null, slides: null, health: "ok" },
  board: { kind: "web", title: "status board", duration_seconds: null, slides: null, health: "ok" },
  dead: { kind: "youtube", title: "gone", duration_seconds: null, slides: null, health: "error" },
} satisfies Record<string, BuilderAsset>;

const item = (asset_id: string, over: Partial<BuilderItem> = {}): BuilderItem => ({
  id: null,
  asset_id,
  duration_seconds: 15,
  slide_start: null,
  slide_end: null,
  slide_seconds: null,
  ...over,
});

const playlist = (items: BuilderItem[], over: Partial<BuilderPlaylist> = {}): BuilderPlaylist => ({
  name: "Welcome loop",
  type: "regular",
  priority: 0,
  slideshow_image_seconds: null,
  items,
  ...over,
});

describe("playlist builder: an item", () => {
  it("starts an asset dragged in with a length that suits its kind", () => {
    expect(newItem("poster", ASSETS.poster)).toEqual(item("poster", { duration_seconds: 15 }));
    // A video plays its own length; a deck shows each slide for 8 s, the whole deck.
    expect(newItem("trailer", ASSETS.trailer).duration_seconds).toBeNull();
    expect(newItem("welcome", ASSETS.welcome).duration_seconds).toBe(8);
    expect(newItem("board", ASSETS.board).duration_seconds).toBe(30);
  });

  it("refuses an item whose asset is gone", () => {
    expect(checkItem(item("nope"), undefined, "regular")).toEqual({ key: "playlist.item_missing" });
  });

  it("lets only a video play its own length, except in a slideshow", () => {
    const own = { duration_seconds: null };
    expect(checkItem(item("trailer", own), ASSETS.trailer, "regular")).toBeNull();
    expect(checkItem(item("poster", own), ASSETS.poster, "regular")).toEqual({
      key: "playlist.own_length",
    });
    expect(checkItem(item("poster", own), ASSETS.poster, "slideshow")).toBeNull();
  });

  it("needs at least one second", () => {
    for (const bad of [0, 0.5, -3, Number.NaN]) {
      expect(
        checkItem(item("poster", { duration_seconds: bad }), ASSETS.poster, "regular"),
      ).toEqual({ key: "playlist.too_short" });
    }
  });

  // Legacy: "rejects slide range on non-pptx assets", "rejects slide duration on non-pptx assets".
  it("takes a slide range or slide time only on a deck", () => {
    for (const over of [{ slide_start: 1 }, { slide_end: 2 }, { slide_seconds: 5 }]) {
      expect(checkItem(item("poster", over), ASSETS.poster, "regular")).toEqual({
        key: "playlist.deck_only",
      });
      expect(checkItem(item("welcome", over), ASSETS.welcome, "regular")).toBeNull();
    }
    expect(checkItem(item("welcome", { slide_seconds: 0 }), ASSETS.welcome, "regular")).toEqual({
      key: "playlist.too_short",
    });
  });

  it("keeps a slide range in order and inside the deck", () => {
    const range = (slide_start: number | null, slide_end: number | null) =>
      checkItem(item("welcome", { slide_start, slide_end }), ASSETS.welcome, "regular");
    expect(range(3, 5)).toBeNull();
    expect(range(5, 3)).toEqual({ key: "playlist.slide_order" });
    expect(range(0, 3)).toEqual({ key: "playlist.slide_whole" });
    expect(range(2.5, null)).toEqual({ key: "playlist.slide_whole" });
    expect(range(3, 13)).toEqual({ key: "playlist.slide_max", values: { count: 12 } });
    expect(range(13, null)).toEqual({ key: "playlist.slide_max", values: { count: 12 } });
    // An unrendered deck has no count yet: its render fits the range.
    expect(checkItem(item("draft", { slide_end: 40 }), ASSETS.draft, "regular")).toBeNull();
  });
});

describe("playlist builder: the list", () => {
  // Legacy: "adds and reorders playlist items with deterministic positions".
  it("moves an item to its new place and leaves the rest in order", () => {
    const list = ["a", "b", "c", "d"].map((id) => item(id));
    expect(moveItem(list, 0, 2).map((i) => i.asset_id)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(list, 3, 0).map((i) => i.asset_id)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(list, 1, 1)).toEqual(list);
    // Past either end stays at the end, and the list given is never changed.
    expect(moveItem(list, 0, 9).map((i) => i.asset_id)).toEqual(["b", "c", "d", "a"]);
    expect(moveItem(list, 2, -1).map((i) => i.asset_id)).toEqual(["c", "a", "b", "d"]);
    expect(list.map((i) => i.asset_id)).toEqual(["a", "b", "c", "d"]);
  });

  // Legacy: "removes playlist item and renumbers positions".
  it("removes one item and keeps the order of the others", () => {
    const list = ["a", "b", "c"].map((id) => item(id));
    expect(removeItem(list, 1).map((i) => i.asset_id)).toEqual(["a", "c"]);
    expect(removeItem(list, 5)).toEqual(list);
  });

  it("checks the whole playlist before it is saved: name, priority, size and every item", () => {
    const ok = playlist([item("poster"), item("trailer", { duration_seconds: null })]);
    expect(checkPlaylist(ok, ASSETS)).toEqual([]);
    expect(checkPlaylist({ ...ok, name: "  " }, ASSETS)).toEqual([
      { field: "name", key: "playlist.name_needed" },
    ]);
    expect(checkPlaylist({ ...ok, name: "x".repeat(81) }, ASSETS)).toEqual([
      { field: "name", key: "playlist.name_long" },
    ]);
    for (const priority of [-1, 1000, 2.5]) {
      expect(checkPlaylist({ ...ok, priority }, ASSETS)).toEqual([
        { field: "priority", key: "playlist.priority_range" },
      ]);
    }
    const many = playlist(Array.from({ length: 501 }, () => item("poster")));
    expect(checkPlaylist(many, ASSETS)).toEqual([{ field: "items", key: "playlist.too_many" }]);
    const bad = playlist([item("poster"), item("poster", { duration_seconds: 0 })]);
    expect(checkPlaylist(bad, ASSETS)).toEqual([
      { field: "items", index: 1, key: "playlist.too_short" },
    ]);
  });
});

describe("playlist builder: the run order", () => {
  it("lists each item's start and length, with the whole cycle", () => {
    const run = runOrder(
      playlist([
        item("welcome", { duration_seconds: 8 }),
        item("poster", { duration_seconds: 15 }),
        item("trailer", { duration_seconds: null }),
        item("board", { duration_seconds: 30 }),
      ]),
      ASSETS,
    );
    expect(run.rows).toEqual([
      { index: 0, start: 0, seconds: 96, slides: 12, skipped: null },
      { index: 1, start: 96, seconds: 15, slides: null, skipped: null },
      { index: 2, start: 111, seconds: 102, slides: null, skipped: null },
      { index: 3, start: 213, seconds: 30, slides: null, skipped: null },
    ]);
    expect(run.total).toBe(243);
  });

  it("skips what the screens skip: a deck not rendered yet and an asset in error", () => {
    const run = runOrder(playlist([item("draft"), item("dead"), item("poster")]), ASSETS);
    expect(run.rows.map((r) => [r.start, r.seconds, r.skipped])).toEqual([
      [0, 0, "unrendered"],
      [0, 0, "error"],
      [0, 15, null],
    ]);
    expect(run.total).toBe(15);
  });

  it("plays a deck's range, and a deck with a slide time as one item that turns its slides", () => {
    const run = runOrder(
      playlist([
        item("welcome", { duration_seconds: 5, slide_start: 3, slide_end: 6 }),
        item("welcome", { duration_seconds: 40, slide_seconds: 4 }),
      ]),
      ASSETS,
    );
    expect(run.rows.map((r) => [r.seconds, r.slides])).toEqual([
      [20, 4],
      [40, 12],
    ]);
  });

  it("shows a slideshow's images only, each for the playlist's time", () => {
    const run = runOrder(
      playlist([item("poster"), item("trailer"), item("poster")], {
        type: "slideshow",
        slideshow_image_seconds: 7,
      }),
      ASSETS,
    );
    expect(run.rows.map((r) => [r.start, r.seconds, r.skipped])).toEqual([
      [0, 7, null],
      [7, 0, "slideshow"],
      [7, 7, null],
    ]);
    expect(runOrder(playlist([item("poster")], { type: "slideshow" }), ASSETS).total).toBe(10);
  });

  // One rule, never two copies that drift (plan S3): the preview's cycle is the tick's.
  it("agrees with the tick's timeline on the length of a cycle", () => {
    const playback = new Map(
      Object.entries(ASSETS).map(([id, a]): [string, PlaybackAsset] => [
        id,
        {
          id,
          kind: a.kind,
          durationSeconds: a.duration_seconds,
          slideCount: a.slides,
          health: a.health,
        },
      ]),
    );
    const cases = [
      [item("poster", { duration_seconds: 2.2 }), item("trailer", { duration_seconds: null })],
      [item("welcome", { duration_seconds: 3, slide_start: 11, slide_end: 40 })],
      [item("welcome", { duration_seconds: 9, slide_seconds: 2 }), item("dead"), item("draft")],
      [item("board", { duration_seconds: 30 }), item("welcome", { duration_seconds: 1 })],
    ];
    for (const items of cases) {
      const tick = cycleSeconds(
        {
          id: "pl",
          type: "regular",
          slideshowImageSeconds: null,
          items: items.map((i, n) => ({
            id: `pi_${n}`,
            assetId: i.asset_id,
            durationSeconds: i.duration_seconds,
            slideStart: i.slide_start,
            slideEnd: i.slide_end,
            slideSeconds: i.slide_seconds,
          })),
        },
        playback,
      );
      expect(runOrder(playlist(items), ASSETS).total).toBe(tick);
    }
  });

  it("writes lengths as a clock", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(96)).toBe("1:36");
    expect(clock(380)).toBe("6:20");
    expect(clock(3725)).toBe("1:02:05");
  });
});

describe("push: until when", () => {
  const NOW = Date.parse("2026-06-12T14:10:30Z");

  it("finds the next time of day in the event's time zone", () => {
    expect(new Date(nextAt("UTC", NOW, "20:00")).toISOString()).toBe("2026-06-12T20:00:00.000Z");
    // Helsinki is UTC+3 in June: 20:00 there is 17:00 UTC.
    expect(new Date(nextAt("Europe/Helsinki", NOW, "20:00")).toISOString()).toBe(
      "2026-06-12T17:00:00.000Z",
    );
    // A time already past today is tomorrow's.
    expect(new Date(nextAt("UTC", NOW, "09:00")).toISOString()).toBe("2026-06-13T09:00:00.000Z");
    // Midnight is the end of today.
    expect(new Date(nextAt("Europe/Helsinki", NOW, "00:00")).toISOString()).toBe(
      "2026-06-12T21:00:00.000Z",
    );
  });

  it("keeps the wall clock across a change of daylight saving time", () => {
    // Europe/Helsinki leaves summer time at 04:00 on 25 October 2026 (UTC+3 → UTC+2).
    const before = Date.parse("2026-10-24T22:00:00Z");
    expect(new Date(nextAt("Europe/Helsinki", before, "12:00")).toISOString()).toBe(
      "2026-10-25T10:00:00.000Z",
    );
  });

  it("turns each preset into an end at most 12 hours ahead", () => {
    expect(pushUntil("15", NOW, "UTC", "")).toEqual({ ms: NOW + 15 * 60_000 });
    expect(pushUntil("60", NOW, "UTC", "")).toEqual({ ms: NOW + 3600_000 });
    expect(pushUntil("day", NOW, "UTC", "")).toEqual({ ms: Date.parse("2026-06-13T00:00:00Z") });
    expect(pushUntil("at", NOW, "UTC", "18:30")).toEqual({
      ms: Date.parse("2026-06-12T18:30:00Z"),
    });
    expect(pushUntil("at", NOW, "UTC", "")).toEqual({ error: "push.time_needed" });
    // 09:00 tomorrow is 19 hours ahead: past the contract's 12 hours.
    expect(pushUntil("at", NOW, "UTC", "09:00")).toEqual({ error: "push.too_far" });
    expect(pushUntil("day", Date.parse("2026-06-12T08:00:00Z"), "UTC", "")).toEqual({
      error: "push.too_far",
    });
  });
});
