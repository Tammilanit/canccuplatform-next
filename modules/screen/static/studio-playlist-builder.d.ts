/** Types for studio-playlist-builder.js, which the page loads as it is; only the tests read these. */

/** What the builder knows of an asset (the page's `canccu-studio-library` block). */
export interface BuilderAsset {
  kind: "image" | "video" | "audio" | "pptx" | "pdf" | "web" | "youtube";
  title: string;
  duration_seconds: number | null;
  /** A deck's rendered slides; null until its render has run. */
  slides: number | null;
  health: "ok" | "degraded" | "error";
}

/** The contract's `PlaylistItem`. */
export interface BuilderItem {
  id: string | null;
  asset_id: string;
  duration_seconds: number | null;
  slide_start: number | null;
  slide_end: number | null;
  slide_seconds: number | null;
}

export interface BuilderPlaylist {
  name: string;
  type: "regular" | "slideshow" | "break";
  priority: number;
  slideshow_image_seconds: number | null;
  items: BuilderItem[];
}

export interface Refusal {
  key: string;
  values?: Record<string, number>;
}

export interface RunRow {
  index: number;
  start: number;
  seconds: number;
  slides: number | null;
  skipped: "unrendered" | "error" | "slideshow" | null;
}

export const PUSH_MAX_MS: number;
export const BREAK_DWELL_SECONDS: number;
export function breakDwell(seconds: number | null): number;
export function newItem(assetId: string, asset: BuilderAsset): BuilderItem;
export function checkItem(
  item: BuilderItem,
  asset: BuilderAsset | undefined,
  type: BuilderPlaylist["type"],
): Refusal | null;
export function checkPlaylist(
  playlist: BuilderPlaylist,
  assets: Record<string, BuilderAsset>,
): ({
  field: "name" | "priority" | "slideshow_image_seconds" | "items";
  index?: number;
} & Refusal)[];
export function moveItem(items: BuilderItem[], from: number, to: number): BuilderItem[];
export function removeItem(items: BuilderItem[], index: number): BuilderItem[];
export function runOrder(
  playlist: BuilderPlaylist,
  assets: Record<string, BuilderAsset>,
): { rows: RunRow[]; total: number };
export function clock(seconds: number): string;
export function nextAt(timeZone: string, nowMs: number, hhmm: string): number;
export function pushUntil(
  choice: string,
  nowMs: number,
  timeZone: string,
  at: string,
): { ms: number } | { error: string };
