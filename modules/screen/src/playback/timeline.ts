/**
 * A playlist as a timeline of segments: ported from the legacy signage `playback-engine.ts`
 * (`buildPlaylistTimeline`). Pure: the playlist and its assets come in, read by the tick.
 * Segment lengths are whole seconds, as in legacy, so every container agrees on the frame.
 */

export type AssetKind = "image" | "video" | "audio" | "pptx" | "pdf" | "web" | "youtube";
/** `slide` is one slide of a rendered deck (`pptx` or `pdf`). */
export type FrameKind = "image" | "video" | "slide" | "web" | "youtube";

export interface PlaybackAsset {
  id: string;
  kind: AssetKind;
  /** A video's length read from the file; null when unknown. */
  durationSeconds: number | null;
  /** A deck's rendered slides; null until its render job has run. */
  slideCount: number | null;
  health: "ok" | "degraded" | "error";
}

/** The contract's playlist item (`duration_seconds` null: the video's own length). */
export interface PlaybackItem {
  id: string;
  assetId: string;
  durationSeconds: number | null;
  slideStart: number | null;
  slideEnd: number | null;
  slideSeconds: number | null;
}

export interface PlaybackPlaylist {
  id: string;
  type: "regular" | "slideshow" | "break";
  /** In play order. */
  items: readonly PlaybackItem[];
  /** A slideshow's time per image. */
  slideshowImageSeconds: number | null;
}

export type Assets = ReadonlyMap<string, PlaybackAsset>;

export interface Segment {
  itemId: string;
  assetId: string;
  kind: FrameKind;
  seconds: number;
  /** Set when the deck shows one slide per segment, so a bookmark can name its slide. */
  slideNumber: number | null;
  /** Set when the deck cycles these slides inside one segment, every `slideSeconds`. */
  cycle: { slides: number[]; slideSeconds: number } | null;
}

/** An auto-length item whose video has no measured length (or is no video) plays this long. */
export const FALLBACK_ITEM_SECONDS = 30;

/** A manual length always wins; auto plays a video's real length, rounded up so it is never cut. */
export function itemSeconds(item: PlaybackItem, asset: PlaybackAsset): number {
  if (item.durationSeconds !== null) return Math.max(1, Math.ceil(item.durationSeconds));
  const real = asset.durationSeconds;
  if (asset.kind === "video" && real !== null && Number.isFinite(real) && real > 0) {
    return Math.ceil(real);
  }
  return FALLBACK_ITEM_SECONDS;
}

export function clampSlideRange(
  slideCount: number,
  slideStart: number | null,
  slideEnd: number | null,
): { startSlide: number; endSlide: number } {
  const startSlide = Math.max(1, slideStart ?? 1);
  const endSlide = Math.min(slideCount, slideEnd ?? slideCount);
  return { startSlide, endSlide: Math.max(startSlide, endSlide) };
}

const FRAME_KINDS: Record<AssetKind, FrameKind | null> = {
  image: "image",
  video: "video",
  pptx: "slide",
  pdf: "slide",
  web: "web",
  youtube: "youtube",
  // Claim sounds have nothing to show.
  audio: null,
};

/** Whether an asset can be shown at all; an asset in error (a dead embed) is skipped. */
export function isPlayable(asset: PlaybackAsset | undefined): asset is PlaybackAsset {
  return asset !== undefined && asset.health !== "error" && FRAME_KINDS[asset.kind] !== null;
}

export function buildTimeline(playlist: PlaybackPlaylist, assets: Assets): Segment[] {
  return playlist.items.flatMap((item) => segmentsOf(item, assets.get(item.assetId)));
}

/** One pass through the playlist in seconds; 0 when nothing is playable. */
export function cycleSeconds(playlist: PlaybackPlaylist, assets: Assets): number {
  return buildTimeline(playlist, assets).reduce((sum, segment) => sum + segment.seconds, 0);
}

function segmentsOf(item: PlaybackItem, asset: PlaybackAsset | undefined): Segment[] {
  if (!isPlayable(asset)) return [];
  const kind = FRAME_KINDS[asset.kind] as FrameKind;
  const seconds = itemSeconds(item, asset);
  const base = { itemId: item.id, assetId: asset.id, kind, seconds };
  if (kind !== "slide") return [{ ...base, slideNumber: null, cycle: null }];
  // An unrendered deck has nothing to show yet.
  if (asset.slideCount === null || asset.slideCount < 1) return [];
  const { startSlide, endSlide } = clampSlideRange(
    asset.slideCount,
    item.slideStart,
    item.slideEnd,
  );
  const slides: number[] = [];
  for (let slide = startSlide; slide <= endSlide; slide += 1) slides.push(slide);
  if (item.slideSeconds !== null) {
    // The whole item is one segment that turns its slides; a single slide does not turn.
    const cycle =
      slides.length > 1 ? { slides, slideSeconds: Math.max(1, item.slideSeconds) } : null;
    return [{ ...base, slideNumber: cycle === null ? (slides[0] ?? null) : null, cycle }];
  }
  return slides.map((slideNumber) => ({ ...base, slideNumber, cycle: null }));
}
