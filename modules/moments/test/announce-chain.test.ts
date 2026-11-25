/**
 * An announcement's placement and chain (contracts/moments.md, Levels, placement and the full
 * screen; #780): the level sets the default, the organiser's pick wins, an old client's
 * `full_screen` keeps what it always meant, and Screen gets the grow rule and the kept ticker.
 */
import { describe, expect, it } from "vitest";
import { chainOf, overrideHints, placementOf } from "../src/announce/chain.js";

describe("the placement", () => {
  it("defaults by level: Info the rail, Important the hero, Urgent the full screen", () => {
    expect(placementOf("info", null, undefined)).toBe("rail");
    expect(placementOf("important", null, undefined)).toBe("hero");
    expect(placementOf("urgent", null, undefined)).toBe("full");
  });

  it("is the organiser's pick, over full_screen when both are sent", () => {
    expect(placementOf("urgent", "rail", undefined)).toBe("rail");
    expect(placementOf("info", "hero", true)).toBe("hero");
  });

  it("keeps an old client's meaning: full_screen true is full, false the rail", () => {
    expect(placementOf("info", null, true)).toBe("full");
    expect(placementOf("urgent", null, false)).toBe("rail");
  });
});

describe("the chain", () => {
  it.each([
    ["info", "rail", ["rail", "ticker"], null, false],
    ["important", "rail", ["rail", "ticker"], null, false],
    // An urgent one in the rail keeps the chain it always had, for stored rows and old clients.
    ["urgent", "rail", ["rail", "hero", "ticker"], null, false],
    ["info", "hero", ["hero", "rail", "ticker"], null, false],
    ["important", "hero", ["hero", "full", "rail", "ticker"], 0.35, false],
    ["urgent", "hero", ["hero", "full", "rail", "ticker"], 0.35, false],
    ["info", "full", ["full", "hero", "rail", "ticker"], null, true],
    ["important", "full", ["full", "hero", "rail", "ticker"], null, true],
    ["urgent", "full", ["full", "hero", "rail", "ticker"], null, false],
  ] as const)("%s in the %s: %j", (level, placement, regions, share, keep) => {
    expect(chainOf(level, placement)).toEqual({
      regions,
      hero_min_share: share,
      keep_ticker: keep,
    });
  });
});

describe("the hints on the wire", () => {
  const card = (level: string, regions: string[]) => ({
    template: "announcement",
    content: { level },
    regions,
  });

  it("follow the card's level and chain, for a composed one and a rule's alike", () => {
    expect(overrideHints(card("important", ["hero", "full", "rail", "ticker"]))).toEqual({
      hero_min_share: 0.35,
      keep_ticker: false,
    });
    expect(overrideHints(card("info", ["full", "hero", "rail", "ticker"]))).toEqual({
      hero_min_share: null,
      keep_ticker: true,
    });
  });

  it("are never set for the emergency nor for another template", () => {
    expect(overrideHints(card("emergency", ["full"]))).toEqual({});
    expect(overrideHints({ template: "hot_game", content: {}, regions: ["hero", "full"] })).toEqual(
      {},
    );
  });
});
