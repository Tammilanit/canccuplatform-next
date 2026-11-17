/**
 * The preset catalogue, pure (the storyboards plan, The preset catalogue (final); #602): the 24
 * built-ins in order with their defaults, each valid, their cues in the seed with a sound of the
 * CC0 pack and a line in its credits, Premiere's placeholders filled for each of its triggers
 * (SD3), the two provisional events' facts and sources, and which rule a preset takes over (WD2).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_CUES, PACK } from "../src/cues/catalog.js";
import { checkStories, checkStory } from "../src/story/check.js";
import { domainFacts, domainSource, fillContent, itemFacts } from "../src/story/fill.js";
import type { Facts } from "../src/story/fill.js";
import { textsOf } from "../src/story/model.js";
import type { Story } from "../src/story/model.js";
import { PRESETS, PRESET_INFO, presetOf, rulesOff } from "../src/story/presets.js";
import { clockTimes } from "../src/story/schedule.js";
import { DEFAULT_TIMING } from "../src/story/timing.js";

const KEYS = [
  "doors_open",
  "starting_soon",
  "match_called",
  "champion",
  "midnight",
  "meal_served",
  "quiet_hours_soon",
  "good_morning",
  "checkin_open",
  "pizza_order_open",
  "closing_time",
  "arrival_checkin",
  "hot_game",
  "record_crowd",
  "sponsor_thanks",
  "prize_draw",
  "group_photo",
  "venue_info",
  "stage_break",
  "pizza_last_call",
  "pizza_arrived",
  "round_start",
  "premiere",
  "champion_replay",
];
/** The catalogue's "some venues; off" rows: 12–19 and 23. */
const SOME_VENUES = [12, 13, 14, 15, 16, 17, 18, 19, 23];

const preset = (key: string): Story => presetOf(key) as Story;
const cuesOf = (s: Story) =>
  [...s.round.steps, ...(s.finale ?? [])].map((x) => x.cue).filter((c) => c !== null);

