/**
 * The sound decision (src/cues/decide.ts), ported from the legacy engine's tests
 * (canccusignage tests/sound-engine.test.ts, catch-up.test.ts) and changed by the step 4 plan's
 * sound model: only urgent interrupts, the queue waits at most 4 s from the request, 3 sounds a
 * minute and an hourly budget per zone, calm and quiet let fewer categories through.
 */
import { describe, expect, it } from "vitest";
import { BUILTIN_CUES, DEFAULT_SOUND_SETTINGS } from "../src/cues/catalog.js";
import type { Cue, SoundSettings } from "../src/cues/catalog.js";
import { EMPTY_ZONE, decide, pickNotLast, pump } from "../src/cues/decide.js";
import type { Counts, DecideInput, ZoneSound } from "../src/cues/decide.js";

const T = Date.parse("2026-01-01T20:00:00Z");
const LENGTHS: Record<string, number> = { a: 2000, b: 2000, c: 2000, long: 9000, voice: 1500 };

const cue = (name: string, o: Partial<Cue> = {}): Cue => {
  const base = BUILTIN_CUES.find((c) => c.name === name);
  return {
    ...(base ?? {
      name,
      category: "attention",
      enabled: true,
      level: 100,
      cooldown_seconds: 0,
      catch_up_seconds: 120,
      catch_up_before_start: null,
      once_per_source: false,
      voice_line: null,
      effects: [],
      hold_seconds: 60,
      builtin: false,
    }),
    sounds: ["a"],
    ...o,
  };
};

const NONE: Counts = { minute: 0, hour: 0, once_played: false };

function input(o: Partial<DecideInput> & { cue: Cue }): DecideInput {
  return {
    now: T,
    settings: DEFAULT_SOUND_SETTINGS,
    energy: "lively",
    emergency: false,
    zone: EMPTY_ZONE,
    key: "k1",
    source: "s1",
    starts_at: null,
    counts: NONE,
    length: (id) => LENGTHS[id] ?? null,
    random: () => 0,
    ...o,
  };
}

/** Decides a run of requests on one zone, carrying the zone's state, as the store does. */
function run(requests: (Partial<DecideInput> & { cue: Cue })[], zone: ZoneSound = EMPTY_ZONE) {
  const out = [];
  for (const r of requests) {
    const d = decide(input({ ...r, zone }));
    zone = d.zone;
    out.push(d);
  }
  return { out, zone };
}

