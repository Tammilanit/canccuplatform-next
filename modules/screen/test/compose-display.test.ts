import { describe, expect, it } from "vitest";
import { displayOf } from "../src/compose/display.js";
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

describe("how a zone's screens move (display)", () => {
  it("takes the theme's motion, moderate when the theme sets none or an unknown value", () => {
    expect(displayOf({ motion: "calm" }, null, false).motion).toBe("calm");
    expect(displayOf({ motion: "none" }, null, false).motion).toBe("none");
    expect(displayOf({}, null, false).motion).toBe("moderate");
    expect(displayOf(undefined, null, false).motion).toBe("moderate");
    expect(displayOf({ motion: "wild" }, null, false).motion).toBe("moderate");
  });

  it("lowers motion to calm while a public quiet-hours item of the zone runs, and never raises it", () => {
    const running = { current: [quiet()], next: [] };
    expect(displayOf({ motion: "moderate" }, running, false).motion).toBe("calm");
    expect(displayOf({ motion: "none" }, running, false).motion).toBe("none");
    const crewOnly = { current: [quiet({ visibility: "crew" })], next: [] };
    expect(displayOf({}, crewOnly, false).motion).toBe("moderate");
    const upcoming = { current: [], next: [quiet()] };
    expect(displayOf({}, upcoming, false).motion).toBe("moderate");
  });

  it("drifts only when the event's burn_in_drift setting is true", () => {
    expect(displayOf({}, null, true).drift).toBe(true);
    expect(displayOf({}, null, false).drift).toBe(false);
    expect(displayOf({}, null, "yes").drift).toBe(false);
  });
});
