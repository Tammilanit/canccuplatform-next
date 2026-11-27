/**
 * The level a screen draws changes only at a turn of the hero (#787 D13): a new level from the
 * hype waits for the hero's next turn, so the screen never changes its pace in the middle of an
 * item. Moments' band rule already keeps a change to once in 5 minutes. `none`, the venue's or
 * the device's reduced motion, applies at once, and so does leaving it.
 */
import type { Level } from "./motion.js";

/** The longest hero turn (60 s): a hero with no turn to wait for (a claim holds it) waits this long. */
export const LEVEL_WAIT_MS = 60_000;

export class LevelGate {
  private shown: Level | null = null;
  private waiting: { level: Level; turn: string | null; since: number } | null = null;

  /** The level to draw now; `turn` names the hero's turn as last drawn, null while it has none. */
  level(target: Level, turn: string | null, now: number): Level {
    if (
      this.shown === null ||
      this.shown === target ||
      target === "none" ||
      this.shown === "none"
    ) {
      this.shown = target;
      this.waiting = null;
      return target;
    }
    if (this.waiting?.level !== target) this.waiting = { level: target, turn, since: now };
    const w = this.waiting;
    if ((turn !== null && turn !== w.turn) || now - w.since >= LEVEL_WAIT_MS) {
      this.shown = target;
      this.waiting = null;
    }
    return this.shown;
  }
}
