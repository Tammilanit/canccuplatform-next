/**
 * The `photo` widget's choice (contracts/screen.md, Photos): a new photo first, `featured` once,
 * then all of them in turn, each for `photo_dwell_seconds`. A pure function of the photos and the
 * time, so every container and every screen of a zone agree and no read has to write down that a
 * photo was featured: each photo's feature follows the one before it, in the order they came.
 */
import type { Settings } from "../health.js";

/** `photo_dwell_seconds` (5–60, 8: contracts/screen.md, Settings). */
export function photoDwell(settings: Settings): number {
  const value = settings.get("photo_dwell_seconds", 8);
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(60, Math.max(5, Math.round(value)))
    : 8;
}

export interface PhotoRow {
  id: string;
  url: string;
  caption: string | null;
  author_name: string | null;
  posted_at: string;
  /** Epoch milliseconds the photo was added. */
  created_at: number;
}

type Arrival = Pick<PhotoRow, "id" | "created_at">;

const byArrival = (a: Arrival, b: Arrival): number =>
  a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** When each photo's feature ends: one dwell from its arrival, or from the end of the one before. */
export function featuredUntil(
  photos: readonly Arrival[],
  dwellSeconds: number,
): Map<string, number> {
  const until = new Map<string, number>();
  let end = -Infinity;
  for (const p of [...photos].sort(byArrival)) {
    end = Math.max(p.created_at, end) + dwellSeconds * 1000;
    until.set(p.id, end);
  }
  return until;
}

const viewOf = (p: PhotoRow, featured: boolean): Record<string, unknown> => ({
  url: p.url,
  caption: p.caption,
  author_name: p.author_name,
  posted_at: p.posted_at,
  featured,
});

/** The photo shown at `nowMs` and when that changes; null without photos. */
export function photoNow(
  photos: readonly PhotoRow[],
  dwellSeconds: number,
  nowMs: number,
): { view: Record<string, unknown>; changesAt: number | null } | null {
  if (photos.length === 0) return null;
  const dwellMs = dwellSeconds * 1000;
  const until = featuredUntil(photos, dwellSeconds);
  for (const p of photos) {
    const end = until.get(p.id) ?? 0;
    if (nowMs >= end - dwellMs && nowMs < end) return { view: viewOf(p, true), changesAt: end };
  }
  const newest = [...photos].sort(byArrival).reverse();
  const slot = Math.floor(nowMs / dwellMs);
  const shown = newest[slot % newest.length] as PhotoRow;
  // One photo turns into itself: nothing to rebuild for until a new photo arrives (its event).
  const changesAt = newest.length === 1 ? null : (slot + 1) * dwellMs;
  return { view: viewOf(shown, false), changesAt };
}
