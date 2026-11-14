import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOTION_STYLE,
  displayOf,
  motionStyleOf,
  phaseSource,
} from "../src/compose/display.js";
import type { AgendaItem } from "../src/compose/widgets.js";

const quiet = (over: Partial<AgendaItem> = {}): AgendaItem => ({
  id: "q1",
  title: "Quiet hours",
  kind: "quiet_hours",
  starts_at: "2026-01-01T22:00:00Z",
  ends_at: "2026-01-02T07:00:00Z",
  delay_minutes: 0,
  location: null,
  visibility: "public",
  ...over,
});

const settings = (values: Record<string, unknown> = {}) => ({
  get: (key: string, fallback: unknown) => values[key] ?? fallback,
});
const NOON = Date.parse("2026-01-01T12:00:00Z");
const NIGHT = Date.parse("2026-01-01T23:00:00Z");

const show = (over: Partial<Parameters<typeof displayOf>[0]> = {}) =>
  displayOf({ tokens: {}, items: [], pin: null, settings: settings(), at: NOON, ...over }).display;

describe("how a zone's screens move (display)", () => {
  it("is lively by default, with moderate for older players and the default motion style", () => {
    expect(show()).toEqual({
      motion_level: "lively",
      motion_style: DEFAULT_MOTION_STYLE,
      motion: "moderate",
      drift: false,
    });
  });

  it("takes the event's level, and the zone's pin over it", () => {
    expect(show({ settings: settings({ motion_level: "party" }) }).motion_level).toBe("party");
    expect(show({ settings: settings({ motion_level: "party" }), pin: "calm" }).motion_level).toBe(
      "calm",
    );
    expect(show({ settings: settings({ motion_level: "wild" }) }).motion_level).toBe("lively");
  });

  it("derives motion for older players: lively and party are moderate", () => {
    const motion = (level: string) => show({ settings: settings({ motion_level: level }) }).motion;
    expect(["none", "calm", "lively", "party"].map(motion)).toEqual([
      "none",
      "calm",
      "moderate",
      "moderate",
    ]);
  });

  it("caps the level by the theme's motion token", () => {
    const party = settings({ motion_level: "party" });
    expect(show({ settings: party, tokens: { motion: "calm" } }).motion_level).toBe("calm");
    expect(show({ settings: party, tokens: { motion: "none" } }).motion_level).toBe("none");
    expect(show({ settings: party, tokens: { motion: "wild" } }).motion_level).toBe("party");
  });

  it("is at most calm while a public quiet-hours item of the zone runs, also for a pin", () => {
    const items = phaseSource(null, { current: [quiet()], next: [] }, "main");
    expect(show({ items, at: NIGHT }).motion_level).toBe("calm");
    expect(show({ items, at: NIGHT, pin: "party" }).motion_level).toBe("calm");
    expect(show({ items, at: NIGHT, pin: "none" }).motion_level).toBe("none");
    const crewOnly = phaseSource(
      null,
      { current: [quiet({ visibility: "crew" })], next: [] },
      "main",
    );
    expect(show({ items: crewOnly, at: NIGHT }).motion_level).toBe("lively");
  });

  it("reads the phase from the whole agenda when held, kept to the zone's items", () => {
    const other = quiet({ zone: "stage" });
    expect(phaseSource([other, quiet({ id: "q2" })], null, "main").map((i) => i.id)).toEqual([
      "q2",
    ]);
    expect(phaseSource([quiet({ status: "cancelled" })], null, "main")).toEqual([]);
    expect(phaseSource(null, null, "main")).toEqual([]);
  });

  it("fills the motion style's defaults and ignores unknown values", () => {
    expect(motionStyleOf(undefined)).toEqual(DEFAULT_MOTION_STYLE);
    expect(motionStyleOf({ speed: "faster", pack: "arcade", intensity: "huge" })).toEqual({
      ...DEFAULT_MOTION_STYLE,
      speed: "faster",
      pack: "arcade",
    });
    expect(show({ tokens: { motion_style: { spotlight: "trace" } } }).motion_style.spotlight).toBe(
      "trace",
    );
  });

  it("drifts only when the event's burn_in_drift setting is true", () => {
    expect(show({ settings: settings({ burn_in_drift: true }) }).drift).toBe(true);
    expect(show({ settings: settings({ burn_in_drift: "yes" }) }).drift).toBe(false);
  });
});
