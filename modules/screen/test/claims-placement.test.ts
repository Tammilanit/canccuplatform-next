import { describe, expect, it } from "vitest";
import type { RegionView } from "../src/compose/build.js";
import { activeOn, overrideOf, placeClaims } from "../src/compose/claims.js";
import type { Override } from "../src/compose/claims.js";

const AT = Date.parse("2026-01-01T18:01:00Z");

function region(id: string, role: RegionView["role"]): RegionView {
  return {
    id,
    role,
    area: { column: 1, row: 1, columns: 1, rows: 1 },
    layer: 0,
    rotation: "sequence",
    order: [],
    cycle_started_at: "2026-01-01T18:00:00.000Z",
    idle: "logo",
    idle_view: null,
    widgets: [],
    claim: null,
  };
}

const PULSE = [
  region("header", "header"),
  region("hero", "hero"),
  region("rail", "rail"),
  region("venue_rail", "venue_rail"),
  region("ticker", "ticker"),
  region("_full", "full"),
  region("_overlay", "overlay"),
];
const NO_RAIL = PULSE.filter((r) => r.role !== "rail" && r.role !== "venue_rail");

function override(id: string, over: Record<string, unknown> = {}): Override {
  const parsed = overrideOf({
    id,
    kind: "block",
    zones: [],
    rank: 50,
    source: { module: "moments", event_id: null, ref: null },
    template: "announcement",
    content: { title: id, body: "", level: "info", starts_at: "2026-01-01T18:00:00Z" },
    starts_at: "2026-01-01T18:00:00Z",
    ends_at: null,
    ...over,
  });
  if (parsed === null) throw new Error(`fixture ${id} does not parse`);
  return parsed;
}

const held = (regions: RegionView[]) =>
  Object.fromEntries(
    regions.flatMap((r) =>
      r.claim === null ? [] : [[r.id, `${r.claim.override_id}${r.claim.hidden ? " hidden" : ""}`]],
    ),
  );

