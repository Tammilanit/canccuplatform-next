/**
 * What a playlist shows at an instant, from its bookmark: ported from the legacy signage
 * `playback-engine.ts` (`resolvePlaybackFrameFromBookmark`) and the bookmark maths of
 * `playback-bookmark.ts`. Pure: the tick alone saves bookmarks (step 3 brief, "reads that write").
 *
 * A bookmark is a position and, while its playlist plays, the instant it started running from
 * there; the position at any time is the saved offset plus the time since. Legacy kept running
 * bookmarks only, rewrote their time on every read to freeze them, and its screens posted their
 * own offsets back (the double-counted offset). Here the tick pauses a bookmark when its
 * playlist stops (a break, another window) and resumes it when it plays again.
 */
import {
  buildTimeline,
  isPlayable,
  type Assets,
  type FrameKind,
  type PlaybackPlaylist,
  type Segment,
} from "./timeline.js";

export interface Bookmark {
  itemId: string | null;
  /** The slide of a deck shown one slide per segment, so a deck resumes at its slide. */
  slideNumber: number | null;
  /** Into that segment (a slideshow: into its cycle) when saved, in milliseconds. */
  offsetMs: number;
  /** Epoch milliseconds it has run since; null while paused. */
  runningSince: number | null;
}

export const START_BOOKMARK: Bookmark = {
  itemId: null,
  slideNumber: null,
  offsetMs: 0,
  runningSince: null,
};

/** Progress bars: the scene (item, slideshow cycle or break) and its page (slide or image). */
export interface Timing {
  sceneSeconds: number;
  sceneElapsedSeconds: number;
  pageSeconds: number | null;
  pageElapsedSeconds: number | null;
}

export interface Frame {
  playlistId: string;
  itemId: string;
  assetId: string;
  kind: FrameKind;
  slideNumber: number | null;
  /** The image's place in a slideshow's order. */
  imageIndex: number | null;
  /** Whole seconds into the item (a slideshow: into the image). */
  offsetSeconds: number;
  /** Whole seconds until the frame changes, at least 1. */
  durationSeconds: number;
  cycleSeconds: number;
  muted: boolean;
  timing: Timing;
}

/** Milliseconds from the bookmark's segment start to `nowMs`. */
function positionMs(bookmark: Bookmark, nowMs: number): number {
  const running = bookmark.runningSince === null ? 0 : Math.max(0, nowMs - bookmark.runningSince);
  return Math.max(0, bookmark.offsetMs) + running;
}

export function resumeBookmark(bookmark: Bookmark, atMs: number): Bookmark {
  return bookmark.runningSince === null ? { ...bookmark, runningSince: atMs } : bookmark;
}

/** The bookmark stopped at `atMs`: the segment shown then, and how far into it. */
export function pauseBookmark(
  playlist: PlaybackPlaylist,
  assets: Assets,
  bookmark: Bookmark,
  atMs: number,
): Bookmark {
  if (bookmark.runningSince === null) return bookmark;
  const ms = positionMs(bookmark, atMs);
  if (playlist.type === "slideshow") {
    const show = slideshowOf(playlist, assets);
    if (show === null) return { ...START_BOOKMARK };
    const inCycleMs = ms % (show.cycleSeconds * 1000);
    const image = show.images[Math.floor(inCycleMs / 1000 / show.imageSeconds)];
    return {
      itemId: image?.id ?? null,
      slideNumber: null,
      offsetMs: inCycleMs,
      runningSince: null,
    };
  }
  const timeline = timelineOf(playlist, assets);
  if (timeline === null) return { ...START_BOOKMARK };
  const at = walk(timeline, bookmark, ms);
  const segment = timeline.segments[at.index] as Segment;
  return {
    itemId: segment.itemId,
    slideNumber: segment.slideNumber,
    offsetMs: at.offsetSeconds * 1000 + (ms % 1000),
    runningSince: null,
  };
}

/** The frame at `nowMs`; null when nothing is playable, or a play-once pass is over. */
export function resolveFrame(
  playlist: PlaybackPlaylist,
  assets: Assets,
  bookmark: Bookmark,
  nowMs: number,
  options: { playOnce?: boolean } = {},
): Frame | null {
  const ms = positionMs(bookmark, nowMs);
  if (playlist.type === "slideshow") return slideshowFrame(playlist, assets, ms);
  const timeline = timelineOf(playlist, assets);
  if (timeline === null) return null;
  if (options.playOnce === true && Math.floor(ms / 1000) >= timeline.cycleSeconds) return null;
  const at = walk(timeline, bookmark, ms);
  const segment = timeline.segments[at.index] as Segment;
  const page = pageAt(segment, at.offsetSeconds);
  return {
    playlistId: playlist.id,
    itemId: segment.itemId,
    assetId: segment.assetId,
    kind: segment.kind,
    slideNumber: page.slideNumber,
    imageIndex: null,
    offsetSeconds: at.offsetSeconds,
    durationSeconds: Math.max(1, page.secondsUntilChange),
    cycleSeconds: timeline.cycleSeconds,
    muted: segment.kind !== "video" && segment.kind !== "youtube",
    timing: withFraction(page.timing, (ms % 1000) / 1000),
  };
}

