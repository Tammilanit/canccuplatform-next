import { describe, expect, it } from "vitest";
import { withSmallShowcase } from "./stack/handed.mjs";

const region = (id: string, widgets: string[], order: number[]) => ({
  id,
  rotation: "sequence",
  order,
  claim: null,
  widgets: widgets.map((widget) => ({ widget, dwell_seconds: 15, view: {} })),
});

const dashboard = () => ({
  regions: [
    region("hero", ["playlist", "countdown"], [0, 1]),
    region("rail", ["countdown", "agenda_now"], [0, 1]),
    region("right_now", ["stats"], [0]),
  ],
});

describe("withSmallShowcase", () => {
  it("puts the announcement in the hero", () => {
    const hero = withSmallShowcase(dashboard()).regions.find((r) => r.id === "hero");
    expect(hero?.claim?.template).toBe("announcement");
  });

  it("holds the rail on its run of show, so no turn crossfades it during the shot (#532)", () => {
    const rail = withSmallShowcase(dashboard()).regions.find((r) => r.id === "rail");
    expect(rail?.order).toEqual([1]);
    expect(rail?.widgets).toHaveLength(2);
  });

  it("leaves the other boxes as they are", () => {
    const before = dashboard();
    const after = withSmallShowcase(before);
    expect(after.regions.find((r) => r.id === "right_now")).toBe(before.regions[2]);
  });

  it("fails on a rail without a run of show", () => {
    const s = { regions: [region("hero", ["playlist"], [0]), region("rail", ["countdown"], [0])] };
    expect(() => withSmallShowcase(s)).toThrow(/run of show/);
  });
});
