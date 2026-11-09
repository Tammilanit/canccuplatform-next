// Ported from the legacy signage `advt-play-once.test.ts`, `advt-slideshow-break.test.ts`,
// and `advt-playback-mode.test.ts`: what a running break shows.
import { describe, expect, test } from "vitest";

import { breakImageOrder } from "../src/playback/break-play.js";
import { NO_BREAKS } from "../src/playback/breaks.js";
import { breakPlaylist, inputFor, ticker } from "./break-fixtures.js";

const START = 1_000_000;
const s = (seconds: number) => START + seconds * 1000;

function startedTicker(...args: Parameters<typeof inputFor>) {
  const t = ticker(inputFor(...args));
  for (const playlist of args[0]) t.setDue(playlist.id, START - 1000);
  return t;
}

describe("play once", () => {
  test("ends the break after the last item, before the break length", () => {
    const t = startedTicker([breakPlaylist("ads", { playOnce: true, breakSeconds: 60 }, [10, 10])]);
    expect(t.tick(s(0))).toMatchObject({ playlistId: "ads", endsAt: s(20) });
    expect(t.tick(s(0))?.frame?.itemId).toBe("ads-item-1");
    expect(t.tick(s(10))?.frame?.itemId).toBe("ads-item-2");
    expect(t.tick(s(19))?.frame?.itemId).toBe("ads-item-2");
    expect(t.tick(s(20))).toBeNull();
  });

  test("starts from the first item even when the playlist's bookmark is elsewhere", () => {
    const bookmark = {
      itemId: "ads-item-2",
      slideNumber: null,
      offsetMs: 5000,
      runningSince: null,
    };
    const playlists = [breakPlaylist("ads", { playOnce: true, breakSeconds: 60 }, [10, 10])];
    const t = ticker(inputFor(playlists), {
      ...NO_BREAKS,
      playlists: { ads: { dueAt: START - 1000, bookmark, nextImageId: null } },
    });
    expect(t.tick(s(0))?.frame?.itemId).toBe("ads-item-1");
  });

  test("keeps the cadence: the next break is a whole period after this one started", () => {
    const t = startedTicker([breakPlaylist("ads", { playOnce: true, breakSeconds: 60 }, [10])]);
    t.tick(s(0));
    t.tick(s(10));
    expect(t.dueOf("ads")).toBe(s(100));
  });

  test("the break length cuts a playlist longer than the break", () => {
    const t = startedTicker([breakPlaylist("ads", { playOnce: true, breakSeconds: 30 }, [20, 20])]);
    t.tick(s(0));
    expect(t.tick(s(29))?.frame?.itemId).toBe("ads-item-2");
    expect(t.tick(s(30))).toBeNull();
  });

  test("off: the playlist loops until the break length", () => {
    const t = startedTicker([breakPlaylist("ads", { breakSeconds: 60 }, [10, 10])]);
    t.tick(s(0));
    expect(t.tick(s(25))?.frame?.itemId).toBe("ads-item-1");
    expect(t.tick(s(59))?.playlistId).toBe("ads");
    expect(t.tick(s(60))).toBeNull();
  });
});

describe("timeline breaks", () => {
  test("each break goes on where the last one of its playlist stopped", () => {
    const ads = breakPlaylist("ads", { breakSeconds: 10, periodSeconds: 100 }, [10, 10, 10]);
    const t = startedTicker([ads], { minGapSeconds: 0 });
    expect(t.tick(s(0))?.frame?.itemId).toBe("ads-item-1");
    expect(t.tick(s(10))).toBeNull();
    expect(t.state.playlists.ads?.bookmark).toMatchObject({
      itemId: "ads-item-2",
      runningSince: null,
    });
    // The time between breaks does not move it on.
    expect(t.tick(s(100))?.frame).toMatchObject({ itemId: "ads-item-2", offsetSeconds: 0 });
    t.tick(s(110));
    expect(t.tick(s(200))?.frame?.itemId).toBe("ads-item-3");
  });

  test("a frame never says it lasts past the end of the break", () => {
    const t = startedTicker([breakPlaylist("ads", { breakSeconds: 15 }, [10, 10])]);
    t.tick(s(0));
    expect(t.tick(s(12))?.frame?.durationSeconds).toBe(3);
  });
});

