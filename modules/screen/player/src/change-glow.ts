/**
 * The soft glow on a box whose content just changed (#787 D11; contracts/theming.md, Motion
 * vocabulary): it holds as long as a cue's frame holds and then fades over 10 s, at every level.
 * How it looks at each level is change-glow.css's: a breathing glow at lively and party, a still
 * one at calm, a still outline at none. Kept per box and drawn every tick, as a redraw in place
 * resets a box's classes.
 */

/** As a cue's frame holds (the floor's default, within its 60–120 s), so a change reads as one. */
export const CHANGE_HOLD_MS = 90_000;
export const CHANGE_FADE_MS = 10_000;

export class ChangeGlow {
  private since = new Map<Element, number>();

  mark(box: Element, now: number): void {
    this.since.set(box, now);
  }

  /** Each glowing box's strength now (`--canccu-changed`, 1 to 0); a box gone or faded loses it. */
  apply(now: number): void {
    for (const [box, at] of this.since) {
      const el = box as HTMLElement;
      const age = now - at;
      if (!box.isConnected || age >= CHANGE_HOLD_MS + CHANGE_FADE_MS) {
        el.classList.remove("canccu-changed");
        el.style.removeProperty("--canccu-changed");
        this.since.delete(box);
        continue;
      }
      const strength = age < CHANGE_HOLD_MS ? 1 : 1 - (age - CHANGE_HOLD_MS) / CHANGE_FADE_MS;
      el.classList.add("canccu-changed");
      el.style.setProperty("--canccu-changed", String(Math.round(strength * 1000) / 1000));
    }
  }
}
