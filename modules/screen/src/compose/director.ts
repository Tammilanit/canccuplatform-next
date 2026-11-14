/**
 * The Director (contracts/screen.md, The Director; design guideline sheet 13): what the hero
 * plays next. Its rotation is `sequence`'s, epoch-anchored, over the features in the sheet's
 * order, so taking turns already plays the one shown longest ago first; a surge's first minute and
 * a new photo's pop jump the queue. Every input is in the composed state, so the player repeats
 * the rule (player/src/director.ts) and all screens of a zone agree, also offline.
 */

/** Sheet 13's order; a type not listed comes after these, in its place order. */
const FEATURES = [
  "bracket",
  "leaderboard",
  "countdown",
  "playlist",
  "photo",
  "hot_game",
  "today_numbers",
];

/** How long a surge holds the hero: the minute its stage tint washes in its art (The stage). */
export const SURGE_JUMP_MS = 60_000;

const rankOf = (widget: string): number => {
  const rank = FEATURES.indexOf(widget);
  return rank === -1 ? FEATURES.length : rank;
};

/** The widgets taking part (`sequence`, in place order) as the Director turns through them. */
export function directorOrder(
  widgets: readonly { widget: string }[],
  sequence: readonly number[],
): number[] {
  const rank = (i: number): number => rankOf(widgets[i]?.widget ?? "");
  return [...sequence].sort((a, b) => rank(a) - rank(b) || a - b);
}

export interface Jump {
  index: number;
  until: number;
}

const timeOf = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : NaN);

/** The jump `widget` holds at `nowMs`, if any: the surge's first minute, the photo's pop. */
function jumpOf(widget: string, view: Record<string, unknown>, nowMs: number): number | null {
  if (widget === "hot_game") {
    const until = timeOf(view.since) + SURGE_JUMP_MS;
    return until - SURGE_JUMP_MS <= nowMs && nowMs < until ? until : null;
  }
  if (widget === "photo" && view.featured === true) {
    const until = timeOf(view.featured_until);
    return nowMs < until ? until : null;
  }
  return null;
}

/** The feature that jumps the queue at `nowMs` among those in `order`, the surge first. */
export function jumpAt(
  widgets: readonly { widget: string; view: Record<string, unknown> }[],
  order: readonly number[],
  nowMs: number,
): Jump | null {
  let best: (Jump & { rank: number }) | null = null;
  for (const index of order) {
    const w = widgets[index];
    if (w === undefined) continue;
    const until = jumpOf(w.widget, w.view, nowMs);
    const rank = w.widget === "hot_game" ? 0 : 1;
    if (until !== null && (best === null || rank < best.rank)) best = { index, until, rank };
  }
  return best === null ? null : { index: best.index, until: best.until };
}
