/**
 * An AudioContext made without a gesture turns `running` a task later, even with the autoplay
 * flag: read at once, it would say "blocked until a tap" on a kiosk that may play.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeContext extends EventTarget {
  state: AudioContextState = "suspended";
  constructor() {
    super();
    if (FakeContext.autoplay) {
      setTimeout(() => {
        this.state = "running";
        this.dispatchEvent(new Event("statechange"));
      }, 1);
    }
  }
  static autoplay = true;
}

describe("whether the page may play sound", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.stubGlobal("AudioContext", FakeContext);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits for a fresh context to settle before it answers", async () => {
    FakeContext.autoplay = true;
    const { audioSettled } = await import("../src/audio.js");
    const answer = audioSettled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toBe(true);
  });

  it("answers blocked once the wait ends without a change", async () => {
    FakeContext.autoplay = false;
    const { AUDIO_SETTLE_MS, audioSettled } = await import("../src/audio.js");
    const answer = audioSettled();
    await vi.advanceTimersByTimeAsync(AUDIO_SETTLE_MS);
    expect(await answer).toBe(false);
  });
});
