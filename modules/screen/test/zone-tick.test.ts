// The pure step of one zone's tick: what plays (a push above every window), and the bookmarks
// it pauses and resumes around breaks and switches, so a playlist comes back where it stopped.
import { describe, expect, test } from "vitest";
import { advanceZone, EMPTY_ZONE, type ZoneInput, type ZoneState } from "../src/tick/zone.js";
import type { PlaybackPlaylist } from "../src/playback/timeline.js";
import { breakPlaylist, image, inputFor } from "./break-fixtures.js";

const T0 = Date.parse("2026-01-01T12:00:00Z");

function regular(id: string, seconds: number[]): PlaybackPlaylist {
  return {
    id,
    type: "regular",
    slideshowImageSeconds: null,
    items: seconds.map((s, i) => ({
      id: `${id}-item-${i + 1}`,
      assetId: `${id}-img-${i + 1}`,
      durationSeconds: s,
      slideStart: null,
      slideEnd: null,
      slideSeconds: null,
    })),
  };
}

const A = regular("pl_a", [10, 10, 10]);
const B = regular("pl_b", [20]);

function input(extra: Partial<ZoneInput> = {}): ZoneInput {
  const breaks = inputFor([]);
  const assets = new Map(breaks.assets);
  for (const p of [A, B]) for (const item of p.items) assets.set(item.assetId, image(item.assetId));
  return {
    winner: { id: "sc_1", playlistId: "pl_a" },
    push: null,
    playlists: new Map([
      ["pl_a", A],
      ["pl_b", B],
    ]),
    breaks: { ...breaks, assets },
    ...extra,
  };
}

describe("advanceZone", () => {
  test("plays the winning window's playlist from the top and keeps its start", () => {
    const first = advanceZone(EMPTY_ZONE, input(), T0);
    expect(first.playing).toEqual({
      source: "schedule",
      pushId: null,
      scheduleId: "sc_1",
      playlistId: "pl_a",
      assetId: null,
      since: T0,
    });
    expect(first.bookmarks.pl_a).toEqual({
      itemId: null,
      slideNumber: null,
      offsetMs: 0,
      runningSince: T0,
    });
    const later = advanceZone(first, input(), T0 + 5000);
    expect(later.playing?.since).toBe(T0);
    expect(later.bookmarks.pl_a).toEqual(first.bookmarks.pl_a);
  });

  test("nothing plays without a window or a push", () => {
    const state = advanceZone(EMPTY_ZONE, input({ winner: null }), T0);
    expect(state.playing).toBeNull();
    expect(state.bookmarks).toEqual({});
  });

  test("a push plays above the window; the window's playlist pauses where it was", () => {
    const playing = advanceZone(EMPTY_ZONE, input(), T0);
    const push = { id: "pu_1", playlistId: "pl_b", assetId: null };
    const pushed = advanceZone(playing, input({ push }), T0 + 15_000);
    expect(pushed.playing).toMatchObject({ source: "push", pushId: "pu_1", playlistId: "pl_b" });
    expect(pushed.bookmarks.pl_a).toEqual({
      itemId: "pl_a-item-2",
      slideNumber: null,
      offsetMs: 5000,
      runningSince: null,
    });
    expect(pushed.bookmarks.pl_b?.runningSince).toBe(T0 + 15_000);

    // The push ends: the window's playlist goes on from its second item, not the top.
    const back = advanceZone(pushed, input(), T0 + 60_000);
    expect(back.playing).toMatchObject({
      source: "schedule",
      playlistId: "pl_a",
      since: T0 + 60_000,
    });
    expect(back.bookmarks.pl_a).toMatchObject({ itemId: "pl_a-item-2", offsetMs: 5000 });
    expect(back.bookmarks.pl_a?.runningSince).toBe(T0 + 60_000);
    expect(back.bookmarks.pl_b?.runningSince).toBeNull();
  });

  test("an asset push runs no playlist, so every bookmark pauses", () => {
    const playing = advanceZone(EMPTY_ZONE, input(), T0);
    const push = { id: "pu_2", playlistId: null, assetId: "as_9" };
    const pushed = advanceZone(playing, input({ push }), T0 + 3000);
    expect(pushed.playing).toMatchObject({ source: "push", assetId: "as_9", playlistId: null });
    expect(pushed.bookmarks.pl_a?.runningSince).toBeNull();
  });

  test("a push whose playlist is gone falls back to the window", () => {
    const push = { id: "pu_3", playlistId: "pl_gone", assetId: null };
    const state = advanceZone(EMPTY_ZONE, input({ push }), T0);
    expect(state.playing).toMatchObject({ source: "schedule", playlistId: "pl_a" });
  });

  test("a break pauses the playlist and it resumes at the same place after", () => {
    const ad = breakPlaylist("pl_ad", { periodSeconds: 60, breakSeconds: 10 });
    const base = input();
    const withBreak = input({
      breaks: {
        ...base.breaks,
        playlists: [ad],
        assets: new Map([...base.breaks.assets, ["pl_ad-img-1", image("pl_ad-img-1")]]),
      },
    });
    let state: ZoneState = advanceZone(EMPTY_ZONE, withBreak, T0);
    expect(state.breaks.playlists.pl_ad?.dueAt).toBe(T0 + 60_000);
    state = advanceZone(state, withBreak, T0 + 60_000);
    expect(state.breaks.active).toEqual({ playlistId: "pl_ad", startedAt: T0 + 60_000 });
    // 60 s into a 30 s cycle: the top of the first item again.
    expect(state.bookmarks.pl_a).toMatchObject({ itemId: "pl_a-item-1", runningSince: null });
    expect(state.playing?.since).toBe(T0);

    state = advanceZone(state, withBreak, T0 + 70_000);
    expect(state.breaks.active).toBeNull();
    expect(state.bookmarks.pl_a).toMatchObject({
      itemId: "pl_a-item-1",
      offsetMs: 0,
      runningSince: T0 + 70_000,
    });
  });

  test("a deleted playlist's bookmark is dropped", () => {
    const playing = advanceZone(EMPTY_ZONE, input(), T0);
    const state = advanceZone(
      playing,
      input({ winner: null, playlists: new Map([["pl_b", B]]) }),
      T0 + 1000,
    );
    expect(state.bookmarks).toEqual({});
  });
});
