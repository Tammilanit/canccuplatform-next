/**
 * Hero first, then a smaller box (#787 D7, contracts/moments.md, The arbiter's rules): a holder
 * whose chain goes on after `hero` steps down to its next free role after its hero time, keeping
 * the rest of its budget there. Pure, times in ms.
 */
import { describe, expect, it } from "vitest";
import { planZone } from "../src/air-plan.js";
import type { SlotIn, ZoneIn, ZonePlan } from "../src/air-plan.js";
import { DEFAULT_AIR } from "../src/air-settings.js";

const slot = (id: string, over: Partial<SlotIn> = {}): SlotIn => ({
  moment_id: id,
  class: "announcement",
  rank: 80,
  chain: ["hero", "rail", "ticker"],
  origin: "rule",
  rule_id: null,
  segment: null,
  has_steps: false,
  shown: false,
  placed: true,
  fresh_at: 0,
  queued_since: 0,
  forward_at: null,
  granted: null,
  inside_of: null,
  on_air_since: null,
  played_ms: 0,
  tenure_from_ms: 0,
  budget_ms: 180_000,
  ...over,
});

const result = (over: Partial<SlotIn> = {}) =>
  slot("result", { granted: "hero", on_air_since: 0, ...over });
const held: ZoneIn = { holder: "result", free_since: null };
const of = (p: ZonePlan, id: string) => p.slots.find((s) => s.moment_id === id);

describe("hero first, then a smaller box", () => {
  it("steps down to the rail at the floor, with nothing waiting", () => {
    expect(planZone(89_999, held, [result()], DEFAULT_AIR).zone.holder).toBe("result");
    const at90 = planZone(90_000, held, [result()], DEFAULT_AIR);
    expect(at90.zone).toEqual({ holder: null, free_since: 90_000 });
    expect(of(at90, "result")).toMatchObject({ granted: "down", regions: ["rail", "ticker"] });
    expect(at90.ends).toEqual([]);
  });

  it("keeps the rest of its budget there, never takes the hero again, and ends at its budget", () => {
    const down = result({ granted: "down", on_air_since: 0 });
    const free: ZoneIn = { holder: null, free_since: 90_000 };
    const later = planZone(150_000, free, [down], DEFAULT_AIR);
    expect(later.zone.holder).toBeNull();
    expect(of(later, "result")).toMatchObject({ granted: "down", regions: ["rail", "ticker"] });
    expect(planZone(180_000, free, [down], DEFAULT_AIR).ends).toEqual([
      { moment_id: "result", reason: "expired" },
    ]);
    // Stepped down for good: it never goes stale as a waiting one would.
    const old = planZone(40 * 60_000, free, [{ ...down, budget_ms: null }], DEFAULT_AIR);
    expect(old.ends).toEqual([]);
  });

  it("goes on to the ticker when the waiting room holds the rail", () => {
    const next = slot("next", { rank: 70, queued_since: 10_000, fresh_at: 10_000 });
    const at90 = planZone(90_000, held, [result(), next], DEFAULT_AIR);
    expect(of(at90, "next")).toMatchObject({ granted: "rail", regions: ["rail", "ticker"] });
    expect(of(at90, "result")).toMatchObject({ granted: "down", regions: ["ticker"] });
  });

  it("steps down to the venue rail where its chain says so", () => {
    const food = result({ chain: ["hero", "venue_rail", "ticker"] });
    const next = slot("next", { rank: 70, queued_since: 10_000, fresh_at: 10_000 });
    expect(of(planZone(90_000, held, [food, next], DEFAULT_AIR), "result")).toMatchObject({
      granted: "down",
      regions: ["venue_rail", "ticker"],
    });
  });

  it("steps an Important down past the full screen, never up into it", () => {
    const important = result({ chain: ["hero", "full", "rail", "ticker"] });
    expect(of(planZone(90_000, held, [important], DEFAULT_AIR), "result")).toMatchObject({
      granted: "down",
      regions: ["rail", "ticker"],
    });
    const only = result({ chain: ["hero", "full"] });
    expect(planZone(100_000, held, [only], DEFAULT_AIR).zone.holder).toBe("result");
  });

  it("keeps a full-screen holder whose chain has no hero where it is", () => {
    const full = result({ chain: ["full", "ticker"] });
    expect(planZone(100_000, held, [full], DEFAULT_AIR).zone.holder).toBe("result");
    expect(of(planZone(100_000, held, [full], DEFAULT_AIR), "result")?.granted).toBe("hero");
  });

  it("counts its own budget when that is under the floor", () => {
    const short = result({ budget_ms: 60_000 });
    expect(planZone(60_000, held, [short], DEFAULT_AIR).ends).toEqual([
      { moment_id: "result", reason: "expired" },
    ]);
  });

  it("leaves the hero to a moment whose chain ends there", () => {
    const at200 = planZone(100_000, held, [result({ chain: ["hero"] })], DEFAULT_AIR);
    expect(at200.zone.holder).toBe("result");
  });

  const exempt: [string, Partial<SlotIn>][] = [
    ["a stream", { class: "stream" }],
    ["a crew action", { origin: "crew" }],
    ["a story round", { segment: { round: "r1", index: 0 } }],
    ["a moment with steps", { has_steps: true }],
  ];
  for (const [name, over] of exempt)
    it(`keeps ${name} in the hero until it ends`, () => {
      const p = planZone(120_000, held, [result(over)], DEFAULT_AIR);
      expect(p.zone.holder).toBe("result");
      expect(of(p, "result")?.granted).toBe("hero");
    });

  it("keeps a condensed round in the hero until it ends", () => {
    const inside = slot("inside", { granted: "inside", inside_of: "result", rank: 50 });
    const p = planZone(120_000, held, [result({ rule_id: "standings" }), inside], DEFAULT_AIR);
    expect(p.zone.holder).toBe("result");
  });
});
