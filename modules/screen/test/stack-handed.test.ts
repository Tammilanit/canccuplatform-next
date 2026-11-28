import { afterEach, describe, expect, it, vi } from "vitest";
import {
  withComingHours,
  withHeroShowcase,
  withPhoto,
  withShowcase,
  withSmallShowcase,
} from "./stack/handed.mjs";

const region = (id: string, widgets: string[], order: number[]) => ({
  id,
  rotation: "sequence",
  order,
  claim: null as { template: string } | null,
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

describe("withShowcase", () => {
  it("holds the rail on the countdown the player would draw: only `empty: true` is empty", () => {
    const s = dashboard();
    // A view the player does not take as empty (hero-rail.ts, `w.view.empty !== true`).
    const rail = s.regions[1];
    if (rail?.widgets[0] !== undefined) Object.assign(rail.widgets[0].view, { empty: "no" });
    expect(withShowcase(s).regions.find((r) => r.id === "rail")?.order).toEqual([0]);
  });

  it("fails on a rail without a countdown", () => {
    const s = { regions: [region("hero", ["playlist"], [0]), region("rail", ["agenda_now"], [0])] };
    expect(() => withShowcase(s)).toThrow(/countdown/);
  });
});

describe("withHeroShowcase", () => {
  it("puts the announcement in the hero by its role, wherever the layout places it (#546)", () => {
    const s = { regions: [{ ...region("main", ["clock"], [0]), role: "hero" }, { ...region("rail", ["agenda_now"], [0]), role: "rail" }] }; // prettier-ignore
    const [hero, rail] = withHeroShowcase(s).regions;
    expect(hero?.claim?.template).toBe("announcement");
    expect(hero?.order).toEqual([0]);
    expect(rail).toBe(s.regions[1]);
  });
});

describe("withPhoto", () => {
  // The demo stack's Moments presets put their storyboards' title cards on the hero now and then:
  // left in the handed state, one hid the wall until its step ended, past the shot's wait (#742).
  const pulse = () => ({
    regions: [
      { ...region("hero", ["countdown"], [0]), role: "hero", idle_view: { widget: "countdown", view: {} }, claim: { template: "title_card" } },
      { ...region("rail", ["agenda_now"], [0]), role: "rail", claim: { template: "announcement" } },
    ],
  }); // prettier-ignore

  it("gives the hero to the wall, without a claim from the server over it", () => {
    for (const featured of [false, true]) {
      const hero = withPhoto(pulse(), featured).regions[0];
      expect(hero?.widgets[0]?.widget).toBe("photo");
      expect(hero?.claim).toBeNull();
    }
  });

  it("leaves the other boxes as they are", () => {
    const before = pulse();
    expect(withPhoto(before).regions[1]).toBe(before.regions[1]);
  });
});

describe("withComingHours", () => {
  afterEach(() => vi.useRealTimers());
  const pulse = () => ({
    tenant: { time_zone: "UTC" },
    zone: { key: "main" },
    regions: [
      { ...region("hero", ["countdown", "agenda_timeline"], [0]), role: "hero", area: { columns: 12 } },
      { ...region("rail", ["agenda_now"], [0]), role: "rail" },
    ],
  }); // prettier-ignore

  // Late at night the server's own line is empty and out of the order (the reason for the view).
  it.each(["2026-03-14T18:05:00Z", "2026-03-14T23:50:00Z", "2026-03-15T00:20:00Z"])(
    "holds the hero on a line with blocks at %s",
    (now) => {
      vi.useFakeTimers({ now: Date.parse(now) });
      const hero = withComingHours(pulse()).regions.find((r) => r.id === "hero");
      const shown = hero?.widgets[hero.order[0] ?? -1];
      expect(hero?.order).toHaveLength(1);
      expect(hero?.claim).toBeNull();
      expect(shown?.widget).toBe("agenda_timeline");
      expect(shown?.view).toMatchObject({ empty: false });
      expect((shown?.view as { items: unknown[] }).items.length).toBeGreaterThan(1);
    },
  );

  it("draws the line for the hero's width: a narrow hero holds fewer hours", () => {
    vi.useFakeTimers({ now: Date.parse("2026-03-14T15:05:00Z") });
    const hoursAt = (columns: number) => {
      const s = pulse();
      s.regions[0] = { ...s.regions[0], area: { columns } } as (typeof s.regions)[0];
      const hero = withComingHours(s).regions[0];
      return (hero?.widgets.at(-1)?.view as { hours: number }).hours;
    };
    expect(hoursAt(4)).toBeLessThan(hoursAt(12));
  });

  it("leaves the other boxes as they are", () => {
    const before = pulse();
    expect(withComingHours(before).regions[1]).toBe(before.regions[1]);
  });
});
