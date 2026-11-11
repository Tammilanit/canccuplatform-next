import { describe, expect, it } from "vitest";
import { playlistNow } from "../src/compose/playing.js";
import type { PlayingInput } from "../src/compose/playing.js";
import { NO_BREAKS } from "../src/playback/breaks.js";
import type { PlaybackAsset, PlaybackPlaylist } from "../src/playback/timeline.js";
import { EMPTY_ZONE } from "../src/tick/zone.js";
import type { ZoneState } from "../src/tick/zone.js";
import { breakPlaylist } from "./break-fixtures.js";

const T0 = Date.parse("2026-01-01T12:00:00Z");
const iso = (ms: number): string => new Date(ms).toISOString();

const asset = (id: string, kind: PlaybackAsset["kind"], extra: Partial<PlaybackAsset> = {}) => ({
  id,
  kind,
  durationSeconds: null,
  slideCount: null,
  health: "ok" as const,
  ...extra,
});

const regular = (id: string, items: [string, number | null][]): PlaybackPlaylist => ({
  id,
  type: "regular",
  slideshowImageSeconds: null,
  items: items.map(([assetId, seconds], i) => ({
    id: `${id}-${String(i)}`,
    assetId,
    durationSeconds: seconds,
    slideStart: null,
    slideEnd: null,
    slideSeconds: null,
  })),
});

function input(over: Partial<PlayingInput> = {}): PlayingInput {
  const assets = new Map<string, PlaybackAsset>([
    ["img", asset("img", "image")],
    ["vid", asset("vid", "video", { durationSeconds: 20 })],
    ["deck", asset("deck", "pptx", { slideCount: 3 })],
    ["site", asset("site", "web")],
  ]);
  return {
    zoneKey: "main",
    state: EMPTY_ZONE,
    playlists: new Map([
      [
        "p1",
        regular("p1", [
          ["img", 10],
          ["vid", null],
        ]),
      ],
    ]),
    breakPlaylists: [],
    assets,
    files: new Map([
      ["img", { url: "/api/screen/files/aaa.png", version: 1 }],
      ["vid", { url: "/api/screen/files/bbb.mp4", version: 1 }],
      ["deck", { url: "/api/screen/files/ccc.pptx", version: 4 }],
      ["site", { url: "https://info.example/board", version: 1 }],
    ]),
    ...over,
  };
}

const playing = (over: Partial<ZoneState["playing"] & object> = {}): ZoneState => ({
  playing: {
    source: "schedule",
    pushId: null,
    scheduleId: "s1",
    playlistId: "p1",
    assetId: null,
    since: T0,
    ...over,
  },
  bookmarks: { p1: { itemId: null, slideNumber: null, offsetMs: 0, runningSince: T0 } },
  breaks: NO_BREAKS,
});

