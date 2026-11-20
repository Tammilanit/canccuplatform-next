/**
 * What Fire says it did (#638; P16, V7): when the story plays, in the event's clock and at which
 * round of its item ("at T−15"), never just "Fired." while nothing changes; and the item times of
 * the Fire picker in the event's clock.
 */
import { describe, expect, it } from "vitest";
import { fireResult, itemTime, nextRound, untilEventAt } from "../src/story/fire-words.js";
import { presetOf } from "../src/story/presets.js";
import type { Story } from "../src/story/model.js";
import { DEFAULT_TIMING } from "../src/story/timing.js";
import { crewStories } from "../src/story/views.js";
import { ITEM, step, story } from "./story-kit.js";

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
        startedAt: at("2026-01-01T18:40:00Z"),
        untilAt: null,
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
        startedAt: at("2026-01-01T18:40:00Z"),
        untilAt: null,
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
        startedAt: at("2026-01-01T18:40:00Z"),
        untilAt: null,
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
        startedAt: at("2026-01-01T18:40:00Z"),
        untilAt: null,
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
        startedAt: at("2026-01-01T18:40:00Z"),
        untilAt: null,
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
      startedAt: at("2026-01-01T18:40:00Z"),
      untilAt: null,
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
        startedAt: at("2026-01-01T18:40:00Z"),
        untilAt: null,
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
        startedAt: at("2026-01-01T18:40:00Z"),
        untilAt: null,
        now: at("2026-01-01T19:30:00Z"),
        timeZone: "UTC",
      }),
    ).toBeNull();
  });
});

/** A loop every 10 minutes from T, fired at 18:40 on no item, that its end stops. */
const loop = (end: Partial<Story["end"]>, o: Partial<Story> = {}): Story =>
  story({
    name: "Loop",
    rounds: { mode: "every", every_minutes: 10, from_minutes: 0 },
    end: {
      rounds: null,
      for_minutes: null,
      until_clock: null,
      until_event: null,
      crew: true,
      ...end,
    },
    ...o,
  });
const FIRED = at("2026-01-01T18:40:00Z");
const words = (s: Story, now: number, untilAt: number | null = null) => ({
  story: s,
  t: FIRED,
  anchored: false,
  settings: DEFAULT_TIMING,
  startedAt: FIRED,
  untilAt,
  now,
  timeZone: "UTC",
});

describe("no next round after a loop's end", () => {
  it("stops at its until_clock: On air and Fire name no round at or after it", () => {
    const s = loop({ until_clock: "19:00" });
    expect(nextRound(words(s, at("2026-01-01T18:41:00Z")))).toBe("next round 18:50");
    expect(nextRound(words(s, at("2026-01-01T18:51:00Z")))).toBeNull();
    expect(fireResult(words(s, at("2026-01-01T18:59:00Z")))).toBe(
      "Loop has no round left to play.",
    );
  });

  it("stops at its until_event when the run of show says when it comes", () => {
    const s = loop({ until_event: { kind: "item_starts" } });
    const end = at("2026-01-01T19:00:00Z");
    expect(nextRound(words(s, at("2026-01-01T18:51:00Z")))).toBe("next round 19:00");
    expect(nextRound(words(s, at("2026-01-01T18:51:00Z"), end))).toBeNull();
    const finale = loop({ until_event: { kind: "item_ends" } }, { finale: [step()] });
    expect(fireResult(words(finale, at("2026-01-01T18:59:00Z"), end))).toBe(
      "Loop plays its finale now.",
    );
  });

  it("stops at its for_minutes too, counted from the fire", () => {
    const s = loop({ for_minutes: 15 });
    expect(nextRound(words(s, at("2026-01-01T18:41:00Z")))).toBe("next round 18:50");
    expect(nextRound(words(s, at("2026-01-01T18:51:00Z")))).toBeNull();
  });
});

describe("On air's line for a live loop between rounds", () => {
  const onItem = loop(
    { until_event: { kind: "item_starts" } },
    {
      key: "loop",
      triggers: [
        { kind: "item", kinds: ["tournament"], item_id: null, anchor: "start" },
        { kind: "take" },
      ],
      rounds: { mode: "every", every_minutes: 10, from_minutes: -30 },
    },
  );
  const card = (now: string) =>
    crewStories({
      stories: [onItem],
      runs: [
        {
          id: "run_1",
          story_key: "loop",
          name: "Loop",
          source: "item:it_final",
          t: ITEM.starts_at,
          status: "live",
          test: false,
          zones: [],
          round: null,
          has_finale: false,
          started_at: "2026-01-01T18:30:00Z",
        },
      ],
      items: [],
      agenda: [ITEM],
      now: at(now),
      canTake: true,
      back: "on-air",
      timeZone: "UTC",
      settings: DEFAULT_TIMING,
    }).toString();

  it("names the next round before the item starts, and none at its start, the loop's end", () => {
    expect(card("2026-01-01T18:41:00Z")).toContain("next round 18:50 (T−10)");
    const last = card("2026-01-01T18:51:00Z");
    expect(last).not.toContain("next round");
    expect(last).toContain("between rounds");
  });
});

describe("when a loop's until_event comes, from the run of show", () => {
  const meal = { ...ITEM, id: "it_meal", title: "Dinner", starts_at: "2026-01-01T21:00:00Z" };
  const crewOnly = {
    ...ITEM,
    id: "it_brief",
    visibility: "crew",
    starts_at: "2026-01-01T20:30:00Z",
  };
  const agenda = [ITEM, crewOnly, meal];
  const T0 = Date.parse(ITEM.starts_at);
  it("is its item's start or end", () => {
    expect(untilEventAt(loop({ until_event: { kind: "item_starts" } }), ITEM, agenda, T0)).toBe(T0);
    expect(untilEventAt(loop({ until_event: { kind: "item_ends" } }), ITEM, agenda, T0)).toBe(
      at("2026-01-01T20:00:00Z"),
    );
  });

  it("is the next public item's start after T, and unknown for a domain event or none", () => {
    expect(
      untilEventAt(loop({ until_event: { kind: "next_item_starts" } }), ITEM, agenda, T0),
    ).toBe(at("2026-01-01T21:00:00Z"));
    expect(
      untilEventAt(
        loop({ until_event: { kind: "domain", type: "pizza.order.closing" } }),
        ITEM,
        agenda,
        T0,
      ),
    ).toBeNull();
    expect(
      untilEventAt(loop({ until_event: { kind: "item_ends" } }), undefined, agenda, T0),
    ).toBeNull();
    expect(untilEventAt(loop({}), ITEM, agenda, T0)).toBeNull();
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