describe("the gates, in order", () => {
  it("plays a cue on a free zone, at its level times its category's and the master's", () => {
    const d = decide(input({ cue: cue("announce.attention", { level: 50 }) }));
    expect(d.outcome).toBe("played");
    expect(d.reason).toBe("free");
    // 0.8 master × 0.8 attention × 0.5 the cue.
    expect(d.play?.volume).toBeCloseTo(0.32);
    expect(d.play?.sound).toBe("a");
    expect(d.count).toBe(true);
  });

  it("the master switch and the timed mute silence everything, urgent too", () => {
    const off: SoundSettings = { ...DEFAULT_SOUND_SETTINGS, enabled: false };
    expect(decide(input({ cue: cue("emergency.start"), settings: off })).reason).toBe("master_off");
    const muted = { ...DEFAULT_SOUND_SETTINGS, muted_until: new Date(T + 60_000).toISOString() };
    expect(decide(input({ cue: cue("emergency.start"), settings: muted })).reason).toBe("muted");
    const over = { ...DEFAULT_SOUND_SETTINGS, muted_until: new Date(T - 1).toISOString() };
    expect(decide(input({ cue: cue("emergency.start"), settings: over })).outcome).toBe("played");
  });

  it("calm plays urgent, attention and result only; a quiet scene urgent only", () => {
    const at = (energy: DecideInput["energy"], name: string) =>
      decide(input({ cue: cue(name), energy })).reason;
    expect(at("calm", "photo.showcase")).toBe("calm");
    expect(at("calm", "chrome.hot")).toBe("calm");
    expect(at("calm", "announce.attention")).toBe("free");
    expect(at("calm", "tournament.post")).toBe("free");
    expect(at("quiet", "announce.attention")).toBe("quiet");
    expect(at("quiet", "announce.urgent")).toBe("free");
    expect(at("party", "chrome.hot")).toBe("free");
  });

  it("a category or a cue switched off says so; a cue without sounds is silent", () => {
    const settings = {
      ...DEFAULT_SOUND_SETTINGS,
      categories: {
        ...DEFAULT_SOUND_SETTINGS.categories,
        result: { enabled: false, level: 80 },
      },
    };
    expect(decide(input({ cue: cue("tournament.post"), settings })).reason).toBe("category_off");
    expect(decide(input({ cue: cue("poll.open", { enabled: false }) })).reason).toBe("cue_off");
    expect(decide(input({ cue: cue("poll.open", { enabled: true, sounds: [] }) })).reason).toBe(
      "no_sound",
    );
  });

  it("a cue waits its own cooldown on the zone", () => {
    const ticker = cue("ticker.message", { enabled: true });
    const { out } = run([
      { cue: ticker, key: "t1" },
      { cue: ticker, key: "t2", now: T + 60_000 },
      { cue: ticker, key: "t3", now: T + 121_000 },
    ]);
    expect(out.map((d) => d.reason)).toEqual(["free", "cooldown", "free"]);
    expect(out[1]?.detail).toContain("2 min");
  });

  it("while an emergency runs, only urgent sounds", () => {
    expect(decide(input({ cue: cue("tournament.post"), emergency: true })).reason).toBe(
      "emergency",
    );
    expect(decide(input({ cue: cue("announce.urgent"), emergency: true })).outcome).toBe("played");
  });

  it("plays once per appearance: the same trigger again is a dedupe", () => {
    const c = cue("announce.attention");
    const { out } = run([
      { cue: c, key: "photo:1" },
      { cue: c, key: "photo:1", now: T + 30_000 },
    ]);
    expect(out.map((d) => d.reason)).toEqual(["free", "dedupe"]);
  });

  it("a once-per-source cue never sounds twice for one source; others keep sounding", () => {
    expect(
      decide(input({ cue: cue("pizza.placed"), counts: { ...NONE, once_played: true } })).reason,
    ).toBe("once_per_source");
    expect(
      decide(input({ cue: cue("chrome.hot"), counts: { ...NONE, once_played: true } })).outcome,
    ).toBe("played");
    expect(decide(input({ cue: cue("pizza.placed") })).once).toBe(true);
  });

  it("the same cue within 2 s of the last it accepted on the zone coalesces into it", () => {
    const c = cue("pizza.placed");
    const { out } = run([
      { cue: c, key: "o1", source: "o1" },
      { cue: c, key: "o2", source: "o2", now: T + 1500 },
      { cue: c, key: "o3", source: "o3", now: T + 2500 },
    ]);
    // The first sound (2 s from 400 ms on) is over by 2.5 s: the third finds the zone free.
    expect(out.map((d) => d.reason)).toEqual(["free", "coalesced", "free"]);
  });

  it("the flood guard: 10 s per source and 3 sounds a minute per zone", () => {
    const c = cue("announce.attention");
    const again = run([
      { cue: c, key: "a", source: "g1" },
      { cue: c, key: "b", source: "g1", now: T + 9000 },
      { cue: c, key: "c", source: "g1", now: T + 10_000 },
    ]);
    expect(again.out.map((d) => d.reason)).toEqual(["free", "flood_source", "free"]);
    expect(decide(input({ cue: c, counts: { ...NONE, minute: 3 } })).reason).toBe("flood_minute");
    expect(decide(input({ cue: c, counts: { ...NONE, minute: 2 } })).outcome).toBe("played");
  });

  it("the hourly budget per zone; urgent passes the flood guard and the budget, and counts", () => {
    const c = cue("announce.attention");
    expect(decide(input({ cue: c, counts: { ...NONE, hour: 20 } })).reason).toBe("budget");
    const urgent = decide(
      input({ cue: cue("announce.urgent"), counts: { ...NONE, hour: 20, minute: 5 } }),
    );
    expect(urgent.outcome).toBe("played");
    expect(urgent.reason).toBe("urgent_passes");
    expect(urgent.count).toBe(true);
  });
});

