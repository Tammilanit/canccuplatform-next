/**
 * The preset picker, pure (mockup 21; #602): what triggers each preset in a few words, its rounds
 * and sound, its status ("next: …", "Waits for a matching item in the run of show", "pick an item",
 * the rule it replaces), turning one on or off (a preset not yet copied is copied; Champion
 * replay follows Champion) and duplicate to edit.
 */
import { describe, expect, it } from "vitest";
import type { Story } from "../src/story/model.js";
import type { PickerItem } from "../src/story/picker.js";
import {
  duplicated,
  roundsShort,
  soundShort,
  statusOf,
  toggled,
  triggerShort,
} from "../src/story/picker.js";
import { roundsText, triggerText } from "../src/story/describe.js";
import { triggerChip } from "../src/story/builder-overview.js";
import { PRESETS, presetOf } from "../src/story/presets.js";

const preset = (key: string): Story => JSON.parse(JSON.stringify(presetOf(key))) as Story;
const EVENT = {
  name: "Demo Event",
  hostname: null,
  time_zone: "UTC",
  starts_at: "2026-03-14T12:00:00Z",
  ends_at: "2026-03-15T18:00:00Z",
};
const DINNER = {
  id: "it_dinner",
  title: "Dinner",
  kind: "meal",
  visibility: "public",
  status: "scheduled",
  starts_at: "2026-03-14T19:00:00Z",
  ends_at: "2026-03-14T20:00:00Z",
};
const at = (items: PickerItem[] = []) => ({
  items,
  now: Date.parse("2026-03-14T17:00:00Z"),
  event: EVENT,
});

describe("the picker's words", () => {
  it("says what triggers each preset, its rounds and its sound in a few words", () => {
    expect(preset("starting_soon").triggers.map(triggerShort)).toEqual([
      "item tournament, ceremony · start",
      "by hand",
    ]);
    expect(triggerShort(preset("prize_draw").triggers[0] as Story["triggers"][number])).toBe(
      "one item (pick it) · start",
    );
    expect(preset("sponsor_thanks").triggers.map(triggerShort)).toEqual([
      "clock every 60 min 10:00–22:00",
    ]);
    expect(preset("premiere").triggers.map(triggerShort)).toEqual([
      "item premiere · start",
      "by hand",
      "clock once (set a time)",
    ]);
    expect(roundsShort(preset("starting_soon"))).toBe("−15, −5, −1 · until it starts · finale");
    expect(roundsShort(preset("doors_open"))).toBe("every 10 min · 3 rounds");
    expect(roundsShort(preset("stage_break"))).toBe("every 5 min · until the next item");
    expect(soundShort(preset("starting_soon"))).toBe("first and last round · finale");
    expect(soundShort(preset("prize_draw"))).toBe("finale");
    expect(soundShort(preset("sponsor_thanks"))).toBe("none");
    expect(soundShort(preset("premiere"))).toBe("the video's own");
    // The builder's sentences for a clock with no time yet and one round at T.
    expect(preset("premiere").triggers.map(triggerText).at(-1)).toBe("Once, at a time not set yet");
    expect(roundsText(preset("premiere"))).toMatch(/^At T · 1 rounds/);
    // #638 (P14): events in words, as an item trigger reads (P11).
    expect(preset("match_called").triggers.map(triggerText)[0]).toBe("When a match is called");
    expect(preset("match_called").triggers.map(triggerChip)[0]).toBe("A match is called");
    expect(roundsText(preset("match_called"))).toContain("until a match starts");
    expect(roundsText(preset("match_called"))).not.toMatch(/tournament\./);
  });
});

describe("a preset's status", () => {
  it("names the next matching item, or says it is idle", () => {
    expect(statusOf(preset("meal_served"), at([DINNER]))).toContain("Next: Sat 19:00, Dinner");
    expect(statusOf(preset("meal_served"), at())).toContain(
      "Waits for a matching item in the run of show",
    );
    const cancelled = { ...DINNER, status: "cancelled" };
    expect(statusOf(preset("meal_served"), at([cancelled]))).toContain(
      "Waits for a matching item in the run of show",
    );
    expect(statusOf(preset("closing_time"), at())).toContain("Next: Sun 18:00");
  });

  it("asks for an item or a time a preset needs, and says when it waits for an event not sent yet", () => {
    expect(statusOf(preset("prize_draw"), at([DINNER]))).toContain("Pick an item");
    expect(statusOf(preset("premiere"), at())).toContain("Set its time");
    expect(statusOf(preset("pizza_last_call"), at())).toContain(
      "Waits for “A pizza order is about to close”, which the pizza module sends from step 5",
    );
    expect(statusOf(preset("midnight"), at())).toContain("Not in a quiet scene");
  });

  it("names the rule a preset replaces, or would replace when on", () => {
    expect(statusOf(preset("match_called"), at())).toContain(
      "Replaces the built-in rule match called",
    );
    expect(statusOf(preset("hot_game"), at())).toContain(
      "Would replace the built-in rule hot game",
    );
    expect(statusOf(preset("pizza_arrived"), at())).toContain(
      "Takes the arrived order from the built-in rule pizza",
    );
    const copy = { ...preset("hot_game"), key: "hot_game_copy", preset: null };
    expect(statusOf(copy, at()).join(" ")).not.toMatch(/rule/);
  });

  // #638 (P10): the notes read as words, never an event type or a status code.
  it("writes no event type and no code in any preset's notes", () => {
    for (const p of PRESETS)
      for (const note of statusOf(p, at([DINNER]))) {
        expect(note, p.key).not.toMatch(/[a-z]+\.[a-z_]+\.[a-z_]+/);
        expect(note, p.key).not.toMatch(/^(idle|next):/);
      }
  });
});

describe("on, off and duplicate", () => {
  const event = () => PRESETS.slice(0, 5).map((p) => JSON.parse(JSON.stringify(p)) as Story);

  it("copies a preset the event has not got when it is turned on", () => {
    const out = toggled(event(), "meal_served");
    expect(out.find((s) => s.key === "meal_served")).toMatchObject({
      preset: "meal_served",
      enabled: true,
    });
    expect(toggled(out, "meal_served").find((s) => s.key === "meal_served")?.enabled).toBe(false);
  });

  it("turns Champion replay on and off with Champion, and each off alone", () => {
    const on = (list: Story[], key: string) => list.find((s) => s.key === key)?.enabled;
    const off = toggled(event(), "champion");
    expect(on(off, "champion")).toBe(false);
    expect(off.some((s) => s.key === "champion_replay")).toBe(false);
    const back = toggled(off, "champion");
    expect([on(back, "champion"), on(back, "champion_replay")]).toEqual([true, true]);
    const alone = toggled(back, "champion_replay");
    expect([on(alone, "champion"), on(alone, "champion_replay")]).toEqual([true, false]);
    const both = toggled(alone, "champion");
    expect([on(both, "champion"), on(both, "champion_replay")]).toEqual([false, false]);
  });

  it("duplicates a story to edit: the event's own, off, under a new key", () => {
    const first = duplicated(event(), "doors_open");
    expect(first.key).toBe("doors_open_copy");
    expect(first.list.at(-1)).toMatchObject({
      key: "doors_open_copy",
      name: "Doors open (copy)",
      preset: null,
      enabled: false,
    });
    expect(duplicated(first.list, "doors_open").key).toBe("doors_open_copy_2");
    // A preset not yet in the event is duplicated from the platform's.
    expect(duplicated(event(), "premiere").list.at(-1)).toMatchObject({
      key: "premiere_copy",
      preset: null,
    });
  });
});
