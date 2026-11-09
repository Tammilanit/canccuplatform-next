import type { BreakPlaylist, BreakRules } from "../src/playback/break-play.js";
import { NO_BREAKS, stepBreaks, type BreakInput, type BreakState } from "../src/playback/breaks.js";
import type { PlaybackAsset } from "../src/playback/timeline.js";

export function image(id: string): PlaybackAsset {
  return { id, kind: "image", durationSeconds: null, slideCount: null, health: "ok" };
}

/** A break playlist of images, `itemSeconds` each (`null` items for a slideshow). */
export function breakPlaylist(
  id: string,
  rules: Partial<BreakRules> & { priority?: number; name?: string },
  itemSeconds: (number | null)[] = [10],
): BreakPlaylist {
  const { priority = 1, name = id, ...rest } = rules;
  return {
    id,
    name,
    priority,
    type: "break",
    slideshowImageSeconds: null,
    items: itemSeconds.map((seconds, index) => ({
      id: `${id}-item-${index + 1}`,
      assetId: `${id}-img-${index + 1}`,
      durationSeconds: seconds,
      slideStart: null,
      slideEnd: null,
      slideSeconds: null,
    })),
    break: {
      zones: [],
      periodSeconds: 100,
      breakSeconds: 10,
      windowStartMinute: null,
      windowEndMinute: null,
      playOnce: false,
      region: "playlist",
      mode: "timeline",
      slideshowDwellSeconds: null,
      shuffle: false,
      ...rest,
    },
  };
}

export function inputFor(playlists: BreakPlaylist[], extra: Partial<BreakInput> = {}): BreakInput {
  const assets = new Map<string, PlaybackAsset>();
  for (const playlist of playlists) {
    for (const item of playlist.items) assets.set(item.assetId, image(item.assetId));
  }
  return { zoneKey: "main", playlists, assets, timeZone: "UTC", minGapSeconds: 60, ...extra };
}

/** A zone's tick: the state carries over from one call to the next, as the tick stores it. */
export function ticker(input: BreakInput, initial: BreakState = NO_BREAKS) {
  let state = initial;
  return {
    tick(nowMs: number) {
      const result = stepBreaks(state, input, nowMs);
      state = result.state;
      return result.playing;
    },
    get state() {
      return state;
    },
    setDue(playlistId: string, dueAt: number) {
      const entry = state.playlists[playlistId] ?? { bookmark: null, nextImageId: null };
      state = { ...state, playlists: { ...state.playlists, [playlistId]: { ...entry, dueAt } } };
    },
    dueOf: (playlistId: string) => state.playlists[playlistId]?.dueAt,
  };
}