describe("one at a time", () => {
  const long = cue("tournament.post", { sounds: ["long"] });

  it("a lower sound never interrupts a playing one: it waits in the queue", () => {
    const { out, zone } = run([
      { cue: long, key: "a" },
      { cue: cue("announce.attention"), key: "b", now: T + 1000 },
    ]);
    expect(out[1]?.outcome).toBe("queued");
    expect(out[1]?.play).toBeUndefined();
    expect(zone.playing?.cue).toBe("tournament.post");
    expect(zone.queue).toHaveLength(1);
  });

  it("a higher but not urgent sound waits too", () => {
    const { out } = run([
      { cue: cue("chrome.hot", { sounds: ["long"] }), key: "a" },
      { cue: cue("tournament.post"), key: "b", now: T + 1000 },
    ]);
    // Ambient never queues, so a result behind it waits and the ambient keeps playing.
    expect(out[1]?.outcome).toBe("queued");
  });

  it("only urgent interrupts, and the interrupted sound is named", () => {
    const { out, zone } = run([
      { cue: long, key: "a" },
      { cue: cue("emergency.start"), key: "b", now: T + 1000 },
    ]);
    expect(out[1]?.outcome).toBe("played");
    expect(out[1]?.reason).toBe("interrupted");
    expect(out[1]?.detail).toContain("tournament.post");
    expect(out[1]?.play?.interrupts).toBe(true);
    expect(zone.playing?.cue).toBe("emergency.start");
  });

  it("ambient never queues: it drops while anything plays, and keeps a 30 s gap", () => {
    const hot = cue("chrome.hot");
    const busy = run([
      { cue: long, key: "a" },
      { cue: hot, key: "b", now: T + 1000 },
    ]);
    expect(busy.out[1]?.reason).toBe("busy");
    const gap = run([
      { cue: hot, key: "a", source: "g1" },
      { cue: cue("chrome.voice"), key: "b", source: "g2", now: T + 20_000 },
    ]);
    expect(gap.out[1]?.reason).toBe("ambient_gap");
  });

  it("the queue plays the highest category first when the zone is free", () => {
    let { zone } = run([
      { cue: cue("tournament.post", { sounds: ["c"] }), key: "a" },
      { cue: cue("poll.open", { enabled: true }), key: "b", now: T + 500 },
      { cue: cue("announce.attention"), key: "c", now: T + 600 },
    ]);
    // The first sound runs from 0.4 s to 2.4 s.
    const p = pump(zone, T + 2500, DEFAULT_SOUND_SETTINGS, false);
    zone = p.zone;
    expect(p.done.map((d) => [d.cue, d.outcome])).toEqual([["announce.attention", "played"]]);
    expect(p.done[0]?.reason).toBe("waited");
    expect(zone.queue.map((q) => q.play.cue)).toEqual(["poll.open"]);
  });

  it("a queued sound waits at most 4 s from its request, then drops as stale", () => {
    const { zone } = run([
      { cue: long, key: "a" },
      { cue: cue("announce.attention"), key: "b", now: T + 1000 },
    ]);
    const early = pump(zone, T + 4500, DEFAULT_SOUND_SETTINGS, false);
    expect(early.done).toEqual([]);
    const late = pump(zone, T + 5100, DEFAULT_SOUND_SETTINGS, false);
    expect(late.done.map((d) => [d.outcome, d.reason])).toEqual([["dropped", "stale"]]);
    expect(late.zone.queue).toEqual([]);
  });

  it("an emergency drops the waiting non-urgent sounds", () => {
    const { zone } = run([
      { cue: long, key: "a" },
      { cue: cue("announce.attention"), key: "b", now: T + 1000 },
    ]);
    const p = pump(zone, T + 1500, DEFAULT_SOUND_SETTINGS, true);
    expect(p.done.map((d) => [d.outcome, d.reason])).toEqual([["dropped", "emergency"]]);
  });

  it("a voice line plays right after its sound, and the two count once", () => {
    const d = decide(input({ cue: cue("tournament.start", { voice_line: "voice" }) }));
    expect(d.play?.voice).toBe("voice");
    expect(d.zone.playing?.until_ms).toBe(T + d.lead_ms + 2000 + 1500);
    expect(d.count).toBe(true);
  });
});

