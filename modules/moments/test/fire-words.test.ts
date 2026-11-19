/**
 * What Fire says it did (#638; P16, V7): when the story plays, in the event's clock and at which
 * round of its item ("at T−15"), never just "Fired." while nothing changes; and the item times of
 * the Fire picker in the event's clock.
 */
import { describe, expect, it } from "vitest";
import { fireResult, itemTime, nextRound } from "../src/story/fire-words.js";
import { presetOf } from "../src/story/presets.js";
import type { Story } from "../src/story/model.js";
import { DEFAULT_TIMING } from "../src/story/timing.js";

const startingSoon = presetOf("starting_soon") as Story;
const T = Date.parse("2026-01-01T19:00:00Z");
const at = (iso: string) => Date.parse(iso);

describe("the Fire result", () => {
  it("says when the first round plays and at which round of the item", () => {
    expect(
      fireResult({
        story: startingSoon,
        t: T,
        anchored: true,
        settings: DEFAULT_TIMING,
        now: at("2026-01-01T18:40:00Z"),
        timeZone: "UTC",
      }),
    ).toBe("Starting soon starts at 18:45, at T−15.");
  });

  it("writes the time in the event's clock, with the day when it is not today", () => {
    expect(
      fireResult({
        story: startingSoon,
        t: T,
        anchored: true,
        settings: DEFAULT_TIMING,
        now: at("2026-01-01T12:00:00Z"),
        timeZone: "Asia/Tokyo",
      }),
    ).toBe("Starting soon starts at Fri 03:45, at T−15.");
  });

  it("names the next round still to come when the first has passed", () => {
    expect(
      fireResult({
        story: startingSoon,
        t: T,
        anchored: true,
        settings: DEFAULT_TIMING,
        now: at("2026-01-01T18:50:00Z"),
        timeZone: "UTC",
      }),
    ).toBe("Starting soon starts at 18:55, at T−5.");
  });

  it("says it is on now when a round is due, and drops the T for a story fired on no item", () => {
    const now = at("2026-01-01T18:45:10Z");
    expect(
      fireResult({
        story: startingSoon,
        t: T,
        anchored: true,
        settings: DEFAULT_TIMING,
        now,
        timeZone: "UTC",
      }),
    ).toBe("Starting soon is on now.");
    const champion = presetOf("champion") as Story;
    expect(
      fireResult({
        story: champion,
        t: now,
        anchored: false,
        settings: DEFAULT_TIMING,
        now,
        timeZone: "UTC",
      }),
    ).toBe("Champion is on now.");
  });

  it("says the finale plays when no round is left, and never just Fired", () => {
    const text = fireResult({
      story: startingSoon,
      t: T,
      anchored: true,
      settings: DEFAULT_TIMING,
      now: at("2026-01-01T19:10:00Z"),
      timeZone: "UTC",
    });
    expect(text).toBe("Starting soon plays its finale now.");
    expect(text).not.toBe("Fired.");
  });

  it("gives a live loop between rounds its next round for On air", () => {
    expect(
      nextRound({
        story: startingSoon,
        t: T,
        anchored: true,
        settings: DEFAULT_TIMING,
        now: at("2026-01-01T18:46:00Z"),
        timeZone: "UTC",
      }),
    ).toBe("next round 18:55 (T−5)");
    expect(
      nextRound({
        story: startingSoon,
        t: T,
        anchored: true,
        settings: DEFAULT_TIMING,
        now: at("2026-01-01T19:30:00Z"),
        timeZone: "UTC",
      }),
    ).toBeNull();
  });
});

describe("an item's time in the Fire picker", () => {
  it("is the event's clock, with the day when it is not today", () => {
    const now = at("2026-01-01T12:00:00Z");
    expect(itemTime("2026-01-01T17:45:00Z", now, "UTC")).toBe("17:45");
    expect(itemTime("2026-01-01T17:45:00Z", now, "Australia/Eucla")).toBe("Fri 02:30");
    expect(itemTime("2026-01-01T13:00:00Z", now, "Europe/Helsinki")).toBe("15:00");
  });
});
