/**
 * The zone's sound (contracts/screen.md, Sound; step 4 plan D14). Moments decides once per zone
 * and every screen of it gets the same `play` with a `play_at` on the server's clock; this device
 * starts it then, by its own clock corrected by the heartbeat's offset, so the zone's screens start
 * within the 200 ms the plan sets. Only a screen with `enabled` (the zone's sound screen) plays.
 * One that was offline or reloading starts it late while `catch_up_until` holds (E13); one it
 * played, or the server says it played (`sounded_claims`), it never plays again.
 */

export interface SoundPlay {
  id: string;
  url: string | null;
  voice_url: string | null;
  volume: number;
  play_at: string;
  catch_up_until: string;
  interrupts: boolean;
}

export interface SoundState {
  enabled: boolean;
  sounded_claims?: string[];
  play?: SoundPlay | null;
}

/** The heartbeat carries at most this many (contracts/screen.openapi.yaml, `claims_sounded`). */
const KEEP = 50;

/** Milliseconds from now until `p` starts on this device, or null when it should not play. */
export function startIn(
  p: SoundPlay,
  serverNow: number,
  played: ReadonlySet<string>,
): number | null {
  if (played.has(p.id) || serverNow >= Date.parse(p.catch_up_until)) return null;
  return Math.max(0, Date.parse(p.play_at) - serverNow);
}

export interface SoundHost {
  /** This device's clock corrected to the server's (the heartbeat's offset). */
  serverNow(): number;
  audio(src: string): HTMLAudioElement;
}

export class SoundPlayer {
  private readonly done: string[] = [];
  private pending: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  /** The id whose `play()` has not settled yet: a state arriving in that gap must not start it again. */
  private starting: string | null = null;
  private current: HTMLAudioElement | null = null;

  constructor(private readonly host: SoundHost) {}

  /** What this page played, newest last: the heartbeat's `claims_sounded`. */
  played(): string[] {
    return [...this.done];
  }

  /** A new state's `sound`: plays its `play` when this screen may and has not yet. */
  take(sound: SoundState | undefined): void {
    const p = sound?.play ?? null;
    if (sound?.enabled !== true || p === null || p.url === null) return;
    if (this.pending?.id === p.id || this.starting === p.id) return;
    const seen = new Set([...this.done, ...(sound.sounded_claims ?? [])]);
    const wait = startIn(p, this.host.serverNow(), seen);
    if (wait === null) return;
    // The server sends a new sound only once the last ended or when an urgent one interrupts it.
    if (this.pending !== null) clearTimeout(this.pending.timer);
    this.pending = { id: p.id, timer: setTimeout(() => void this.start(p), wait) };
  }

  private async start(p: SoundPlay): Promise<void> {
    this.pending = null;
    this.starting = p.id;
    if (p.interrupts) this.current?.pause();
    const audio = this.host.audio(p.url as string);
    audio.volume = p.volume;
    try {
      await audio.play();
    } catch {
      // Not unlocked, or the file failed: it stays unplayed, so a later state may catch it up.
      if (this.starting === p.id) this.starting = null;
      return;
    }
    // An urgent sound may have taken the slot while this play() was pending: only clear our own.
    if (this.starting === p.id) this.starting = null;
    this.current = audio;
    this.done.push(p.id);
    if (this.done.length > KEEP) this.done.splice(0, this.done.length - KEEP);
    if (p.voice_url !== null) {
      const voice = p.voice_url;
      audio.addEventListener(
        "ended",
        () => {
          if (this.current !== audio) return;
          const line = this.host.audio(voice);
          line.volume = p.volume;
          this.current = line;
          void line.play().catch(() => undefined);
        },
        { once: true },
      );
    }
  }
}
