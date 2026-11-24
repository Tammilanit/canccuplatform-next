/** The airtime scheduler (#777, contracts/moments.md, The arbiter's rules): pure, times in ms. */
import { describe, expect, it } from "vitest";
import { planZone } from "../src/air-plan.js";
import type { SlotIn, ZoneIn, ZonePlan } from "../src/air-plan.js";
import { DEFAULT_AIR } from "../src/air-settings.js";

const slot = (id: string, over: Partial<SlotIn> = {}): SlotIn => ({
  moment_id: id,
  class: "finals",
  rank: 65,
  chain: ["hero"],
  origin: "rule",
  rule_id: null,
  has_steps: false,
  fresh_at: 0,
  queued_since: 0,
  forward_at: null,
  granted: null,
  on_air_since: null,
  played_ms: 0,
  tenure_from_ms: 0,
  budget_ms: 120_000,
  ...over,
});

const card = (over: Partial<SlotIn> = {}) =>
  slot("card", { granted: "hero", on_air_since: 0, ...over });
const pizza = (over: Partial<SlotIn> = {}) =>
  slot("pizza", {
    class: "announcement",
    rank: 80,
    chain: ["hero", "rail", "ticker"],
    queued_since: 5000,
    fresh_at: 5000,
    budget_ms: 180_000,
    ...over,
  });
const held: ZoneIn = { holder: "card", free_since: null };
const of = (p: ZonePlan, id: string) => p.slots.find((s) => s.moment_id === id);

