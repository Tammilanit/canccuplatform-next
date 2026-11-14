import { describe, expect, it } from "vitest";
import type { RegionView } from "../src/compose/build.js";
import { diffZone } from "../src/push/diff.js";
import { NO_DISPLAY } from "../src/compose/display.js";
import type { ZoneRecord } from "../src/push/store.js";

const widget = (type: string, view: Record<string, unknown>) => ({
  widget: type,
  template: null,
  embed: null,
  dwell_seconds: 15,
  stale_after_seconds: null,
  view: { qr: null, stale: false, empty: false, ...view },
});

const region = (
  id: string,
  widgets: RegionView["widgets"],
  extra: Partial<RegionView> = {},
): RegionView => ({
  id,
  role: "rail",
  area: { column: 1, row: 1, columns: 1, rows: 1 },
  layer: 0,
  rotation: "sequence",
  order: widgets.map((_, i) => i),
  cycle_started_at: "2026-01-01T12:00:00.000Z",
  indicator: "line",
  idle: "logo",
  idle_view: null,
  widgets,
  claim: null,
  ...extra,
});

function record(over: Partial<ZoneRecord> = {}, regions?: RegionView[]): ZoneRecord {
  const rs = regions ?? [
    region("rail", [widget("clock", { iso: "a", time: "12:00", date: "1 Jan" })]),
    region("hero", [widget("agenda_now", { title: "Now", items: [] })], { role: "hero" }),
  ];
  return {
    version: 1,
    fingerprint: "f1",
    zone: { key: "main", name: "Main", epoch: "e1" },
    eventName: "Demo Event",
    theme: { revision: 1, tokens_css_url: "/t.css", css_url: null, logo_url: null, templates: [] },
    ticker: { text: null, until: null, source: null, appearance: "default" },
    sound: { enabled: false, device_id: null },
    display: NO_DISPLAY,
    views: {
      landscape: { layout: { id: "pulse" }, regions: rs },
      portrait: { layout: { id: "pulse_portrait" }, regions: rs },
    },
    ...over,
  };
}

