/**
 * The Director's queue jumps on the screen (contracts/screen.md, The Director): the server's
 * src/compose/director.ts, which the player cannot import, repeated so a jump starts and ends on
 * every screen of a zone at once, also offline. test/compose-director.test.ts holds the two to
 * one answer. The order of the features comes from the server, in `order`.
 */

const SURGE_JUMP_MS = 60_000;
/** A new photo's pop slot (src/compose/photos.ts, POP_SECONDS). */
const POP_MS = 10_000;

const timeOf = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : NaN);

/** A jump's turn: which widget, and from when until when (the turn indicator fills over it). */
export interface Jump {
  index: number;
  from: number;
  until: number;
}

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
  widgets: readonly { widget?: string; view?: Record<string, unknown> }[],
  order: readonly number[],
  nowMs: number,
): Jump | null {
  let best: (Jump & { rank: number }) | null = null;
  for (const index of order) {
    const w = widgets[index];
    if (w?.widget === undefined || w.view === undefined) continue;
    const until = jumpOf(w.widget, w.view, nowMs);
    const surge = w.widget === "hot_game";
    const from = until === null ? 0 : until - (surge ? SURGE_JUMP_MS : POP_MS);
    if (until !== null && (best === null || Number(!surge) < best.rank))
      best = { index, from, until, rank: Number(!surge) };
  }
  return best === null ? null : { index: best.index, from: best.from, until: best.until };
}
