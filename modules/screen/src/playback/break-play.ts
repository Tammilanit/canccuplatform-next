/**
 * What a running break shows and when it ends: ported from the legacy signage
 * `advt-playback.ts` (slideshow dwell, overrun, seeded shuffle) and the play-once and timeline
 * parts of `advt-scheduler.ts`. Pure, like the engine: the tick passes the break's start.
 */
import {
  resolveFrame,
  resumeBookmark,
  START_BOOKMARK,
  withFraction,
  type Bookmark,
  type Frame,
} from "./engine.js";
import {
  cycleSeconds,
  isPlayable,
  type Assets,
  type PlaybackItem,
  type PlaybackPlaylist,
} from "./timeline.js";

/** The contract's `BreakSettings`, as the tick reads them (`transition`, `pan_zoom` are the player's). */
export interface BreakRules {
  /** The zones it interrupts; empty for every zone. */
  zones: readonly string[];
  periodSeconds: number;
  breakSeconds: number;
  windowStartMinute: number | null;
  windowEndMinute: number | null;
  playOnce: boolean;
  region: "playlist" | "full";
  mode: "timeline" | "slideshow";
  slideshowDwellSeconds: number | null;
  shuffle: boolean;
}

export interface BreakPlaylist extends PlaybackPlaylist {
  name: string;
  priority: number;
  break: BreakRules;
}

/** What the zone keeps of one break playlist between ticks. */
export interface BreakPlaylistState {
  /** Epoch milliseconds its next break is due. */
  dueAt: number;
  /** A looping timeline break: where it stopped, so the next break goes on from there. */
  bookmark: Bookmark | null;
  /** An ordered slideshow break: the image the next break starts at. */
  nextImageId: string | null;
}

export interface BreakShow {
  frame: Frame | null;
  /** Epoch milliseconds the break ends: its length, a play-once pass or a slideshow overrun. */
  endsAt: number;
  /** For the playlist's state once the break ends. */
  nextImageId: string | null;
}

const DEFAULT_DWELL_SECONDS = 6;
/** How long the image showing at a slideshow break's end may run on to finish its dwell. */
export const OVERRUN_MAX_SECONDS = 10;

/** The bookmark a timeline break starts with: play-once always from the top. */
export function startingBookmark(playlist: BreakPlaylist, entry: BreakPlaylistState, atMs: number) {
  const loops = playlist.break.mode === "timeline" && !playlist.break.playOnce;
  return loops ? resumeBookmark(entry.bookmark ?? START_BOOKMARK, atMs) : entry.bookmark;
}

/** The break at `nowMs`, started at `startedAt`; null when it has nothing to show. */
export function showBreak(
  playlist: BreakPlaylist,
  assets: Assets,
  entry: BreakPlaylistState,
  zoneKey: string,
  startedAt: number,
  nowMs: number,
): BreakShow | null {
  return playlist.break.mode === "slideshow"
    ? showSlideshow(playlist, assets, entry, zoneKey, startedAt, nowMs)
    : showTimeline(playlist, assets, entry, startedAt, nowMs);
}

function showTimeline(
  playlist: BreakPlaylist,
  assets: Assets,
  entry: BreakPlaylistState,
  startedAt: number,
  nowMs: number,
): BreakShow | null {
  const cycle = cycleSeconds(playlist, assets);
  if (cycle === 0) return null;
  const { breakSeconds, playOnce } = playlist.break;
  // The break length is the hard cap; play-once may end the break earlier.
  const endsAt = startedAt + (playOnce ? Math.min(breakSeconds, cycle) : breakSeconds) * 1000;
  const bookmark = playOnce
    ? resumeBookmark(START_BOOKMARK, startedAt)
    : (entry.bookmark ?? resumeBookmark(START_BOOKMARK, startedAt));
  const frame = resolveFrame(playlist, assets, bookmark, nowMs, { playOnce });
  return {
    frame: frame === null ? null : { ...frame, durationSeconds: capTo(frame, endsAt, nowMs) },
    endsAt,
    nextImageId: entry.nextImageId,
  };
}

function capTo(frame: Frame, endsAt: number, nowMs: number): number {
  return Math.max(1, Math.min(frame.durationSeconds, Math.ceil((endsAt - nowMs) / 1000)));
}

function showSlideshow(
  playlist: BreakPlaylist,
  assets: Assets,
  entry: BreakPlaylistState,
  zoneKey: string,
  startedAt: number,
  nowMs: number,
): BreakShow | null {
  const images = playlist.items.filter((item) => {
    const asset = assets.get(item.assetId);
    return isPlayable(asset) && asset.kind === "image";
  });
  if (images.length === 0) return null;
  const { shuffle, breakSeconds } = playlist.break;
  const order = shuffle ? breakImageOrder(images, zoneKey, playlist.id, startedAt) : images;
  const first = shuffle
    ? 0
    : Math.max(
        0,
        order.findIndex((i) => i.id === entry.nextImageId),
      );
  const dwell = Math.max(
    1,
    Math.floor(playlist.break.slideshowDwellSeconds ?? DEFAULT_DWELL_SECONDS),
  );
  const indexAt = (elapsedSeconds: number) =>
    (first + Math.floor(elapsedSeconds / dwell)) % order.length;

  // An image cut by the break's end finishes its dwell, up to the overrun cap; the next break
  // then starts after it. Ending on an image boundary starts the next break at the next image.
  const intoLast = breakSeconds % dwell;
  const overrun = intoLast === 0 ? 0 : Math.min(dwell - intoLast, OVERRUN_MAX_SECONDS);
  const endsAt = startedAt + (breakSeconds + overrun) * 1000;
  const after = (indexAt(breakSeconds) + (intoLast === 0 ? 0 : 1)) % order.length;
  const nextImageId = shuffle ? null : (order[after]?.id ?? null);

  const elapsedMs = Math.max(0, nowMs - startedAt);
  const elapsed = Math.floor(elapsedMs / 1000);
  const imageIndex = indexAt(elapsed);
  const image = order[imageIndex] as PlaybackItem;
  const inImage = elapsed % dwell;
  const sceneSeconds = (endsAt - startedAt) / 1000;
  const frame: Frame = {
    playlistId: playlist.id,
    itemId: image.id,
    assetId: image.assetId,
    kind: "image",
    slideNumber: null,
    imageIndex,
    offsetSeconds: inImage,
    durationSeconds: Math.max(1, Math.min(dwell - inImage, Math.ceil((endsAt - nowMs) / 1000))),
    cycleSeconds: dwell * order.length,
    muted: true,
    timing: withFraction(
      {
        sceneSeconds,
        sceneElapsedSeconds: Math.min(sceneSeconds, elapsed),
        pageSeconds: order.length > 1 ? dwell : null,
        pageElapsedSeconds: order.length > 1 ? inImage : null,
      },
      (elapsedMs % 1000) / 1000,
    ),
  };
  return { frame, endsAt, nextImageId };
}

/**
 * A shuffled break's image order, seeded by the zone, the playlist and the break's start: a new
 * order every break, worked out alike by every container (legacy seeded by the start alone).
 */
export function breakImageOrder<T>(
  images: readonly T[],
  zoneKey: string,
  playlistId: string,
  startedAt: number,
): T[] {
  const shuffled = images.slice();
  const random = mulberry32(fnv1a(`${zoneKey}\n${playlistId}\n${startedAt}`));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap] as T, shuffled[index] as T];
  }
  return shuffled;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

/** The legacy's seeded generator (mulberry32). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
