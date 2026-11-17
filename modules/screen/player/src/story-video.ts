/**
 * A storyboard's video step (contracts/screen.md, Moments drive it: claims, The video step): a
 * claim with template `video` plays its file or YouTube video full screen from `started_at` on
 * the server clock, so every screen of the zone shows the same frame (an uploaded file within the
 * 200 ms of the sound sync; YouTube best effort); while `paused_at` is set it holds the frame it
 * stopped on, and Moments moves `started_at` on by the pause when it resumes. Only the zone's
 * sound screen sounds it, never in a zone Moments lists in `muted_zones`. A screen that cannot
 * play it skips it (the rotation shows) and says why in its next heartbeat.
 */
import type { PlayItem } from "./media.js";

const YOUTUBE = "https://www.youtube-nocookie.com";
/** The claims this screen gave up on, and why, until the page reloads. */
const failed = new Map<string, string>();
const errors: { code: string; item_id: string; detail: string }[] = [];

/** Seconds into the video at `serverNowMs`: the same on every screen whose clock offset is known. */
export function videoPosition(view: Record<string, unknown>, serverNowMs: number): number {
  const start = Date.parse(String(view.started_at));
  if (Number.isNaN(start)) return 0;
  const at = typeof view.paused_at === "string" ? Date.parse(view.paused_at) : serverNowMs;
  return Math.max(0, (Math.min(at, serverNowMs) - start) / 1000);
}

/** The embed URL a `youtube` asset plays through (the one embed the screens allow). */
export function youtubeEmbed(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin === YOUTUBE) return u.toString();
  const id = u.hostname.endsWith("youtube.com")
    ? u.searchParams.get("v")
    : u.hostname === "youtu.be"
      ? u.pathname.slice(1)
      : null;
  return id === null || !/^[\w-]{6,20}$/.test(id)
    ? null
    : `${YOUTUBE}/embed/${id}?autoplay=1&controls=0`;
}

/** The video as the media drawer plays it, or null for a view this player cannot read. */
export function videoItem(view: Record<string, unknown>, zone: string): PlayItem | null {
  const kind = view.kind === "youtube" ? "youtube" : "video";
  const url =
    kind === "youtube"
      ? youtubeEmbed(String(view.url))
      : typeof view.url === "string"
        ? view.url
        : null;
  if (url === null || typeof view.started_at !== "string") return null;
  const muted = Array.isArray(view.muted_zones) && view.muted_zones.includes(zone);
  return {
    kind,
    url,
    slide_urls: [],
    started_at: view.started_at,
    offset_seconds: 0,
    duration_seconds: 86_400,
    muted,
  };
}

export const skipped = (claimId: string): boolean => failed.has(claimId);

/** This screen cannot play the claim's video: it skips it and reports the reason once. */
export function skipVideo(claimId: string, code: string, detail: string): void {
  if (failed.has(claimId)) return;
  failed.set(claimId, code);
  errors.push({ code, item_id: claimId, detail: detail.slice(0, 500) });
}

/** The errors not yet reported, for the heartbeat; at most its 20. */
export function takeErrors(): { code: string; item_id: string; detail: string }[] {
  return errors.splice(0, 20);
}
