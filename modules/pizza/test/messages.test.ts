/** The Food pages' catalogues: Finnish says what English says, with the same placeholders. */
import { describe, expect, it } from "vitest";
import { CREW_STEP_NAMES } from "../src/pages/crew-views.js";
import { EN, isKey, translator } from "../src/pages/messages.js";
import { FI } from "../src/pages/messages-fi.js";

const holes = (text: string) => [...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).sort();

describe("the Food pages' messages", () => {
  it("has every English key in Finnish, each with the same placeholders", () => {
    expect(Object.keys(FI).sort()).toEqual(Object.keys(EN).sort());
    for (const [key, text] of Object.entries(EN))
      expect(holes(FI[key as keyof typeof EN]), key).toEqual(holes(text));
  });

  it("has the words for every state, step-in, reminder and history line the pages name", () => {
    const named = [
      ...["open", "closed", "placed", "arrived", "done", "cancelled"].map((s) => `state.${s}`),
      ...CREW_STEP_NAMES.map((s) => `crew.do_${s.replace("-", "_")}`),
      ...["open_past_target", "closed_not_placed", "not_arrived", "released", "not_collected"].map(
        (k) => `reminder.${k}`,
      ),
      ...["released", "forced", "timeout"].map((r) => `history.released_${r}`),
      ...["handed_out", "holder", "timer"].map((r) => `history.done_${r}`),
      ...["opened", "claimed", "taken_over", "closed", "reopened", "placed", "arrived"].map(
        (k) => `history.${k}`,
      ),
      ...["reverted", "cancelled", "edited", "item_added", "item_changed", "item_removed"].map(
        (k) => `history.${k}`,
      ),
      ...["items_removed", "handed_out_all", "nudged", "last_call", "reminded"].map(
        (k) => `history.${k}`,
      ),
    ];
    for (const key of named) expect(isKey(key), key).toBe(true);
  });

  it("fills placeholders, and falls back to English for a language without a catalogue", () => {
    expect(translator("fi")("order.title", { seq: 3, pizzeria: "Demo" })).toBe("Tilaus 3 · Demo");
    expect(translator("sv")("order.title", { seq: 3, pizzeria: "Demo" })).toBe("Order 3 · Demo");
  });
});