describe("never the same twice running", () => {
  it("a cue with several sounds never repeats one twice running on a zone", () => {
    const c = cue("announce.attention", { sounds: ["a", "b", "c"] });
    let zone = EMPTY_ZONE;
    const picked: string[] = [];
    // Random values that would pick the same sound again every time without the rule.
    for (let i = 0; i < 30; i++) {
      const d = decide(
        input({ cue: c, zone, key: `k${String(i)}`, now: T + i * 60_000, random: () => 0.01 }),
      );
      zone = d.zone;
      picked.push(d.play?.sound ?? "");
    }
    for (let i = 1; i < picked.length; i++) expect(picked[i]).not.toBe(picked[i - 1]);
  });

  it("pickNotLast picks among the rest, and the only one when there is one", () => {
    expect(pickNotLast(["a", "b", "c"], "a", () => 0)).toBe("b");
    expect(pickNotLast(["a", "b", "c"], "a", () => 0.99)).toBe("c");
    expect(pickNotLast(["a"], "a", () => 0.5)).toBe("a");
    expect(pickNotLast([], null, () => 0.5)).toBeNull();
  });
});

describe("catch-up", () => {
  it("a played sound may start late within its cue's window (2 min by default)", () => {
    const d = decide(input({ cue: cue("announce.attention") }));
    expect(Date.parse(d.play?.catch_up_until ?? "")).toBe(T + d.lead_ms + 120_000);
  });

  it("the tournament cues keep the legacy windows before the start", () => {
    const start = T + 10 * 60_000;
    const d = decide(
      input({ cue: cue("tournament.pre"), starts_at: new Date(start).toISOString() }),
    );
    expect(Date.parse(d.play?.catch_up_until ?? "")).toBe(start - 2 * 60_000);
    // Outside its window it does not sound at all.
    const late = decide(
      input({
        cue: cue("tournament.pre"),
        starts_at: new Date(T + 60_000).toISOString(),
      }),
    );
    expect(late.reason).toBe("outside_window");
  });
});

describe("a burst of 50 triggers in a minute (E14)", () => {
  it("stays within 3 sounds a minute and logs a reason for every one", () => {
    const c = cue("pizza.placed", { sounds: ["a", "b"] });
    let zone = EMPTY_ZONE;
    let minute = 0;
    const reasons: string[] = [];
    let played = 0;
    for (let i = 0; i < 50; i++) {
      const now = T + i * 1200;
      const p = pump(zone, now, DEFAULT_SOUND_SETTINGS, false);
      zone = p.zone;
      for (const q of p.done) {
        reasons.push(q.reason);
        if (q.outcome === "played") played += 1;
      }
      const d = decide(
        input({
          cue: c,
          zone,
          now,
          key: `o${String(i)}`,
          source: `o${String(i)}`,
          counts: { ...NONE, minute },
        }),
      );
      zone = d.zone;
      if (d.count) minute += 1;
      if (d.outcome === "played") played += 1;
      if (d.outcome !== "queued") reasons.push(d.reason);
    }
    expect(minute).toBeLessThanOrEqual(3);
    expect(played).toBeLessThanOrEqual(3);
    expect(reasons.filter((r) => r === "flood_minute").length).toBeGreaterThan(30);
    expect(reasons.every((r) => r.length > 0)).toBe(true);
  });
});