describe("the preset catalogue", () => {
  it("is the 24 built-ins in the catalogue's order, each valid, together within the event's limit", () => {
    expect(PRESETS.map((p) => p.key)).toEqual(KEYS);
    for (const [i, p] of PRESETS.entries()) {
      expect(checkStory(p, DEFAULT_TIMING), p.key).toBeNull();
      expect(p.preset, p.key).toBe(p.key);
      expect(PRESET_INFO[p.key]?.number, p.key).toBe(i + 1);
    }
    expect(checkStories([...PRESETS], DEFAULT_TIMING)).toBeNull();
  });

  it("is on for every event and off for some venues, by default", () => {
    for (const p of PRESETS) {
      const venues = SOME_VENUES.includes(PRESET_INFO[p.key]?.number ?? 0);
      expect(PRESET_INFO[p.key]?.group, p.key).toBe(venues ? "venues" : "every");
      expect(p.enabled, p.key).toBe(!venues);
    }
  });

  it("gives each preset one message step, the one the CI screenshot shows", () => {
    for (const p of PRESETS) expect(p.round.steps.filter((s) => s.message).length, p.key).toBe(1);
  });

  it("plays the rounds, ends and sound the catalogue says", () => {
    expect(preset("meal_served")).toMatchObject({
      rounds: { mode: "every", every_minutes: 5, from_minutes: 0 },
      end: { rounds: 3, until_event: { kind: "item_ends" } },
      sound: "first",
    });
    const quiet = preset("quiet_hours_soon");
    expect(quiet.rounds).toEqual({ mode: "offsets", offsets_minutes: [-15, -5] });
    expect(quiet.end.until_event).toEqual({ kind: "item_starts" });
    // "Good night" is calm and silent: no cue, no flash.
    expect(quiet.finale).toMatchObject([{ cue: null, transition: "fade", duration_seconds: 10 }]);
    expect(preset("good_morning").triggers).toEqual([
      { kind: "item", kinds: ["quiet_hours"], item_id: null, anchor: "end" },
    ]);
    expect(preset("closing_time")).toMatchObject({
      triggers: [{ kind: "clock", mode: "event_end" }],
      rounds: { mode: "offsets", offsets_minutes: [-60, -30, -10] },
      sound: "first_and_last",
    });
    expect(preset("pizza_order_open")).toMatchObject({
      end: { rounds: 6, until_event: { kind: "domain", type: "pizza.order.closed" } },
      finale: [{ cue: "pizza.closed", duration_seconds: 8 }],
    });
    expect(preset("sponsor_thanks").triggers).toEqual([
      { kind: "clock", mode: "every", at: null, every_minutes: 60, from: "10:00", until: "22:00" },
    ]);
    expect(preset("venue_info").triggers).toEqual([
      { kind: "clock", mode: "every", at: null, every_minutes: 45, from: "09:00", until: "23:00" },
    ]);
    expect(preset("stage_break")).toMatchObject({
      conditions: { item_zone: true },
      end: { until_event: { kind: "next_item_starts" } },
    });
    expect(preset("pizza_last_call")).toMatchObject({
      rounds: { mode: "offsets", offsets_minutes: [0, 8] },
      end: { until_event: { kind: "domain", type: "pizza.order.closed" } },
    });
    // An arrived order is already closed: its end is the count alone.
    expect(preset("pizza_arrived").end).toMatchObject({ rounds: 3, until_event: null });
    expect(preset("round_start").conditions.once).toBe("source");
    expect(preset("hot_game").conditions.cooldown_minutes).toBe(30);
    expect(preset("record_crowd").conditions.once).toBe("day");
    const replay = preset("champion_replay");
    expect(replay.triggers).toEqual(preset("champion").triggers);
    expect(replay.rounds).toEqual({ mode: "offsets", offsets_minutes: [10, 30] });
    expect(cuesOf(replay)).toEqual([]);
  });

  it("names only seeded cues, each with a sound of the CC0 pack and a line in its credits", () => {
    const seeded = new Map(BUILTIN_CUES.map((c) => [c.name, c]));
    const pack = new Set(PACK.map((p) => p.id));
    const credits = readFileSync(new URL("../static/sounds/CREDITS.md", import.meta.url), "utf8");
    for (const p of PRESETS)
      for (const cue of cuesOf(p)) {
        const c = seeded.get(cue);
        expect(c, `${p.key}: ${cue}`).toBeDefined();
        expect(c?.sounds.length, cue).toBeGreaterThan(0);
        for (const s of c?.sounds ?? []) expect(pack.has(s), `${cue}: ${s}`).toBe(true);
      }
    for (const c of BUILTIN_CUES.filter((x) => x.name.startsWith("story.")))
      expect(credits, c.name).toContain(`\`${c.name}\``);
    for (const p of PACK) expect(credits, p.file).toContain(`\`${p.file}\``);
  });
});