interface Timeline {
  segments: Segment[];
  cycleSeconds: number;
}

function timelineOf(playlist: PlaybackPlaylist, assets: Assets): Timeline | null {
  const segments = buildTimeline(playlist, assets);
  const cycleSeconds = segments.reduce((sum, segment) => sum + segment.seconds, 0);
  return cycleSeconds > 0 ? { segments, cycleSeconds } : null;
}

/** Where the bookmark's segment is: its slide's segment, else the item's first, else the top. */
function startIndex(segments: Segment[], bookmark: Bookmark): number {
  if (bookmark.itemId === null) return 0;
  const ofItem = (s: Segment) => s.itemId === bookmark.itemId;
  const exact =
    bookmark.slideNumber === null
      ? -1
      : segments.findIndex((s) => ofItem(s) && s.slideNumber === bookmark.slideNumber);
  if (exact >= 0) return exact;
  return Math.max(0, segments.findIndex(ofItem));
}

/** Walk whole seconds from the bookmark's segment, skipping whole cycles first. */
function walk(timeline: Timeline, bookmark: Bookmark, ms: number) {
  const { segments, cycleSeconds } = timeline;
  let remaining = Math.floor(ms / 1000) % cycleSeconds;
  let index = startIndex(segments, bookmark);
  while (remaining >= (segments[index] as Segment).seconds) {
    remaining -= (segments[index] as Segment).seconds;
    index = (index + 1) % segments.length;
  }
  return { index, offsetSeconds: remaining };
}

function pageAt(segment: Segment, offsetSeconds: number) {
  const { seconds, cycle } = segment;
  const scene = { sceneSeconds: seconds, sceneElapsedSeconds: offsetSeconds };
  if (cycle === null) {
    return {
      slideNumber: segment.slideNumber,
      secondsUntilChange: seconds - offsetSeconds,
      timing: { ...scene, pageSeconds: null, pageElapsedSeconds: null },
    };
  }
  const { slides, slideSeconds } = cycle;
  const inSlide = offsetSeconds % slideSeconds;
  return {
    slideNumber: slides[Math.floor(offsetSeconds / slideSeconds) % slides.length] ?? null,
    secondsUntilChange: Math.min(slideSeconds - inSlide, seconds - offsetSeconds),
    timing: {
      ...scene,
      // The last slide is cut short when the item is not a multiple of the slide time.
      pageSeconds: Math.min(slideSeconds, seconds - (offsetSeconds - inSlide)),
      pageElapsedSeconds: inSlide,
    },
  };
}

/** The bars carry the sub-second part the frame choice floors, so they end at the real switch. */
export function withFraction(timing: Timing, fraction: number): Timing {
  const advance = (elapsed: number, total: number) => Math.min(total, elapsed + fraction);
  return {
    ...timing,
    sceneElapsedSeconds: advance(timing.sceneElapsedSeconds, timing.sceneSeconds),
    pageElapsedSeconds:
      timing.pageSeconds === null || timing.pageElapsedSeconds === null
        ? null
        : advance(timing.pageElapsedSeconds, timing.pageSeconds),
  };
}

/** A slideshow's images (in order, error-free) and its cycle; null when it has none. */
function slideshowOf(playlist: PlaybackPlaylist, assets: Assets) {
  const images = playlist.items.filter((item) => {
    const asset = assets.get(item.assetId);
    return isPlayable(asset) && asset.kind === "image";
  });
  if (images.length === 0) return null;
  const imageSeconds = Math.max(1, playlist.slideshowImageSeconds ?? DEFAULT_IMAGE_SECONDS);
  return { images, imageSeconds, cycleSeconds: imageSeconds * images.length };
}

const DEFAULT_IMAGE_SECONDS = 10;

function slideshowFrame(playlist: PlaybackPlaylist, assets: Assets, ms: number): Frame | null {
  const show = slideshowOf(playlist, assets);
  if (show === null) return null;
  const { images, imageSeconds, cycleSeconds } = show;
  const inCycle = Math.floor(ms / 1000) % cycleSeconds;
  const imageIndex = Math.floor(inCycle / imageSeconds);
  const image = images[imageIndex] as (typeof images)[number];
  const inImage = inCycle % imageSeconds;
  return {
    playlistId: playlist.id,
    itemId: image.id,
    assetId: image.assetId,
    kind: "image",
    slideNumber: null,
    imageIndex,
    offsetSeconds: inImage,
    durationSeconds: Math.max(1, Math.min(imageSeconds - inImage, cycleSeconds - inCycle)),
    cycleSeconds,
    muted: true,
    timing: withFraction(
      {
        sceneSeconds: cycleSeconds,
        sceneElapsedSeconds: inCycle,
        pageSeconds: images.length > 1 ? imageSeconds : null,
        pageElapsedSeconds: images.length > 1 ? inImage : null,
      },
      (ms % 1000) / 1000,
    ),
  };
}
