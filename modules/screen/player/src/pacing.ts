/**
 * The choreographer (contracts/screen.md, The Director; design guideline sheet 13): the Director
 * decides what, this decides when. A box changing what it shows is a notable change; at most one
 * starts every few seconds, so the screen is always moving somewhere and never everywhere. Ticks
 * fall on whole seconds of the server's clock, but each screen holds its own changes: one turn may
 * come up to about 3 s apart on two screens of a zone, and a box held past its widget's dwell
 * skips that widget. One spotlight at a time is the motion layer's rule (motion.ts).
 */
import type { Shown } from "./idle.js";

/** Changes that would collide are pushed apart by at least this much (sheet 13's lanes). */
export const CHANGE_GAP_MS = 3000;

export class Choreographer {
  private last = Number.NEGATIVE_INFINITY;
  /** Each region that wants a change, and since when. */
  private waiting = new Map<string, number>();

  /**
   * The one region of `wanting` (in the screen's order) that may change at `now`, or null: the
   * one that has waited longest, once the last change is far enough behind.
   */
  release(wanting: readonly string[], now: number): string | null {
    for (const id of this.waiting.keys()) if (!wanting.includes(id)) this.waiting.delete(id);
    for (const id of wanting) if (!this.waiting.has(id)) this.waiting.set(id, now);
    // A backwards step of the server clock (the offset corrected, an NTP step) counts as elapsed:
    // a negative gap would otherwise hold every change until the clock caught up.
    const gap = now - this.last;
    if (gap >= 0 && gap < CHANGE_GAP_MS) return null;
    let first: string | null = null;
    for (const id of wanting) {
      const since = this.waiting.get(id) ?? now;
      if (first === null || since < (this.waiting.get(first) ?? now)) first = id;
    }
    if (first === null) return null;
    this.waiting.delete(first);
    this.last = now;
    return first;
  }
}

/** What a key names before its content: the rotation's index, `idle` or `claim` (`choose`). */
const turnOf = (key: string): string => key.slice(0, key.indexOf(":"));

/**
 * A notable change for the choreographer: a box turning to another of its widgets.
 * New content in the same widget (a ticker's line, the next slide) is the widget's own. A claim
 * is the crew's or a cue's and shows at once; a first draw and a box emptying never wait.
 */
export function paced(from: Shown | null, to: Shown | "collapse" | null | undefined): boolean {
  if (from === null || typeof to !== "object" || to === null) return false;
  const [a, b] = [turnOf(from.key), turnOf(to.key)];
  return a !== b && a !== "claim" && b !== "claim";
}
