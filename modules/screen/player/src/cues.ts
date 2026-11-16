/**
 * A cue's picture on the box a claim holds (contracts/screen.md, Cue effects; design sheet 14):
 * Moments picks the effect, this draws it. The move and the hold run as CSS animations
 * (cues.css) with a negative delay of the time since the claim started, so every screen of the
 * zone, and one that reloads half way, shows the same moment; the energy level only changes how
 * visible it is (calm: the frame only), never how long.
 */

const EFFECTS = new Set(["pop", "tilt", "flip", "ripple", "slide", "glow", "ring_burst"]);
const VARS = ["--canccu-cue-delay", "--canccu-cue-hold", "--canccu-cue-fade"];

interface CueClaim {
  starts_at: string;
  effect?: unknown;
}

function effectOf(c: CueClaim | null): { name: string; hold: number; fade: number } | null {
  const e = c?.effect as
    { name?: unknown; hold_seconds?: unknown; fade_seconds?: unknown } | undefined;
  if (typeof e?.name !== "string" || !EFFECTS.has(e.name)) return null;
  const hold = typeof e.hold_seconds === "number" ? e.hold_seconds : 0;
  const fade = typeof e.fade_seconds === "number" ? e.fade_seconds : 0;
  return { name: e.name, hold, fade };
}

/** Puts the claim's effect on `el` as it stands at `nowMs`, or takes any effect off it. */
export function applyCue(el: HTMLElement, claim: CueClaim | null, nowMs: number): void {
  const e = effectOf(claim);
  const since = claim === null ? 0 : (nowMs - Date.parse(claim.starts_at)) / 1000;
  const on = e !== null && since < e.hold + e.fade;
  const key = on ? `${claim?.starts_at ?? ""}|${e.name}` : "";
  // A running animation whose delay changed would jump: the same cue is left as it is.
  if ((el.dataset.canccuCue ?? "") === key) return;
  for (const c of [...el.classList]) if (c.startsWith("canccu-cue")) el.classList.remove(c);
  if (!on) {
    for (const v of VARS) el.style.removeProperty(v);
    delete el.dataset.canccuCue;
    return;
  }
  el.dataset.canccuCue = key;
  el.classList.add("canccu-cue", `canccu-cue--${e.name}`);
  el.style.setProperty("--canccu-cue-delay", `${String(-Math.max(0, Math.round(since)))}s`);
  el.style.setProperty("--canccu-cue-hold", `${String(e.hold)}s`);
  el.style.setProperty("--canccu-cue-fade", `${String(e.fade)}s`);
}