describe("slideshow breaks", () => {
  const slideshow = (rules = {}, images = 3) =>
    breakPlaylist(
      "show",
      { mode: "slideshow", slideshowDwellSeconds: 4, breakSeconds: 10, ...rules },
      Array.from({ length: images }, () => null),
    );

  test("plays the images in order, each for the dwell", () => {
    const t = startedTicker([slideshow()]);
    expect(t.tick(s(0))?.frame).toMatchObject({
      assetId: "show-img-1",
      kind: "image",
      imageIndex: 0,
      offsetSeconds: 0,
      durationSeconds: 4,
      cycleSeconds: 12,
      muted: true,
    });
    expect(t.tick(s(5))?.frame).toMatchObject({ assetId: "show-img-2", imageIndex: 1 });
  });

  test("the next break starts at the image after the last one shown", () => {
    const t = startedTicker([slideshow({ breakSeconds: 8 })]);
    t.tick(s(0));
    expect(t.tick(s(8))).toBeNull();
    expect(t.state.playlists.show?.nextImageId).toBe("show-item-3");
    t.setDue("show", s(59));
    expect(t.tick(s(120))?.frame).toMatchObject({ assetId: "show-img-3", imageIndex: 2 });
  });

  test("an image shown at the break's end finishes its dwell, for at most 10 seconds", () => {
    const t = startedTicker([slideshow({ slideshowDwellSeconds: 6, breakSeconds: 8 }, 2)]);
    expect(t.tick(s(0))?.endsAt).toBe(s(12));
    const atEnd = t.tick(s(8));
    expect(atEnd?.frame).toMatchObject({ assetId: "show-img-2", durationSeconds: 4 });
    expect(atEnd?.frame?.timing).toMatchObject({ sceneSeconds: 12, sceneElapsedSeconds: 8 });
    expect(t.tick(s(12))).toBeNull();
    // After an overrun the next break starts at the image after it.
    expect(t.state.playlists.show?.nextImageId).toBe("show-item-1");

    const long = startedTicker([slideshow({ slideshowDwellSeconds: 30, breakSeconds: 8 }, 2)]);
    expect(long.tick(s(0))?.endsAt).toBe(s(18));
  });

  test("shows images only, and never starts without one", () => {
    const show = slideshow({ priority: 9 }, 2);
    const input = inputFor([show, breakPlaylist("other", {})]);
    const assets = new Map(input.assets);
    input.assets = assets;
    assets.set("show-img-1", { ...assets.get("show-img-1")!, kind: "video" });
    const t = ticker(input);
    t.setDue("show", START - 1000);
    expect(t.tick(s(0))?.frame?.assetId).toBe("show-img-2");

    assets.set("show-img-2", { ...assets.get("show-img-2")!, health: "error" });
    const skipped = ticker(input);
    skipped.setDue("show", START - 1000);
    skipped.setDue("other", START - 1000);
    expect(skipped.tick(s(0))?.playlistId).toBe("other");
    expect(skipped.dueOf("show")).toBe(s(100));
  });

  test("shuffle: a new order each break, the same on every screen of the zone", () => {
    const show = slideshow({ shuffle: true, breakSeconds: 8 }, 6);
    const playlists = [show];
    const t = ticker(inputFor(playlists), {
      ...NO_BREAKS,
      playlists: { show: { dueAt: START - 1000, bookmark: null, nextImageId: "show-item-3" } },
    });
    const first = breakImageOrder(show.items, "main", "show", s(0));
    const second = breakImageOrder(show.items, "main", "show", s(100));
    expect(first.map((i) => i.id)).not.toEqual(second.map((i) => i.id));
    expect([...first].map((i) => i.id).sort()).toEqual(show.items.map((i) => i.id).sort());
    // The resume cursor is ignored, and none is kept for the next break.
    expect(t.tick(s(0))?.frame?.itemId).toBe(first[0]?.id);
    expect(t.tick(s(8))).toBeNull();
    expect(t.state.playlists.show?.nextImageId).toBeNull();
    expect(t.tick(s(100))?.frame?.itemId).toBe(second[0]?.id);
    // Seeded: the same zone, playlist and start always give the same order; another zone may not.
    expect(breakImageOrder(show.items, "main", "show", s(0))).toEqual(first);
    expect(breakImageOrder(show.items, "lobby", "show", s(0))).not.toEqual(first);
  });

  test("shuffle keeps the overrun", () => {
    const t = startedTicker([
      slideshow({ shuffle: true, slideshowDwellSeconds: 6, breakSeconds: 8 }, 2),
    ]);
    t.tick(s(0));
    expect(t.tick(s(8))?.frame).not.toBeNull();
    expect(t.tick(s(12))).toBeNull();
  });
});
