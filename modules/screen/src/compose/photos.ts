/**
 * The `photo` widget's wall (contracts/screen.md, Photos; design guideline v8, change 6): five
 * tiles from the lead on, a new lead every `photo_seconds`, and a new photo popping in large for
 * its pop slot. A pure function of the photos, the widget's props and the time, so every container
 * and every screen of a zone agree and no read has to write down that a photo has popped.
 */
import type { Props } from "./layouts.js";
import { shuffled } from "./seeded.js";

/** A new photo's pop slot, the same for the whole event. */
export const POP_SECONDS = 10;
const TILES = 5;
const ORDERS = ["newest", "oldest", "shuffle"] as const;
export type PhotoOrder = (typeof ORDERS)[number];

export interface WallSettings {
  seconds: number;
  order: PhotoOrder;
  popNew: boolean;
}

export const WALL_DEFAULTS: WallSettings = { seconds: 8, order: "newest", popNew: true };

/** The widget's props; one out of range or unknown falls back to its default, never breaks the wall. */
export function wallSettings(props: Props): WallSettings {
  const s = props.photo_seconds;
  const order = ORDERS.find((o) => o === props.order);
  return {
    seconds: typeof s === "number" && Number.isInteger(s) && s >= 5 && s <= 60 ? s : 8,
    order: order ?? WALL_DEFAULTS.order,
    popNew: typeof props.pop_new === "boolean" ? props.pop_new : WALL_DEFAULTS.popNew,
  };
}

/** One key per distinct wall, so entries with equal settings share one view-model. */
export const wallKey = (s: WallSettings): string =>
  `${String(s.seconds)}:${s.order}:${s.popNew ? "pop" : "still"}`;

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

/**
 * When each photo's pop slot ends: one slot from its arrival, or from the end of the one before,
 * in the order they came. The photo list's `featured` and every `pop_new` zone read the same slots.
 */
export function popUntil(photos: readonly Arrival[]): Map<string, number> {
  const until = new Map<string, number>();
  let end = -Infinity;
  for (const p of [...photos].sort(byArrival)) {
    end = Math.max(p.created_at, end) + POP_SECONDS * 1000;
    until.set(p.id, end);
  }
  return until;
}

const tileOf = (p: PhotoRow): Record<string, unknown> => ({
  url: p.url,
  caption: p.caption,
  author_name: p.author_name,
  posted_at: p.posted_at,
});

/** The wall's order this round; a shuffle draws a new one each round, alike on every screen. */
function orderOf(photos: readonly PhotoRow[], s: WallSettings, seed: string, slot: number) {
  const oldest = [...photos].sort(byArrival);
  if (s.order === "oldest") return oldest;
  if (s.order === "newest") return oldest.reverse();
  const round = Math.floor(slot / oldest.length);
  return shuffled(oldest, `${seed}:photo:${String(round)}`);
}

/**
 * The wall at `nowMs` and when it next changes; null without photos. `seed` is the zone's key, so
 * a shuffled wall is the same on all of the zone's screens.
 */
export function photoWall(
  photos: readonly PhotoRow[],
  s: WallSettings,
  seed: string,
  nowMs: number,
): { view: Record<string, unknown>; changesAt: number | null } | null {
  if (photos.length === 0) return null;
  const slotMs = s.seconds * 1000;
  const slot = Math.floor(nowMs / slotMs);
  const order = orderOf(photos, s, seed, slot);
  const changes: number[] = order.length > 1 ? [(slot + 1) * slotMs] : [];
  let lead = slot % order.length;
  let featured = false;
  if (s.popNew) {
    const popMs = POP_SECONDS * 1000;
    for (const [id, end] of popUntil(photos)) {
      if (nowMs >= end - popMs && nowMs < end) {
        lead = order.findIndex((p) => p.id === id);
        featured = true;
      }
      if (end > nowMs) changes.push(nowMs < end - popMs ? end - popMs : end);
    }
  }
  const tiles = Array.from(
    { length: Math.min(TILES, order.length) },
    (_, i) => order[(lead + i) % order.length] as PhotoRow,
  );
  const first = tiles[0] as PhotoRow;
  return {
    view: { ...tileOf(first), featured, tiles: tiles.map(tileOf) },
    changesAt: changes.length === 0 ? null : Math.min(...changes),
  };
}
