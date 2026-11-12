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

/** How long a fresh context may take to turn `running` on its own (the autoplay flag). */
export const AUDIO_SETTLE_MS = 500;

/**
 * `audioUnlocked`, once a fresh context had its chance: one made without a gesture turns
 * `running` only in a later task, even with the autoplay flag, so an answer read at once is
 * "blocked" on a kiosk that may play.
 */
export async function audioSettled(waitMs = AUDIO_SETTLE_MS): Promise<boolean> {
  const ctx = audioContext();
  if (ctx === null) return false;
  if (ctx.state !== "running") {
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        ctx.removeEventListener("statechange", done);
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      ctx.addEventListener("statechange", done);
    });
  }
  return ctx.state === "running";
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
