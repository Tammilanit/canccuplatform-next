/**
 * The `playlist` widget's view-model (contracts/screen.md, Widgets): what the zone's tick has the
 * playlist widget play now, and what follows, read from the stored playback state and never
 * written (the tick alone advances it). Pure, like the playback core it reads.
 *
 * `started_at` is the instant the frame began, or would have begun had it played from its start
 * (a video resumed after a break), so `offset_seconds` is 0 and the screen seeks to now minus
 * `started_at`. That makes the view the same at every instant of one frame: a rebuild in between
 * moves no `state_version`, and only a new frame pushes a `widget` message.
 */
import { showBreak } from "../playback/break-play.js";
import { slideUrl } from "../render/jobs.js";
import type { BreakPlaylist } from "../playback/break-play.js";
import { resolveFrame, resumeBookmark, START_BOOKMARK } from "../playback/engine.js";
import type { Bookmark, Frame } from "../playback/engine.js";
import { clampSlideRange } from "../playback/timeline.js";
import type { Assets, PlaybackPlaylist } from "../playback/timeline.js";
import type { ZoneState } from "../tick/zone.js";

export interface PlayItem {
  kind: Frame["kind"];
  url: string;
  slide_urls: string[];
  started_at: string;
  offset_seconds: number;
  duration_seconds: number;
  muted: boolean;
}

export interface PlaylistView {
  item: PlayItem;
  next_item: PlayItem | null;
}

/** An asset's address: its current version's file, or a web or YouTube asset's own URL. */
export interface AssetFile {
  url: string | null;
  version: number;
}

export interface PlayingInput {
  zoneKey: string;
  state: ZoneState;
  playlists: ReadonlyMap<string, PlaybackPlaylist>;
  breakPlaylists: readonly BreakPlaylist[];
  assets: Assets;
  files: ReadonlyMap<string, AssetFile>;
}

interface Timed {
  item: PlayItem;
  endsAt: number;
}

/** The frame resolved at `t` as an item, ending at its next change or at `capAt`. */
function itemOf(
  input: PlayingInput,
  playlist: PlaybackPlaylist,
  frame: Frame,
  t: number,
  capAt: number,
): Timed | null {
  const file = input.files.get(frame.assetId);
  if (file === undefined || file.url === null) return null;
  const elapsedMs = Math.round(
    (frame.timing.pageElapsedSeconds ?? frame.timing.sceneElapsedSeconds) * 1000,
  );
  const startedAt = t - elapsedMs;
  const endsAt = Math.min(capAt, t - (elapsedMs % 1000) + frame.durationSeconds * 1000);
  let url = file.url;
  const slides: string[] = [];
  if (frame.kind === "slide" && frame.slideNumber !== null) {
    const entry = playlist.items.find((i) => i.id === frame.itemId);
    const count = input.assets.get(frame.assetId)?.slideCount ?? 0;
    const range = clampSlideRange(count, entry?.slideStart ?? null, entry?.slideEnd ?? null);
    for (let n = range.startSlide; n <= range.endSlide; n++) {
      slides.push(slideUrl(frame.assetId, file.version, n));
    }
    url = slideUrl(frame.assetId, file.version, frame.slideNumber);
  } else if (frame.kind === "slide") {
    return null;
  }
  return {
    item: {
      kind: frame.kind,
      url,
      slide_urls: slides,
      started_at: new Date(startedAt).toISOString(),
      offset_seconds: 0,
      duration_seconds: (endsAt - startedAt) / 1000,
      muted: frame.muted,
    },
    endsAt,
  };
}

/** The zone's own content (a push or the winning window) with its bookmark, without breaks. */
function own(input: PlayingInput): { playlist: PlaybackPlaylist; bookmark: Bookmark } | null {
  const playing = input.state.playing;
  if (playing === null) return null;
  if (playing.playlistId === null) {
    if (playing.assetId === null) return null;
    // A pushed asset plays alone, looping, from the instant the push began here.
    const item = {
      id: playing.assetId,
      assetId: playing.assetId,
      durationSeconds: null,
      slideStart: null,
      slideEnd: null,
      slideSeconds: null,
    };
    const playlist: PlaybackPlaylist = {
      id: `push:${playing.pushId ?? ""}`,
      type: "regular",
      slideshowImageSeconds: null,
      items: [item],
    };
    return { playlist, bookmark: resumeBookmark(START_BOOKMARK, playing.since) };
  }
  const playlist = input.playlists.get(playing.playlistId);
  if (playlist === undefined) return null;
  const bookmark =
    input.state.bookmarks[playlist.id] ?? resumeBookmark(START_BOOKMARK, playing.since);
  return { playlist, bookmark };
}

/** The zone's own content at `t`, its bookmark running from `resumeAt` when it is paused. */
function ownAt(input: PlayingInput, t: number, resumeAt: number): Timed | null {
  const found = own(input);
  if (found === null) return null;
  const bookmark = resumeBookmark(found.bookmark, resumeAt);
  const frame = resolveFrame(found.playlist, input.assets, bookmark, t);
  return frame === null ? null : itemOf(input, found.playlist, frame, t, Infinity);
}

/** The running break's playlist and what it shows at `t`; null when no break runs. */
function breakShow(input: PlayingInput, t: number) {
  const active = input.state.breaks.active;
  if (active === null) return null;
  const playlist = input.breakPlaylists.find((p) => p.id === active.playlistId);
  const entry = input.state.breaks.playlists[active.playlistId];
  if (playlist === undefined || entry === undefined) return null;
  const show = showBreak(playlist, input.assets, entry, input.zoneKey, active.startedAt, t);
  return show === null ? null : { playlist, show };
}

/** The running break at `t`, if it still shows something then. */
function breakAt(input: PlayingInput, t: number): (Timed & { breakEndsAt: number }) | null {
  const found = breakShow(input, t);
  if (found === null) return null;
  const { playlist, show } = found;
  if (show.frame === null || t >= show.endsAt) return null;
  const timed = itemOf(input, playlist, show.frame, t, show.endsAt);
  return timed === null ? null : { ...timed, breakEndsAt: show.endsAt };
}

/**
 * When the zone's own bookmark, paused by a break that shows nothing here, runs again: the break's
 * end once it has passed (as the tick will resume it), else the break's start. Never `nowMs`, or
 * every rebuild would move `started_at` and restart the video on every screen.
 */
function resumeAt(input: PlayingInput, nowMs: number): number {
  const active = input.state.breaks.active;
  if (active === null) return nowMs;
  const endsAt = breakShow(input, nowMs)?.show.endsAt;
  return endsAt !== undefined && nowMs >= endsAt ? endsAt : active.startedAt;
}

/**
 * The view now and when it changes; null when the widget has nothing to play. A break of either
 * region shows inside the widget: the composed state has no place for a `full` one yet.
 */
export function playlistNow(
  input: PlayingInput,
  nowMs: number,
): { view: PlaylistView; changesAt: number } | null {
  const inBreak = breakAt(input, nowMs);
  if (inBreak !== null) {
    const end = inBreak.endsAt;
    const next =
      end < inBreak.breakEndsAt ? breakAt(input, end) : ownAt(input, end, inBreak.breakEndsAt);
    return { view: { item: inBreak.item, next_item: next?.item ?? null }, changesAt: end };
  }
  const resume = resumeAt(input, nowMs);
  const now = ownAt(input, nowMs, resume);
  if (now === null) return null;
  const next = ownAt(input, now.endsAt, resume);
  return { view: { item: now.item, next_item: next?.item ?? null }, changesAt: now.endsAt };
}