describe("playlistNow", () => {
  it("is null when nothing plays", () => {
    expect(playlistNow(input(), T0)).toBeNull();
  });

  it("names the frame playing now and the one after it, from the tick's bookmark", () => {
    const now = playlistNow(input({ state: playing() }), T0 + 4_250);
    expect(now?.view.item).toEqual({
      kind: "image",
      url: "/api/screen/files/aaa.png",
      slide_urls: [],
      started_at: iso(T0),
      offset_seconds: 0,
      duration_seconds: 10,
      muted: true,
    });
    expect(now?.view.next_item).toMatchObject({
      kind: "video",
      url: "/api/screen/files/bbb.mp4",
      started_at: iso(T0 + 10_000),
      duration_seconds: 20,
      muted: false,
    });
    expect(now?.changesAt).toBe(T0 + 10_000);
  });

  it("answers the same view at every instant of one frame, so a rebuild changes nothing", () => {
    const at = (ms: number) => playlistNow(input({ state: playing() }), ms)?.view;
    expect(at(T0 + 10_001)).toEqual(at(T0 + 29_999));
    expect(at(T0 + 10_001)).not.toEqual(at(T0 + 9_999));
  });

  it("gives a deck's slide and the item's slides for loading ahead", () => {
    const deck = regular("p1", [["deck", 6]]);
    const state = playing();
    const now = playlistNow(input({ state, playlists: new Map([["p1", deck]]) }), T0 + 7_000);
    expect(now?.view.item).toMatchObject({
      kind: "slide",
      url: "/api/screen/renders/deck/4/slide-2.png",
      slide_urls: [
        "/api/screen/renders/deck/4/slide-1.png",
        "/api/screen/renders/deck/4/slide-2.png",
        "/api/screen/renders/deck/4/slide-3.png",
      ],
      started_at: iso(T0 + 6_000),
      duration_seconds: 6,
    });
  });

  it("frames a web page by its own address", () => {
    const site = regular("p1", [["site", 30]]);
    const now = playlistNow(
      input({ state: playing(), playlists: new Map([["p1", site]]) }),
      T0 + 1_000,
    );
    expect(now?.view.item).toMatchObject({ kind: "web", url: "https://info.example/board" });
  });

  it("plays a pushed asset alone, from the instant the push began here", () => {
    const state = playing({
      source: "push",
      pushId: "push1",
      scheduleId: null,
      playlistId: null,
      assetId: "vid",
      since: T0 + 2_000,
    });
    const now = playlistNow(input({ state }), T0 + 5_000);
    expect(now?.view.item).toMatchObject({
      kind: "video",
      started_at: iso(T0 + 2_000),
      duration_seconds: 20,
    });
    expect(now?.view.next_item).toMatchObject({ kind: "video", started_at: iso(T0 + 22_000) });
  });

  it("shows a running break inside the widget, cut at the break's end, then the playlist again", () => {
    const b = breakPlaylist("b1", { breakSeconds: 15 }, [10, 10]);
    const assets = new Map(input().assets);
    for (const i of b.items) assets.set(i.assetId, asset(i.assetId, "image"));
    const files = new Map(input().files);
    files.set("b1-img-1", { url: "/api/screen/files/b1.png", version: 1 });
    files.set("b1-img-2", { url: "/api/screen/files/b2.png", version: 1 });
    const state: ZoneState = {
      ...playing(),
      // Paused at 4 s into the first image when the break began.
      bookmarks: { p1: { itemId: "p1-0", slideNumber: null, offsetMs: 4_000, runningSince: null } },
      breaks: {
        playlists: { b1: { dueAt: T0 + 200_000, bookmark: null, nextImageId: null } },
        active: { playlistId: "b1", startedAt: T0 },
        chainEndedAt: null,
      },
    };
    const at = (ms: number) =>
      playlistNow(input({ state, assets, files, breakPlaylists: [b] }), ms);
    expect(at(T0 + 12_000)?.view.item).toMatchObject({
      url: "/api/screen/files/b2.png",
      started_at: iso(T0 + 10_000),
      duration_seconds: 5,
    });
    expect(at(T0 + 12_000)?.view.next_item).toMatchObject({
      url: "/api/screen/files/aaa.png",
      started_at: iso(T0 + 11_000),
      duration_seconds: 10,
    });
    expect(at(T0 + 12_000)?.changesAt).toBe(T0 + 15_000);
  });

  it("keeps the same start across rebuilds while a break runs that shows nothing here", () => {
    // The break's images have no file, so the zone's own content shows during the break.
    const b = breakPlaylist("b1", { breakSeconds: 15 }, [10, 10]);
    const assets = new Map(input().assets);
    for (const i of b.items) assets.set(i.assetId, asset(i.assetId, "image"));
    const state: ZoneState = {
      ...playing(),
      bookmarks: { p1: { itemId: "p1-0", slideNumber: null, offsetMs: 4_000, runningSince: null } },
      breaks: {
        playlists: { b1: { dueAt: T0 + 200_000, bookmark: null, nextImageId: null } },
        active: { playlistId: "b1", startedAt: T0 },
        chainEndedAt: null,
      },
    };
    const at = (ms: number) => playlistNow(input({ state, assets, breakPlaylists: [b] }), ms);
    const first = at(T0 + 2_000)?.view;
    expect(first?.item).toMatchObject({ url: "/api/screen/files/aaa.png" });
    expect(at(T0 + 5_000)?.view).toEqual(first);
    // Past the break's end before the tick ends it: resumed at the end, as the tick will.
    expect(at(T0 + 16_000)?.view.item.started_at).toBe(iso(T0 + 11_000));
    expect(at(T0 + 18_000)?.view.item.started_at).toBe(iso(T0 + 11_000));
  });

  it("skips what has no file to show", () => {
    const files = new Map(input().files);
    files.delete("img");
    const now = playlistNow(input({ state: playing(), files }), T0 + 1_000);
    expect(now).toBeNull();
  });
});
