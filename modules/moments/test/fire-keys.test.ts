/** Fire's chooser (#638): each preset button carries its own key, so one tap never replays another's answer. */
import { describe, expect, it } from "vitest";
import { crewStories } from "../src/story/views.js";
import { presetOf } from "../src/story/presets.js";
import type { Story } from "../src/story/model.js";

describe("the Fire chooser's idempotency keys", () => {
  it("gives every preset button its own key and the form none", () => {
    const stories = ["champion", "starting_soon"].map((k) => ({
      ...(presetOf(k) as Story),
      enabled: true,
    }));
    const out = String(
      crewStories({
        stories,
        runs: [],
        items: [],
        agenda: [],
        now: Date.parse("2026-03-14T17:00:00Z"),
        canTake: true,
        back: "on-air",
        timeZone: "UTC",
        settings: {} as never,
      }),
    );
    const keys = [...out.matchAll(/name="idempotency_key"\s+value="([^"]+)"/g)].map((m) => m[1]);
    const buttons = [...out.matchAll(/formaction="[^"]*\/fire"/g)];
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    expect(keys).toHaveLength(buttons.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Enter in a variable field submits the form's first submit button: it must be a disabled one,
  // never the first preset's.
  it("puts a disabled submit button before every preset, so Enter fires nothing", () => {
    const stories = ["champion", "starting_soon"].map((k) => ({
      ...(presetOf(k) as Story),
      enabled: true,
    }));
    const out = String(
      crewStories({
        stories,
        runs: [],
        items: [],
        agenda: [],
        now: Date.parse("2026-03-14T17:00:00Z"),
        canTake: true,
        back: "on-air",
        timeZone: "UTC",
        settings: {} as never,
      }),
    );
    const first = /<button[^>]*type="submit"[^>]*>/.exec(out)?.[0] ?? "";
    expect(first).toContain("disabled");
    expect(first).not.toContain("formaction");
  });
});
