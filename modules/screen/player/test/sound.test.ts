/**
 * The zone's sound on its sound screen (contracts/screen.md, Sound; step 4 plan D14): it starts at
 * `play_at` on the server's clock, so the screens of a zone start together; late within its
 * catch-up window, never twice, and an urgent one stops what plays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundPlayer, startIn } from "../src/sound.js";
import type { SoundPlay } from "../src/sound.js";

const T = Date.parse("2026-01-01T20:00:00Z");
const play = (id: string, o: Partial<SoundPlay> = {}): SoundPlay => ({
  id,
  url: "/api/moments/sounds/pack/ding.ogg",
  voice_url: null,
  volume: 0.5,
  play_at: new Date(T + 400).toISOString(),
  catch_up_until: new Date(T + 120_400).toISOString(),
  interrupts: false,
  ...o,
});

class FakeAudio extends EventTarget {
  static made: FakeAudio[] = [];
  static refuse = false;
  static hold: (() => void)[] | null = null;
  volume = 1;
  paused = true;
  constructor(readonly src: string) {
    super();
    FakeAudio.made.push(this);
  }
  play(): Promise<void> {
    if (FakeAudio.refuse) return Promise.reject(new Error("NotAllowedError"));
    this.paused = false;
    const hold = FakeAudio.hold;
    if (hold) return new Promise((resolve) => hold.push(resolve));
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  end(): void {
    this.paused = true;
    this.dispatchEvent(new Event("ended"));
  }
}

describe("when a sound starts", () => {
  it("at play_at on the server's clock, so every screen of the zone starts together", () => {
    expect(startIn(play("a"), T, new Set())).toBe(400);
    // A device whose clock runs 150 ms ahead has a server time 150 ms on: it waits less.
    expect(startIn(play("a"), T + 150, new Set())).toBe(250);
  });

  it("late, at once, within its catch-up window; never after it, never twice", () => {
    expect(startIn(play("a"), T + 60_000, new Set())).toBe(0);
    expect(startIn(play("a"), T + 120_400, new Set())).toBeNull();
    expect(startIn(play("a"), T, new Set(["a"]))).toBeNull();
  });
});

describe("the sound screen", () => {
  let now = T;
  const make = () =>
    new SoundPlayer({
      serverNow: () => now,
      audio: (src) => new FakeAudio(src) as unknown as HTMLAudioElement,
    });
  beforeEach(() => {
    vi.useFakeTimers();
    now = T;
    FakeAudio.made = [];
    FakeAudio.refuse = false;
    FakeAudio.hold = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const wait = async (ms: number) => {
    now += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };

  it("plays the zone's sound once, at its volume, and reports it", async () => {
    const p = make();
    p.take({ enabled: true, sounded_claims: [], play: play("a") });
    await wait(399);
    expect(FakeAudio.made).toHaveLength(0);
    await wait(1);
    expect(FakeAudio.made.map((a) => [a.src, a.volume, a.paused])).toEqual([
      ["/api/moments/sounds/pack/ding.ogg", 0.5, false],
    ]);
    expect(p.played()).toEqual(["a"]);
    // The same state again (a patch, a reconnect) plays nothing more.
    p.take({ enabled: true, sounded_claims: [], play: play("a") });
    await wait(1000);
    expect(FakeAudio.made).toHaveLength(1);
  });

  it("never starts the same sound twice while its play() is still pending", async () => {
    FakeAudio.hold = [];
    const p = make();
    p.take({ enabled: true, sounded_claims: [], play: play("a") });
    await wait(400);
    expect(FakeAudio.made).toHaveLength(1);
    // A patch with the same play arrives before the browser has settled play().
    p.take({ enabled: true, sounded_claims: [], play: play("a") });
    await wait(1000);
    expect(FakeAudio.made).toHaveLength(1);
    for (const r of FakeAudio.hold) r();
    await wait(0);
    expect(p.played()).toEqual(["a"]);
    p.take({ enabled: true, sounded_claims: [], play: play("a") });
    await wait(1000);
    expect(FakeAudio.made).toHaveLength(1);
  });

  it("a sound that settles never frees the guard of the urgent one still starting", async () => {
    FakeAudio.hold = [];
    const p = make();
    p.take({ enabled: true, sounded_claims: [], play: play("a") });
    await wait(400);
    const urgent = play("b", { interrupts: true });
    p.take({ enabled: true, sounded_claims: [], play: urgent });
    await wait(400);
    expect(FakeAudio.made).toHaveLength(2);
    // A settles while B's play() is still pending.
    FakeAudio.hold[0]?.();
    await wait(0);
    p.take({ enabled: true, sounded_claims: [], play: urgent });
    await wait(1000);
    expect(FakeAudio.made).toHaveLength(2);
  });

  it("plays nothing where sound is not enabled: a mirror, another screen of the zone", async () => {
    const p = make();
    p.take({ enabled: false, sounded_claims: [], play: play("a") });
    await wait(1000);
    expect(FakeAudio.made).toHaveLength(0);
  });

  it("after a reload, skips what the server says it already played", async () => {
    const p = make();
    p.take({ enabled: true, sounded_claims: ["a"], play: play("a") });
    await wait(1000);
    expect(FakeAudio.made).toHaveLength(0);
  });

  it("plays the voice line right after the sound", async () => {
    const p = make();
    p.take({ enabled: true, sounded_claims: [], play: play("a", { voice_url: "/v.ogg" }) });
    await wait(400);
    FakeAudio.made[0]?.end();
    expect(FakeAudio.made.map((a) => a.src)).toEqual([
      "/api/moments/sounds/pack/ding.ogg",
      "/v.ogg",
    ]);
    expect(FakeAudio.made[1]?.volume).toBe(0.5);
  });

  it("an urgent sound stops the one that plays", async () => {
    const p = make();
    p.take({ enabled: true, sounded_claims: [], play: play("a") });
    await wait(400);
    p.take({
      enabled: true,
      sounded_claims: [],
      play: play("b", { play_at: new Date(now + 400).toISOString(), interrupts: true }),
    });
    await wait(400);
    expect(FakeAudio.made.map((a) => a.paused)).toEqual([true, false]);
  });

  it("an urgent sound also stops one whose play() has not settled yet", async () => {
    FakeAudio.hold = [];
    const p = make();
    p.take({ enabled: true, sounded_claims: [], play: play("a") });
    await wait(400);
    p.take({ enabled: true, sounded_claims: [], play: play("b", { interrupts: true }) });
    await wait(400);
    expect(FakeAudio.made.map((a) => [a.src, a.paused])).toEqual([
      ["/api/moments/sounds/pack/ding.ogg", true],
      ["/api/moments/sounds/pack/ding.ogg", false],
    ]);
  });

  it("a start the urgent one overtook stays stopped when it settles late", async () => {
    FakeAudio.hold = [];
    const p = make();
    p.take({ enabled: true, sounded_claims: [], play: play("a") });
    await wait(400);
    p.take({
      enabled: true,
      sounded_claims: [],
      play: play("b", { interrupts: true, voice_url: "/v.ogg" }),
    });
    await wait(400);
    const [a, b] = FakeAudio.made;
    // B settles first, A only after it: A must not take B's place as what plays.
    FakeAudio.hold[1]?.();
    await wait(0);
    FakeAudio.hold[0]?.();
    await wait(0);
    expect(a?.paused).toBe(true);
    // B's voice line still plays after B, since B is still what plays.
    b?.end();
    expect(FakeAudio.made.map((x) => x.src).at(-1)).toBe("/v.ogg");
    // A later urgent sound stops the voice line, not the long-stopped A.
    FakeAudio.hold = null;
    p.take({ enabled: true, sounded_claims: [], play: play("c", { interrupts: true }) });
    await wait(400);
    expect(FakeAudio.made[2]?.paused).toBe(true);
  });

  it("a sound the browser refuses (audio locked) is not reported as played", async () => {
    FakeAudio.refuse = true;
    const p = make();
    p.take({ enabled: true, sounded_claims: [], play: play("a") });
    await wait(400);
    expect(p.played()).toEqual([]);
  });
});
