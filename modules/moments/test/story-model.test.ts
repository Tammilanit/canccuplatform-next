/**
 * Storyboards, pure (contracts/moments.md, Storyboards; the storyboards plan, Timing, Repeats and
 * loops, Ends): the readable floor and card time, the busy venue factor
 * dropping the repeat and stopping at the limit, the long hold, the on-the-dot lead, round times
 * from offsets and `every`, `clock every` in its window, skips, which rounds sound, and the
 * placeholder rules (D10, SD3).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkStory } from "../src/story/check.js";
import {
  DOMAIN_TYPES,
  EMPTY_CONDITIONS,
  KNOWN_PLACEHOLDERS,
  TRANSITIONS,
} from "../src/story/model.js";
import { SAMPLE } from "../src/story/fill.js";
import type { Story, StoryStep } from "../src/story/model.js";
import { PRESETS, presetOf } from "../src/story/presets.js";
import {
  CAP_MS,
  atLocal,
  clockTimes,
  dueRound,
  patienceMs,
  plannedEnd,
  roundAt,
  roundSounds,
} from "../src/story/schedule.js";
import { DEFAULT_TIMING, compileFinale, compileRound, floorSeconds } from "../src/story/timing.js";

const T = Date.parse("2026-03-14T21:00:00Z");
const MIN = 60_000;

const step = (o: Partial<StoryStep> = {}): StoryStep => ({
  template: "title_card",
  content: { title: "Hello", subtitle: "", image_url: null },
  duration_seconds: 20,
  transition: "fade",
  cue: null,
  on_the_dot: false,
  message: false,
  ...o,
});

const story = (o: Partial<Story> = {}): Story => ({
  key: "test",
  name: "Test",
  preset: null,
  enabled: true,
  triggers: [{ kind: "item", kinds: ["tournament"], item_id: null, anchor: "start" }],
  conditions: { ...EMPTY_CONDITIONS },
  run_mode: "per_source",
  full_screen: false,
  round: { steps: [step({ message: true })], repeat: null, hold_seconds: null },
  rounds: { mode: "offsets", offsets_minutes: [-15, -5, -1] },
  end: {
    rounds: null,
    for_minutes: null,
    until_clock: null,
    until_event: { kind: "item_starts" },
    crew: true,
  },
  finale: null,
  sound: "first",
  ...o,
});

const preset = (key: string): Story => presetOf(key) as Story;

describe("timing (SL1, SL2)", () => {
  it("holds a text step at its readable floor and the message at the card time", () => {
    const words =
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one";
    expect(floorSeconds(step({ content: { title: words } }))).toBe(10);
    expect(floorSeconds(step({ content: { title: "Hi" } }))).toBe(8);
    expect(floorSeconds(step({ template: "sting" }))).toBe(0);
    const c = compileRound(
      {
        steps: [step({ duration_seconds: 4 }), step({ duration_seconds: 10, message: true })],
        repeat: null,
        hold_seconds: null,
      },
      DEFAULT_TIMING,
    );
    expect(c.steps.map((s) => s.duration_ms)).toEqual([8000, 15_000]);
  });

  it("keeps the floor on a finale too (fix 9)", () => {
    expect(compileFinale([step({ duration_seconds: 3 })], DEFAULT_TIMING).length_ms).toBe(8000);
  });

  it("unrolls the repeat, stretches text and never stings", () => {
    const c = compileRound(preset("starting_soon").round, { factor: 1.5, min_card_seconds: 15 });
    expect(c.steps.map((s) => [s.template, s.pass, s.duration_ms])).toEqual([
      ["sting", 0, 3000],
      ["countdown", 0, 30_000],
      ["sting", 1, 3000],
      ["countdown", 1, 30_000],
    ]);
    expect(c.repeat_dropped).toBe(false);
  });

  it("drops the repeat past the limit, then stops the stretch there, never under ×1", () => {
    const round = {
      steps: [
        step({ template: "sting", duration_seconds: 5 }),
        step({ duration_seconds: 40, message: true }),
      ],
      repeat: { from: 0, to: 1, times: 2 },
      hold_seconds: null,
    };
    const x2 = compileRound(round, { factor: 2, min_card_seconds: 15 });
    expect(x2.repeat_dropped).toBe(true);
    expect(x2.steps.map((s) => s.duration_ms)).toEqual([5000, 60_000]);
    const steps = [
      step({ template: "sting", duration_seconds: 5 }),
      step({ duration_seconds: 40, message: true }),
      step({ duration_seconds: 30 }),
      step({ duration_seconds: 20 }),
    ];
    const long = compileRound(
      { steps, repeat: null, hold_seconds: null },
      { factor: 2, min_card_seconds: 15 },
    );
    expect(long.capped).toBe(true);
    expect(Math.abs(long.length_ms - 120_000)).toBeLessThanOrEqual(2);
    const x1 = compileRound({ steps, repeat: null, hold_seconds: null }, DEFAULT_TIMING);
    long.steps.forEach((s, i) => {
      expect(s.duration_ms).toBeGreaterThanOrEqual(x1.steps[i]?.duration_ms ?? 0);
    });
    expect(long.steps[0]?.duration_ms).toBe(5000);
  });

  it("holds the last step of a long hold story up to its hold (SL2)", () => {
    const c = compileRound(
      { steps: [step({ message: true })], repeat: null, hold_seconds: 150 },
      DEFAULT_TIMING,
    );
    expect(c.length_ms).toBe(150_000);
    expect(
      checkStory(
        story({
          round: { steps: [step({ message: true })], repeat: null, hold_seconds: 150 },
          rounds: { mode: "offsets", offsets_minutes: [-5] },
        }),
        DEFAULT_TIMING,
      ),
    ).toBeNull();
    expect(
      checkStory(
        story({ round: { steps: [step()], repeat: null, hold_seconds: 200 } }),
        DEFAULT_TIMING,
      ),
    ).toMatch(/180 s/);
  });

  it("starts Midnight's round early so its sting lands on 00:00:00 (fix 1)", () => {
    const m = preset("midnight");
    const c = compileRound(m.round, DEFAULT_TIMING);
    expect(c.lead_ms).toBe(10_000);
    const midnight = atLocal("2026-03-15", "00:00", "Europe/Helsinki");
    const start = roundAt(m, midnight, 0, c.lead_ms) as number;
    expect(new Date(start).toISOString()).toBe("2026-03-14T21:59:50.000Z");
    expect(start + (c.steps[0]?.duration_ms ?? 0)).toBe(midnight);
  });
});

describe("rounds and ends", () => {
  it("plays offsets relative to T, and every n minutes from T", () => {
    const s = story();
    expect([0, 1, 2, 3].map((n) => roundAt(s, T, n, 0))).toEqual([
      T - 15 * MIN,
      T - 5 * MIN,
      T - MIN,
      null,
    ]);
    const every = story({
      rounds: { mode: "every", every_minutes: 10, from_minutes: 0 },
      end: { ...s.end, rounds: 3, until_event: null },
    });
    expect([0, 1, 2, 3].map((n) => roundAt(every, T, n, 0))).toEqual([
      T,
      T + 10 * MIN,
      T + 20 * MIN,
      null,
    ]);
  });

  it("plays the round due now and skips the ones it missed; a round past its patience is skipped", () => {
    const s = story();
    expect(patienceMs(s)).toBe(60_000);
    expect(dueRound(s, T, 0, T - 16 * MIN, 0)).toEqual({ play: null, missed: [] });
    expect(dueRound(s, T, 0, T - 15 * MIN, 0)).toEqual({ play: 0, missed: [] });
    // A restart (SE4) or a late take at T−4: T−15 is missed, T−5's patience ran out, T−1 waits.
    expect(dueRound(s, T, 0, T - 4 * MIN + 1000, 0)).toEqual({ play: null, missed: [0, 1] });
    expect(dueRound(s, T, 0, T - 5 * MIN + 30_000, 0)).toEqual({ play: 1, missed: [0] });
    expect(patienceMs(story({ rounds: { mode: "offsets", offsets_minutes: [0] } }))).toBe(120_000);
  });

  it("sounds the first, every, last or first and last round (fix 6)", () => {
    const pick = (sound: Story["sound"]) => [0, 1, 2].map((n) => roundSounds(story({ sound }), n));
    expect(pick("first")).toEqual([true, false, false]);
    expect(pick("every")).toEqual([true, true, true]);
    expect(pick("last")).toEqual([false, false, true]);
    expect(pick("first_and_last")).toEqual([true, false, true]);
    const open = story({
      rounds: { mode: "every", every_minutes: 5, from_minutes: 0 },
      sound: "last",
    });
    expect(checkStory(open, DEFAULT_TIMING)).toMatch(/last round is known/);
  });

  it("fires `clock every` aligned to its window, and ends by a time or a clock time", () => {
    const t = {
      kind: "clock" as const,
      mode: "every" as const,
      at: null,
      every_minutes: 60,
      from: "10:00",
      until: "22:00",
    };
    const ev = { starts_at: null, ends_at: null, timeZone: "UTC" };
    const at = (iso: string) =>
      clockTimes(t, ev, Date.parse(iso), 0).map((x) => new Date(x).toISOString());
    expect(at("2026-03-14T12:30:00Z")).toEqual([
      "2026-03-14T11:00:00.000Z",
      "2026-03-14T12:00:00.000Z",
    ]);
    expect(at("2026-03-14T23:30:00Z").at(-1)).toBe("2026-03-14T22:00:00.000Z");
    expect(at("2026-03-14T09:30:00Z").at(-1)).toBe("2026-03-13T22:00:00.000Z");
    const s = story({
      end: { rounds: null, for_minutes: 30, until_clock: "21:10", until_event: null, crew: false },
    });
    expect(plannedEnd(s, T, T - 15 * MIN, "UTC")).toBe(T + 10 * MIN);
    expect(CAP_MS).toBe(6 * 3_600_000);
  });

  it("needs an end for every loop and a gap at least the round's length", () => {
    const open = story({
      rounds: { mode: "every", every_minutes: 5, from_minutes: 0 },
      end: { rounds: null, for_minutes: null, until_clock: null, until_event: null, crew: false },
    });
    expect(checkStory(open, DEFAULT_TIMING)).toMatch(/Every loop ends/);
    const tight = story({
      rounds: { mode: "every", every_minutes: 2, from_minutes: 0 },
      round: {
        steps: [step({ duration_seconds: 60 }), step({ duration_seconds: 61 })],
        repeat: null,
        hold_seconds: null,
      },
    });
    expect(checkStory(tight, DEFAULT_TIMING)).toMatch(/1 to 60 s/);
  });
});

describe("placeholders (D10, SD3)", () => {
  it("fails an unknown one and one not every trigger fills, unless it has a fallback", () => {
    const say = (title: string, triggers: Story["triggers"] = story().triggers) =>
      checkStory(
        story({
          triggers,
          round: { steps: [step({ content: { title } })], repeat: null, hold_seconds: null },
        }),
        DEFAULT_TIMING,
      );
    expect(say("{item.nope}")).toBe("Unknown placeholder {item.nope}.");
    expect(say("Hi {")).toMatch(/brace/);
    expect(say("{item.title} at {item.location}")).toBeNull();
    const clock = {
      kind: "clock" as const,
      mode: "daily" as const,
      at: "12:00",
      every_minutes: null,
      from: null,
      until: null,
    };
    expect(say("{item.title}", [...story().triggers, clock])).toMatch(
      /Not every trigger fills \{item.title\}/,
    );
    expect(say("{item.title|the show}", [...story().triggers, clock])).toBeNull();
    // A take of a story with an item trigger asks for the item, so it fills the item's fields.
    expect(say("{item.title}", [...story().triggers, { kind: "take" }])).toBeNull();
    const take = story({
      triggers: [{ kind: "take" }],
      rounds: { mode: "offsets", offsets_minutes: [0] },
      end: { rounds: 1, for_minutes: null, until_clock: null, until_event: null, crew: false },
      round: { steps: [step({ content: { title: "{prize}" } })], repeat: null, hold_seconds: null },
    });
    expect(checkStory(take, DEFAULT_TIMING)).toBeNull();
    expect(say("{prize}")).toMatch(/asked only at a take/);
  });
});

describe("contracts/moments/storyboard.schema.json", () => {
  const schema = JSON.parse(
    readFileSync(
      new URL("../../../contracts/moments/storyboard.schema.json", import.meta.url),
      "utf8",
    ),
  ) as {
    required: string[];
    $defs: {
      Trigger: { oneOf: { properties: { kind: { const: string }; type?: { enum: string[] } } }[] };
      Step: { required: string[]; properties: { transition: { enum: string[] } } };
    };
  };

  it("names the fields every preset has, the domain types and the transitions the code knows", () => {
    for (const p of PRESETS) {
      expect(Object.keys(p).sort(), p.key).toEqual([...schema.required].sort());
      for (const step of [...p.round.steps, ...(p.finale ?? [])])
        expect(Object.keys(step).sort()).toEqual([...schema.$defs.Step.required].sort());
    }
    const domain = schema.$defs.Trigger.oneOf.find((t) => t.properties.kind.const === "domain");
    expect(domain?.properties.type?.enum).toEqual(Object.keys(DOMAIN_TYPES));
    expect(schema.$defs.Step.properties.transition.enum).toEqual([...TRANSITIONS]);
  });

  // #668 (R21): a test-fire fills what its trigger lacks with sample text; a new placeholder
  // without one would show empty on a test again. A run always fills the event's name and the clock.
  it("has sample text for every placeholder a run may lack", () => {
    const always = ["event.name", "now.time", "now.day"];
    const missing = [...KNOWN_PLACEHOLDERS].filter((p) => !always.includes(p) && !SAMPLE[p]);
    expect(missing).toEqual([]);
    expect(Object.keys(SAMPLE).filter((p) => !KNOWN_PLACEHOLDERS.has(p))).toEqual([]);
  });
});