describe("the push diff", () => {
  it("asks for a whole state without a state before, or when the zone itself changed", () => {
    const after = record();
    expect(diffZone(null, after, "landscape", 2)).toBeNull();
    for (const before of [
      record({ zone: { key: "main", name: "Main", epoch: "e0" } }),
      record({ zone: { key: "main", name: "Old name", epoch: "e1" } }),
      record({ eventName: "Old event" }),
      record({ sound: { enabled: true, device_id: "dv_1" } }),
      // Motion and drift reach screens as a whole state (contracts/screen.md).
      record({ display: { ...NO_DISPLAY, motion_level: "calm", motion: "calm" } }),
      record({ display: { ...NO_DISPLAY, drift: true } }),
      record({
        display: { ...NO_DISPLAY, motion_style: { ...NO_DISPLAY.motion_style, pack: "arcade" } },
      }),
      // A record stored before `display` existed.
      ((old: ZoneRecord) => {
        delete old.display;
        return old;
      })(record()),
    ]) {
      expect(diffZone(before, after, "landscape", 2)).toBeNull();
    }
  });

  it("asks for a whole state when the layout or its regions changed", () => {
    const before = record();
    const after = record();
    after.views.portrait = { layout: { id: "other" }, regions: after.views.portrait.regions };
    expect(diffZone(before, after, "portrait", 2)).toBeNull();
    // The landscape side is as it was: its screens only learn the new version.
    expect(diffZone(before, after, "landscape", 2)).toEqual([
      { event: "ticker", data: { state_version: 2, ticker: after.ticker } },
    ]);
    const fewer = record({}, [region("rail", [])]);
    expect(diffZone(before, fewer, "landscape", 2)).toBeNull();
  });

  it("sends the theme and the ticker on their own", () => {
    const before = record();
    const theme = { ...before.theme, revision: 2 };
    const ticker = { ...before.ticker, text: "Doors close at ten" };
    expect(diffZone(before, record({ theme, ticker }), "landscape", 7)).toEqual([
      { event: "theme", data: { state_version: 7, theme } },
      { event: "ticker", data: { state_version: 7, ticker } },
    ]);
  });

  it("sends one widget when only its view changed", () => {
    const before = record();
    const hero = region("hero", [widget("agenda_now", { title: "Now", items: [{ id: "x" }] })], {
      role: "hero",
    });
    const after = record({}, [before.views.landscape.regions[0] as RegionView, hero]);
    expect(diffZone(before, after, "landscape", 3)).toEqual([
      {
        event: "widget",
        data: { state_version: 3, region_id: "hero", index: 0, view: hero.widgets[0]?.view },
      },
    ]);
  });

  it("sends the whole region when its widgets or settings changed", () => {
    const before = record();
    const hero = region(
      "hero",
      [widget("agenda_now", { title: "Now", items: [] }), widget("logo", { url: "/l.png" })],
      { role: "hero" },
    );
    const after = record({}, [before.views.landscape.regions[0] as RegionView, hero]);
    expect(diffZone(before, after, "landscape", 4)).toEqual([
      { event: "region", data: { state_version: 4, region: hero } },
    ]);
  });

  it("leaves the clock's time, cycles and shuffles out: the screen runs them itself", () => {
    const before = record();
    const later = record({}, [
      region("rail", [widget("clock", { iso: "b", time: "12:05", date: "1 Jan" })], {
        cycle_started_at: "2026-01-01T12:05:00.000Z",
      }),
      region(
        "hero",
        [widget("agenda_now", { title: "Now", items: [] }), widget("logo", { url: "/l" })],
        { role: "hero", rotation: "shuffle", order: [1, 0] },
      ),
    ]);
    const shuffledBefore = record({}, [
      before.views.landscape.regions[0] as RegionView,
      region(
        "hero",
        [widget("agenda_now", { title: "Now", items: [] }), widget("logo", { url: "/l" })],
        { role: "hero", rotation: "shuffle", order: [0, 1] },
      ),
    ]);
    expect(diffZone(shuffledBefore, later, "landscape", 5)).toEqual([
      { event: "ticker", data: { state_version: 5, ticker: later.ticker } },
    ]);
  });

  it("sends a shuffled region when the widgets taking part change, so the screen cycles them", () => {
    const hero = (order: number[], items: unknown[]) =>
      region(
        "hero",
        [
          widget("agenda_now", { title: "Now", items, empty: items.length === 0 }),
          widget("logo", {}),
        ],
        { role: "hero", rotation: "shuffle", order },
      );
    const rail = record().views.landscape.regions[0] as RegionView;
    const before = record({}, [rail, hero([1], [])]);
    const after = record({}, [rail, hero([0, 1], [{ id: "x" }])]);
    expect(diffZone(before, after, "landscape", 6)).toEqual([
      { event: "region", data: { state_version: 6, region: after.views.landscape.regions[1] } },
    ]);
    expect(diffZone(after, before, "landscape", 7)?.[0]?.event).toBe("region");
  });

  it("sends a claim placed or ended as its region, and other unplaced or hidden claims as a state", () => {
    const claim = {
      override_id: "ov_10",
      hidden: false,
      role: "rail" as const,
      rank: 80,
      template: "announcement",
      content: { title: "Dinner is served" },
      steps: null,
      sound: null,
      on_end: "resume" as const,
      starts_at: "2026-01-01T12:00:00Z",
      ends_at: null,
      expires_at: null,
    };
    const [rail, hero] = record().views.landscape.regions as [RegionView, RegionView];
    const before = record();
    const after = record({}, [{ ...rail, claim }, hero]);
    expect(diffZone(before, after, "landscape", 3)).toEqual([
      { event: "region", data: { state_version: 3, region: { ...rail, claim } } },
    ]);
    const lists = (unplaced: string[], hidden: string[]) => {
      const r = record();
      r.views.landscape = { ...r.views.landscape, unplaced, hidden };
      return r;
    };
    expect(diffZone(before, lists(["ov_1"], []), "landscape", 4)).toBeNull();
    expect(diffZone(lists([], ["ov_1"]), before, "landscape", 4)).toBeNull();
    // A record stored before claims has none.
    expect(diffZone(before, lists([], []), "landscape", 4)?.[0]?.event).toBe("ticker");
  });
});