describe("the airtime scheduler", () => {
  it("the floor holds against a higher rank", () => {
    const at89 = planZone(89_000, held, [card(), pizza()], DEFAULT_AIR);
    expect(at89.zone.holder).toBe("card");
    expect(of(at89, "pizza")).toMatchObject({ granted: "rail", regions: ["rail", "ticker"] });
    const at90 = planZone(90_000, held, [card(), pizza()], DEFAULT_AIR);
    expect(at90.zone).toEqual({ holder: null, free_since: 90_000 });
    expect(of(at90, "card")).toMatchObject({ granted: null, regions: null, queued_since: 90_000 });
  });

  it("the gap, then the queue's head", () => {
    const zone: ZoneIn = { holder: null, free_since: 90_000 };
    const waiting = [
      card({ granted: null, on_air_since: null, played_ms: 90_000, queued_since: 90_000 }),
    ];
    const early = planZone(99_999, zone, [...waiting, pizza({ granted: "rail" })], DEFAULT_AIR);
    expect(early.zone.holder).toBeNull();
    const now = planZone(100_000, zone, [...waiting, pizza({ granted: "rail" })], DEFAULT_AIR);
    expect(now.zone.holder).toBe("pizza");
    expect(of(now, "pizza")).toMatchObject({
      granted: "hero",
      regions: ["hero", "rail", "ticker"],
    });
  });

  it("a crew spotlight cuts the floor", () => {
    const spot = slot("spot", {
      class: "spotlight",
      rank: 70,
      origin: "crew",
      queued_since: 10_000,
    });
    const p = planZone(10_000, held, [card(), spot], DEFAULT_AIR);
    expect(p.zone.holder).toBe("spot");
    expect(of(p, "card")).toMatchObject({ granted: null, queued_since: 10_000 });
  });

  it("a lower rank waits for the holder's end", () => {
    const h = pizza({ moment_id: "card", granted: "hero", on_air_since: 0, queued_since: 0 });
    const p = planZone(100_000, held, [h, slot("final", { queued_since: 1000 })], DEFAULT_AIR);
    expect(p.zone.holder).toBe("card");
  });

  it("equals wait their turn", () => {
    const other = slot("other", { queued_since: 1000 });
    const p = planZone(100_000, held, [card(), other], DEFAULT_AIR);
    expect(p.zone.holder).toBe("card");
    expect(of(p, "other")).toMatchObject({ granted: null, regions: null });
  });

  it("stale after 30 minutes, never before", () => {
    const hot = slot("hot", { class: "hot_game", rank: 50, chain: ["hero", "rail"] });
    expect(planZone(1_799_999, held, [card({ budget_ms: null }), hot], DEFAULT_AIR).ends).toEqual(
      [],
    );
    expect(planZone(1_800_000, held, [card({ budget_ms: null }), hot], DEFAULT_AIR).ends).toEqual([
      { moment_id: "hot", reason: "stale" },
    ]);
    expect(planZone(1_800_000, held, [card({ budget_ms: null })], DEFAULT_AIR).ends).toEqual([]);
  });

  it("a budget shorter than the floor ends on its own", () => {
    const p = planZone(20_000, held, [card({ budget_ms: 20_000 })], DEFAULT_AIR);
    expect(p.ends).toEqual([{ moment_id: "card", reason: "expired" }]);
    expect(p.zone).toEqual({ holder: null, free_since: 20_000 });
  });

  it("counts the gap from the holder's real end, not from the pass that noticed it", () => {
    const p = planZone(200_000, held, [card({ budget_ms: 20_000 }), pizza()], DEFAULT_AIR);
    expect(p.zone.holder).toBe("pizza");
  });

  it("lets a story's next segment continue its round at once, ending the one before", () => {
    const steps = card({
      moment_id: "steps",
      class: "storyboard",
      rank: 60,
      rule_id: "story:film",
      has_steps: true,
    });
    const film = slot("film", {
      class: "storyboard",
      rank: 60,
      chain: ["full"],
      rule_id: "story:film",
      queued_since: 14_000,
    });
    const p = planZone(14_000, { holder: "steps", free_since: null }, [steps, film], DEFAULT_AIR);
    expect(p.ends).toEqual([{ moment_id: "steps", reason: "expired" }]);
    expect(p.zone).toEqual({ holder: "film", free_since: null });
  });

  it("moved forward goes first", () => {
    const free: ZoneIn = { holder: null, free_since: null };
    const low = slot("low", { class: "hot_game", rank: 50, forward_at: 3000, queued_since: 2000 });
    const p = planZone(4000, free, [slot("high", { queued_since: 1000 }), low], DEFAULT_AIR);
    expect(p.zone.holder).toBe("low");
  });

  it("routine moments condense over three", () => {
    const free: ZoneIn = { holder: null, free_since: null };
    const hots = [1, 2, 3, 4].map((n) =>
      slot(`hot${String(n)}`, {
        class: "hot_game",
        rank: 50,
        rule_id: "hot_game",
        chain: ["hero", "rail"],
        queued_since: n,
      }),
    );
    const p = planZone(10, free, hots, DEFAULT_AIR);
    expect(p.zone.holder).toBe("hot1");
    expect(p.condensed).toEqual({ holder: "hot1", inside: ["hot2", "hot3", "hot4"] });
    expect(of(p, "hot3")).toMatchObject({ granted: "inside", inside_of: "hot1", regions: null });
  });

  it("three do not condense", () => {
    const free: ZoneIn = { holder: null, free_since: null };
    const hots = [1, 2, 3].map((n) =>
      slot(`hot${String(n)}`, {
        class: "hot_game",
        rank: 50,
        rule_id: "hot_game",
        queued_since: n,
      }),
    );
    expect(planZone(10, free, hots, DEFAULT_AIR).condensed).toBeNull();
  });

  it("a story round never waits in the rail", () => {
    const story = slot("story", {
      class: "storyboard",
      rank: 70,
      chain: ["hero", "rail"],
      has_steps: true,
    });
    const p = planZone(1000, held, [card(), story, pizza({ rank: 60 })], DEFAULT_AIR);
    expect(of(p, "story")).toMatchObject({ granted: null, regions: null });
    expect(of(p, "pizza")).toMatchObject({ granted: "rail" });
  });

  it("a zone's own order ranks its queue", () => {
    const free: ZoneIn = { holder: null, free_since: null };
    const own = slot("own", { class: "hot_game", rank: 90, queued_since: 2000 });
    expect(
      planZone(3000, free, [slot("first", { queued_since: 1000 }), own], DEFAULT_AIR).zone.holder,
    ).toBe("own");
  });

  it("lets what has neither hero nor full pass with its own chain", () => {
    const line = slot("line", { class: "ticker", rank: 10, chain: ["ticker"] });
    expect(of(planZone(0, held, [card(), line], DEFAULT_AIR), "line")).toMatchObject({
      granted: "pass",
      regions: ["ticker"],
    });
  });
});
