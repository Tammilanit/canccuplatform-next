import { describe, expect, it } from "vitest";
import type { RegionView } from "../src/compose/build.js";
import { diffZone } from "../src/push/diff.js";
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
    display: { motion: "moderate", drift: false },
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
      record({ display: { motion: "calm", drift: false } }),
      record({ display: { motion: "moderate", drift: true } }),
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
});