describe("an override as Screen reads it", () => {
  it("takes the contract's fields and derives its end", () => {
    const o = override("ov_1", { ttl_seconds: 300 });
    expect(o.expires_at).toBe("2026-01-01T18:05:00.000Z");
    expect(o.on_end).toBe("resume");
    expect(o.regions).toBeNull();
    expect(
      override("ov_2", { expires_at: "2026-01-01T19:00:00Z", ttl_seconds: 5 }).expires_at,
    ).toBe("2026-01-01T19:00:00Z");
  });

  it("refuses a malformed one rather than drawing half of it", () => {
    const good = {
      id: "ov_1",
      kind: "block",
      zones: [],
      rank: 1,
      template: "announcement",
      content: {},
      starts_at: "2026-01-01T18:00:00Z",
      ends_at: null,
    };
    expect(overrideOf(good)).not.toBeNull();
    for (const bad of [
      { kind: "banner" },
      { zones: "main" },
      { rank: 1.5 },
      { content: null },
      { starts_at: "soon" },
      { regions: ["hero", 3] },
      { steps: [{ template: "sting", content: {}, duration_ms: 100 }] },
      { on_end: "later" },
      { sound: { cue: "x", url: null, volume: 2, play: "once" } },
    ]) {
      expect(overrideOf({ ...good, ...bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it("is active on its zones until its expiry or its planned end, whichever is first", () => {
    const o = override("ov_1", {
      zones: ["main"],
      ttl_seconds: 120,
      ends_at: "2026-01-01T18:01:00Z",
    });
    expect(activeOn(o, "main", AT - 1)).toBe(true);
    expect(activeOn(o, "main", AT)).toBe(false);
    expect(activeOn(o, "cafe", AT - 1)).toBe(false);
    expect(activeOn(override("ov_2"), "anywhere", AT + 86_400_000)).toBe(true);
  });
});

describe("claim placement", () => {
  it("puts a block in the first free role of its chain, and falls back down it", () => {
    const ov = override("ov_10", { rank: 80, regions: ["rail", "ticker"] });
    expect(held(placeClaims(PULSE, [ov]).regions)).toEqual({ rail: "ov_10" });
    // A zone whose layout has no rail: the ticker line.
    expect(held(placeClaims(NO_RAIL, [ov]).regions)).toEqual({ ticker: "ov_10" });
  });

  it("derives the chain from the kind when the override names none", () => {
    const placed = placeClaims(PULSE, [
      override("t", { kind: "takeover", rank: 10 }),
      override("o", { kind: "overlay", rank: 20 }),
      override("b", { kind: "block", rank: 30 }),
    ]);
    // The block outranks the takeover, so `full` is not free for it: the takeover is unplaced.
    expect(held(placed.regions)).toEqual({ hero: "b", _overlay: "o" });
    expect(placed.unplaced).toEqual(["t"]);
  });

  it("walks by rank, then the later start, then the id, so ties never flap", () => {
    const a = override("a", { rank: 50, regions: ["hero"], starts_at: "2026-01-01T18:00:00Z" });
    const b = override("b", { rank: 50, regions: ["hero"], starts_at: "2026-01-01T18:00:30Z" });
    const c = override("c", { rank: 50, regions: ["hero"], starts_at: "2026-01-01T18:00:30Z" });
    for (const order of [
      [a, b, c],
      [c, b, a],
    ]) {
      const placed = placeClaims(PULSE, order);
      expect(held(placed.regions)).toEqual({ hero: "b" });
      expect(placed.unplaced).toEqual(["c", "a"]);
    }
  });

  it("hides what ranks below a placed takeover, and draws a higher overlay on top of it", () => {
    const placed = placeClaims(PULSE, [
      override("emergency", { kind: "takeover", rank: 100 }),
      override("band", { kind: "overlay", rank: 120 }),
      override("note", { kind: "block", rank: 80, regions: ["rail"] }),
      override("low_band", { kind: "overlay", rank: 10 }),
    ]);
    expect(held(placed.regions)).toEqual({
      _full: "emergency",
      _overlay: "band",
      rail: "note hidden",
    });
    expect(placed.hidden).toEqual(["note"]);
    expect(placed.unplaced).toEqual(["low_band"]);
    expect(placed.placed).toEqual([
      { override_id: "band", role: "overlay" },
      { override_id: "emergency", role: "full" },
      { override_id: "note", role: "rail" },
    ]);
  });

  it("never claims the header or the backdrop, nor a role the layout lacks", () => {
    const placed = placeClaims(NO_RAIL, [
      override("x", { regions: ["header", "backdrop", "venue_rail"] }),
    ]);
    expect(held(placed.regions)).toEqual({});
    expect(placed.unplaced).toEqual(["x"]);
  });

  it("draws a claim once, in the first region of its role", () => {
    const parts = [region("rail", "rail"), region("rail-2", "rail"), ...PULSE.slice(-2)];
    expect(held(placeClaims(parts, [override("x", { regions: ["rail"] })]).regions)).toEqual({
      rail: "x",
    });
  });

  it("gives the region the claim as the contract lists it", () => {
    const steps = [{ template: "sting", content: { text: "Hot" }, duration_ms: 2500, sound: null }];
    const [claimed] = placeClaims(PULSE, [
      override("ov_12", { regions: ["hero"], steps, ttl_seconds: 120, on_end: "next" }),
    ]).regions.filter((r) => r.claim !== null);
    expect(claimed?.claim).toEqual({
      override_id: "ov_12",
      hidden: false,
      role: "hero",
      rank: 50,
      template: "announcement",
      content: { title: "ov_12", body: "", level: "info", starts_at: "2026-01-01T18:00:00Z" },
      steps,
      sound: null,
      on_end: "next",
      starts_at: "2026-01-01T18:00:00Z",
      ends_at: null,
      expires_at: "2026-01-01T18:02:00.000Z",
    });
  });
});