describe("Premiere (23)", () => {
  const ITEM = {
    id: "it_premiere",
    title: "Demo Event: the film",
    kind: "premiere",
    starts_at: "2026-03-14T19:00:00Z",
    location: "Main hall",
  };
  const ctx = (facts: Facts) => ({
    facts,
    now: Date.parse("2026-03-14T18:59:30Z"),
    t: Date.parse("2026-03-14T19:00:00Z"),
    timeZone: "UTC",
    eventName: "Demo Event",
    eventStartsAt: "2026-03-14T12:00:00Z",
    eventEndsAt: "2026-03-15T12:00:00Z",
    hostname: "demo.example.test",
  });

  it("is a countdown, the video on the dot and an after-card; it passes validation off and without a video", () => {
    const p = preset("premiere");
    expect(p.round.steps.map((s) => [s.template, s.on_the_dot, s.message])).toEqual([
      ["countdown", false, true],
      ["video", true, false],
      ["title_card", false, false],
    ]);
    expect(p.triggers.map((t) => t.kind)).toEqual(["item", "take", "clock"]);
    expect(p.conditions.quiet).toBe("skip");
    expect(checkStory(p, DEFAULT_TIMING)).toBeNull();
  });

  it("fills its countdown and after-card for each trigger: the item, a take with or without it, a clock once", () => {
    const p = preset("premiere");
    const byTrigger: Record<string, Facts> = {
      item: itemFacts(ITEM, "UTC"),
      "take with the item": itemFacts(ITEM, "UTC"),
      "take without an item": {},
      "clock once": {},
    };
    for (const [how, facts] of Object.entries(byTrigger))
      for (const s of p.round.steps.filter((x) => x.template !== "video")) {
        const texts = textsOf(fillContent(s.template, s.content, ctx(facts)));
        for (const text of texts) expect(text, `${how}: ${s.template}`).not.toMatch(/[{}]/);
        expect(
          texts.some((x) => x.trim() !== ""),
          `${how}: ${s.template}`,
        ).toBe(true);
      }
    const card = (facts: Facts) =>
      String(fillContent("countdown", p.round.steps[0]?.content ?? {}, ctx(facts)).description);
    expect(card(byTrigger.item ?? {})).toContain("19:00");
    expect(card({})).not.toContain("19:00");
  });

  it("an item trigger without an item or kind, and a clock once without a time, never fire", () => {
    const p = preset("premiere");
    const clock = p.triggers.find((t) => t.kind === "clock");
    expect(clock).toMatchObject({ mode: "once", at: null });
    if (clock?.kind !== "clock") throw new Error("no clock trigger");
    const ev = { starts_at: null, ends_at: null, timeZone: "UTC" };
    expect(clockTimes(clock, ev, Date.parse("2026-03-14T19:00:00Z"), 3_600_000)).toEqual([]);
    const draw = preset("prize_draw");
    expect(draw.triggers[0]).toEqual({ kind: "item", kinds: [], item_id: null, anchor: "start" });
    expect(checkStory(draw, DEFAULT_TIMING)).toBeNull();
  });
});

describe("the provisional events (WD3)", () => {
  it("fills `pizza.order.closing` with the order's close and keys it on the order", () => {
    const d = { order: { id: "po_1", seq: 2 }, closes_at: "2026-03-14T18:50:00Z" };
    expect(domainFacts("pizza.order.closing", d, "UTC")).toEqual({
      "order.seq": "2",
      "order.closes_at": "18:50",
    });
    expect(domainSource("pizza.order.closing", d)).toBe("order:po_1");
  });

  it("fills `tournament.round.started` with its number and keys it on the session's round", () => {
    const d = {
      session: { id: "ts_1", name: "Demo Game Cup", game: { name: "Demo Game" } },
      round: { number: 2, match_ids: ["tm_3", "tm_4"] },
    };
    expect(domainFacts("tournament.round.started", d, "UTC")).toEqual({
      "session.name": "Demo Game Cup",
      "session.game": "Demo Game",
      "round.number": "2",
    });
    expect(domainSource("tournament.round.started", d)).toBe("round:ts_1:2");
  });
});

describe("a preset and a rule (SD6, WD2)", () => {
  it("turns off the rules of the presets on for the event, the pizza rule for an arrived order only", () => {
    const on = (keys: string[]) => PRESETS.map((p) => ({ ...p, enabled: keys.includes(p.key) }));
    expect(rulesOff(on(["match_called", "champion", "hot_game"]), "games.surge.started")).toEqual(
      new Set(["match_called", "finals_result", "hot_game"]),
    );
    expect(rulesOff(on(["pizza_arrived"]), "pizza.order.arrived")).toEqual(new Set(["pizza"]));
    expect(rulesOff(on(["pizza_arrived"]), "pizza.order.placed")).toEqual(new Set());
    // A duplicate is the event's own story: it takes over no rule.
    const copy = { ...preset("hot_game"), key: "hot_game_copy", preset: null };
    expect(rulesOff([copy], "games.surge.started")).toEqual(new Set());
  });
});
