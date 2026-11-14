import { describe, expect, it } from "vitest";
import { baseLevel, eventMotion, levelOf, phaseAt, zoneMotion } from "../src/compose/motion.js";
import type { LevelInputs, MotionLevel } from "../src/compose/motion.js";
import type { AgendaItem } from "../src/compose/widgets.js";

const T = (hhmm: string): number => Date.parse(`2026-01-01T${hhmm}:00Z`);
const item = (kind: string, from: string, to: string | null): AgendaItem => ({
  id: `${kind}-${from}`,
  title: kind,
  kind,
  starts_at: `2026-01-01T${from}:00Z`,
  ends_at: to === null ? null : `2026-01-01T${to}:00Z`,
  delay_minutes: 0,
  location: null,
  visibility: "public",
});
const inputs = (over: Partial<LevelInputs> = {}): LevelInputs => ({
  eventLevel: "lively",
  followTheDay: true,
  pin: null,
  themeMotion: "moderate",
  ...over,
});

describe("the day's phase", () => {
  const day = [
    item("doors", "10:00", null),
    item("tournament", "14:00", "16:00"),
    item("ceremony", "20:00", null),
    item("quiet_hours", "23:00", "23:59"),
  ];
  it("follows the agenda's starter kinds, the first that holds winning", () => {
    expect(phaseAt(day, T("09:00"))).toBe("build_up");
    expect(phaseAt(day, T("10:30"))).toBe("doors");
    // Doors without an end count for 60 minutes.
    expect(phaseAt(day, T("11:00"))).toBe("build_up");
    expect(phaseAt(day, T("15:00"))).toBe("peak");
    expect(phaseAt(day, T("20:59"))).toBe("peak");
    expect(phaseAt(day, T("21:00"))).toBe("build_up");
    expect(phaseAt(day, T("22:00"))).toBe("wind_down");
    expect(phaseAt(day, T("23:30"))).toBe("quiet_hours");
  });
  it("puts quiet hours and the wind-down before doors and peaks", () => {
    const overlap = [item("tournament", "21:00", "23:30"), item("quiet_hours", "22:30", "23:59")];
    expect(phaseAt(overlap, T("22:00"))).toBe("wind_down");
    expect(phaseAt(overlap, T("23:00"))).toBe("quiet_hours");
  });
  it("never runs quiet hours without an end, as the rail has it", () => {
    expect(phaseAt([item("quiet_hours", "10:00", null)], T("10:30"))).toBe("build_up");
  });
});

describe("the level", () => {
  const levels: MotionLevel[] = ["none", "calm", "lively", "party"];
  it("moves the base one step with Follow the day: calmer at doors and wind-down, livelier at peak", () => {
    const moved = (phase: Parameters<typeof baseLevel>[1]) =>
      levels.map((l) => baseLevel(inputs({ eventLevel: l }), phase));
    expect(moved("doors")).toEqual(["none", "calm", "calm", "lively"]);
    expect(moved("wind_down")).toEqual(["none", "calm", "calm", "lively"]);
    expect(moved("peak")).toEqual(["none", "lively", "party", "party"]);
    expect(moved("build_up")).toEqual(levels);
  });
  it("keeps the base without Follow the day, and a pin all day", () => {
    expect(baseLevel(inputs({ followTheDay: false }), "peak")).toBe("lively");
    expect(baseLevel(inputs({ pin: "calm" }), "peak")).toBe("calm");
  });
  it("is capped by quiet hours and the theme, never raised", () => {
    expect(levelOf(inputs({ eventLevel: "party" }), "quiet_hours")).toBe("calm");
    expect(levelOf(inputs({ pin: "party" }), "quiet_hours")).toBe("calm");
    expect(levelOf(inputs({ eventLevel: "none" }), "quiet_hours")).toBe("none");
    expect(levelOf(inputs({ themeMotion: "calm" }), "peak")).toBe("calm");
    expect(levelOf(inputs({ themeMotion: "none", pin: "party" }), "peak")).toBe("none");
  });
});

describe("the next change", () => {
  it("names the next change of the level within 24 hours, skipping phase changes that keep it", () => {
    const day = [item("doors", "10:00", "11:00"), item("ceremony", "21:00", "22:00")];
    // Doors take lively one step down; after them build-up gives lively again.
    expect(zoneMotion(inputs(), day, T("09:00"))).toEqual({
      level: "lively",
      phase: "build_up",
      next: { level: "calm", phase: "doors", at: T("10:00") },
    });
    expect(zoneMotion(inputs(), day, T("12:00")).next).toEqual({
      level: "party",
      phase: "peak",
      at: T("21:00"),
    });
    expect(zoneMotion(inputs({ pin: "lively" }), day, T("09:00")).next).toBeNull();
  });
  it("finds the wind-down an hour before quiet hours", () => {
    const day = [item("quiet_hours", "23:00", "23:59")];
    expect(zoneMotion(inputs(), day, T("20:00")).next).toEqual({
      level: "calm",
      phase: "wind_down",
      at: T("22:00"),
    });
  });
});

describe("the event's settings", () => {
  it("reads motion_level and follow_the_day with their defaults", () => {
    const get = (v: Record<string, unknown>) => ({
      get: (k: string, f: unknown) => v[k] ?? f,
    });
    expect(eventMotion(get({}))).toEqual({ eventLevel: "lively", followTheDay: true });
    expect(eventMotion(get({ motion_level: "calm", follow_the_day: false }))).toEqual({
      eventLevel: "calm",
      followTheDay: false,
    });
  });
});
