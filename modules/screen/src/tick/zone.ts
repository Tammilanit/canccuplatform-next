/**
 * One step of a zone's tick (contracts/screen.md, Scheduler): what the zone's playlist widget
 * plays, a push above every window, and the bookmarks that pause when their playlist stops (a
 * break, a push, another window) and resume when it plays again. Pure: the runner (`run.ts`)
 * reads the inputs, calls this and stores the result, so reading the state never writes.
 */
import { stepBreaks, NO_BREAKS, type BreakInput, type BreakState } from "../playback/breaks.js";
import {
  pauseBookmark,
  resumeBookmark,
  START_BOOKMARK,
  type Bookmark,
} from "../playback/engine.js";
import type { PlaybackPlaylist } from "../playback/timeline.js";

export interface ZonePlaying {
  source: "push" | "schedule";
  pushId: string | null;
  scheduleId: string | null;
  /** Null for a pushed asset, which plays alone. */
  playlistId: string | null;
  assetId: string | null;
  /** Epoch milliseconds it began to play here, kept while it plays on. */
  since: number;
}

export interface ZoneState {
  playing: ZonePlaying | null;
  /** By playlist id: where each playlist that played in this zone stands. */
  bookmarks: Readonly<Record<string, Bookmark>>;
  breaks: BreakState;
}

export const EMPTY_ZONE: ZoneState = { playing: null, bookmarks: {}, breaks: NO_BREAKS };

export interface ZoneInput {
  /** The winning schedule window (`resolveWinner`), or null. */
  winner: { id: string; playlistId: string } | null;
  /** The newest active push naming this zone, or null. */
  push: { id: string; playlistId: string | null; assetId: string | null } | null;
  /** The event's regular and slideshow playlists by id. */
  playlists: ReadonlyMap<string, PlaybackPlaylist>;
  /** The zone's break playlists, and the assets of every playlist. */
  breaks: BreakInput;
}

type Wanted = Omit<ZonePlaying, "since">;

function wanted(input: ZoneInput): Wanted | null {
  const { push, winner, playlists } = input;
  // A push whose playlist was deleted under it shows nothing; the window plays instead.
  if (push !== null && (push.playlistId === null || playlists.has(push.playlistId))) {
    return { source: "push", pushId: push.id, scheduleId: null, ...pushTarget(push) };
  }
  if (winner === null || !playlists.has(winner.playlistId)) return null;
  return {
    source: "schedule",
    pushId: null,
    scheduleId: winner.id,
    playlistId: winner.playlistId,
    assetId: null,
  };
}

function pushTarget(push: NonNullable<ZoneInput["push"]>) {
  return { playlistId: push.playlistId, assetId: push.playlistId === null ? push.assetId : null };
}

function samePlaying(a: ZonePlaying | null, b: Wanted): a is ZonePlaying {
  return (
    a !== null &&
    a.source === b.source &&
    a.pushId === b.pushId &&
    a.scheduleId === b.scheduleId &&
    a.playlistId === b.playlistId &&
    a.assetId === b.assetId
  );
}

export function advanceZone(state: ZoneState, input: ZoneInput, nowMs: number): ZoneState {
  const breaks = stepBreaks(state.breaks, input.breaks, nowMs);
  const next = wanted(input);
  const playing =
    next === null
      ? null
      : samePlaying(state.playing, next)
        ? state.playing
        : { ...next, since: nowMs };
  // A break of either region stops the playlist widget's own playlist until it ends.
  const running = breaks.playing === null ? (playing?.playlistId ?? null) : null;
  const bookmarks: Record<string, Bookmark> = {};
  for (const [id, bookmark] of Object.entries(state.bookmarks)) {
    const playlist = input.playlists.get(id);
    if (playlist === undefined) continue;
    bookmarks[id] =
      id === running
        ? resumeBookmark(bookmark, nowMs)
        : pauseBookmark(playlist, input.breaks.assets, bookmark, nowMs);
  }
  if (running !== null && bookmarks[running] === undefined) {
    bookmarks[running] = resumeBookmark(START_BOOKMARK, nowMs);
  }
  return { playing, bookmarks, breaks: breaks.state };
}
