/**
 * Whether this page may play sound (contracts/screen.md, Heartbeat: `audio_unlocked`). Browsers
 * hold sound back until a gesture on the page, unless the kiosk runs with the autoplay flag
 * (docs/screen-kiosk.md); an AudioContext made without a gesture starts `running` only then.
 * One context per page: a kiosk page lives for days, and browsers cap how many may exist.
 */
let context: AudioContext | null | undefined;

function audioContext(): AudioContext | null {
  if (context === undefined) {
    try {
      context = typeof AudioContext === "function" ? new AudioContext() : null;
    } catch {
      context = null;
    }
  }
  return context;
}

export function audioUnlocked(): boolean {
  return audioContext()?.state === "running";
}

/** Try to unlock now: only works inside a tap or key press, or with the autoplay flag. */
export async function unlockAudio(): Promise<boolean> {
  const ctx = audioContext();
  if (ctx === null) return false;
  await ctx.resume().catch(() => undefined);
  return ctx.state === "running";
}

/** The first tap or key press on the page unlocks sound for the rest of its life. */
export function unlockOnGesture(target: EventTarget): void {
  const once = (): void => {
    void unlockAudio().then((ok) => {
      if (!ok) return;
      target.removeEventListener("pointerdown", once);
      target.removeEventListener("keydown", once);
    });
  };
  target.addEventListener("pointerdown", once);
  target.addEventListener("keydown", once);
}

/** A short, quiet tone, so the crew hears the check page's test through the venue's sound. */
export function beep(): void {
  const ctx = audioContext();
  if (ctx === null || ctx.state !== "running") return;
  const tone = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.1;
  tone.frequency.value = 660;
  tone.connect(gain).connect(ctx.destination);
  tone.start();
  tone.stop(ctx.currentTime + 0.25);
}
