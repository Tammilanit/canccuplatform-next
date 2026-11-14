/**
 * The choreographer (contracts/screen.md, The Director; design guideline sheet 13): the Director
 * decides what, this decides when. A box changing what it shows is a notable change; at most one
 * starts every few seconds, so the screen is always moving somewhere and never everywhere. Ticks
 * fall on whole seconds of the server's clock, so every screen of a zone paces alike. One
 * spotlight at a time is the motion layer's rule (motion.ts).
 */

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
