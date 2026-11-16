/** The arbiter's pure rules (contracts/moments.md, Classes and the priority order; The arbiter's rules). */
import { describe, expect, it } from "vitest";
import {
  CLASSES,
  DEFAULT_ORDER,
  blockedOn,
  checkOrder,
  desiredOverrides,
  overrideChanges,
  rankOf,
} from "../src/arbiter.js";
import type { Class, Held, MomentShape, SentOverride } from "../src/arbiter.js";

const moment = (over: Partial<MomentShape> = {}): MomentShape => ({
  id: "m_1",
  class: "hot_game",
  zones: [],
  left_zones: [],
  ...over,
});

describe("the priority order", () => {
  it("ranks the default order as the plan draws it, emergency first", () => {
    expect(DEFAULT_ORDER[0]).toBe("emergency");
    expect(CLASSES.map((c) => rankOf(DEFAULT_ORDER, c))).toEqual([
      100, 90, 80, 70, 65, 60, 55, 50, 20, 10,
    ]);
  });

  it("gives a moved class the rank of its new place", () => {
    const order = [...DEFAULT_ORDER];
    // Tournament above announcement (mockup 08's Stage).
    order.splice(order.indexOf("tournament"), 1);
    order.splice(order.indexOf("announcement"), 0, "tournament");
    expect(rankOf(order, "tournament")).toBe(80);
    expect(rankOf(order, "announcement")).toBe(70);
  });

  it("refuses an order without emergency first or with a class missing or twice", () => {
    expect(checkOrder(DEFAULT_ORDER)).toBeNull();
    expect(checkOrder([...DEFAULT_ORDER.slice(1), "emergency"])).toMatch(/emergency/);
    expect(checkOrder([...DEFAULT_ORDER.slice(0, 9), "emergency"])).toMatch(/once/);
    expect(checkOrder(DEFAULT_ORDER.slice(0, 9))).toMatch(/every class/);
  });
});

describe("overrides per rank", () => {
  const orders = { order: DEFAULT_ORDER, zones: {} };

  it("shows a moment on every zone as one override with zones []", () => {
    expect(desiredOverrides(moment(), orders, ["main", "stage"], [])).toEqual([
      { id: "m_1", zones: [], rank: 50 },
    ]);
  });

  it("splits a zone with its own rank into an override of its own", () => {
    const stage: Class[] = [...DEFAULT_ORDER].reverse().filter((c) => c !== "emergency");
    const own = { order: DEFAULT_ORDER, zones: { stage: ["emergency", ...stage] as Class[] } };
    expect(desiredOverrides(moment(), own, ["main", "stage", "cafe"], [])).toEqual([
      { id: "m_1", zones: ["cafe", "main"], rank: 50 },
      { id: "m_1.stage", zones: ["stage"], rank: rankOf(own.zones.stage, "hot_game") },
    ]);
  });

  it("keeps a split zone in its own override once split, even when its rank comes back", () => {
    expect(desiredOverrides(moment(), orders, ["main", "stage"], ["stage"])).toEqual([
      { id: "m_1", zones: ["main"], rank: 50 },
      { id: "m_1.stage", zones: ["stage"], rank: 50 },
    ]);
  });

  it("leaves out the zones the moment left, and nothing remains of an explicit list it left", () => {
    expect(
      desiredOverrides(moment({ left_zones: ["main"] }), orders, ["main", "stage"], []),
    ).toEqual([{ id: "m_1", zones: ["stage"], rank: 50 }]);
    expect(
      desiredOverrides(moment({ zones: ["main"], left_zones: ["main"] }), orders, ["main"], []),
    ).toEqual([]);
  });

  it("never splits an emergency: nothing outranks it anywhere", () => {
    const stage = { order: DEFAULT_ORDER, zones: { stage: DEFAULT_ORDER } };
    expect(desiredOverrides(moment({ class: "emergency" }), stage, ["main", "stage"], [])).toEqual([
      { id: "m_1", zones: [], rank: 100 },
    ]);
  });
});

describe("refusal", () => {
  const held = (role: string, rank: number, state: Held["state"] = "placed"): Held => ({
    override_id: `o_${role}_${rank}`,
    role,
    rank,
    state,
  });

  it("is blocked when every role of the chain is held by a higher rank", () => {
    expect(blockedOn(["hero", "rail"], 50, [held("hero", 60), held("rail", 80)])).toBe(true);
  });

  it("is not blocked while a role of its chain is free or held lower: regions are shared", () => {
    expect(blockedOn(["hero", "rail"], 50, [held("hero", 60)])).toBe(false);
    expect(blockedOn(["hero", "rail"], 50, [held("hero", 60), held("rail", 20)])).toBe(false);
  });

  it("counts a higher full claim as holding every role but the overlay", () => {
    expect(blockedOn(["hero", "rail", "ticker"], 80, [held("full", 100)])).toBe(true);
    expect(blockedOn(["overlay"], 20, [held("full", 100)])).toBe(false);
  });

  it("ignores claims that wait: an unplaced claim holds nothing", () => {
    expect(blockedOn(["hero"], 50, [held("hero", 60, "unplaced")])).toBe(false);
  });
});

describe("what an override's change says", () => {
  const sent: SentOverride = {
    id: "m_1",
    kind: "block",
    zones: [],
    rank: 50,
    template: "hot_game",
    content: { players: 14 },
    regions: ["hero", "rail"],
    expires_at: "2026-01-01T21:12:00.000Z",
  };

  it("names only the fields that changed", () => {
    expect(overrideChanges(sent, { ...sent, rank: 60 })).toEqual(["rank"]);
    expect(
      overrideChanges(sent, { ...sent, content: { players: 15 }, expires_at: "x" }).sort(),
    ).toEqual(["content", "expires_at"]);
    expect(overrideChanges(sent, { ...sent })).toEqual([]);
  });

  it("calls a smaller list of zones a narrowing", () => {
    expect(overrideChanges({ ...sent, zones: ["a", "b"] }, { ...sent, zones: ["a"] })).toEqual([
      "zones",
    ]);
  });
});
