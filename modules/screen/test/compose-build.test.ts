import { describe, expect, it } from "vitest";
import { buildRegions } from "../src/compose/build.js";
import type { BuildInput } from "../src/compose/build.js";
import { chooseLayout, roleOf, themeLayouts } from "../src/compose/layouts.js";
import { zoneFingerprint } from "../src/compose/state.js";
import type { FingerprintInput } from "../src/compose/state.js";
import type { Layout } from "../src/compose/layouts.js";
import { viewOf } from "../src/compose/widgets.js";
import type { AgendaItem, ZoneFacts } from "../src/compose/widgets.js";

const NOW = new Date("2026-01-01T12:00:07Z");

const item = (id: string, starts: string, extra: Partial<AgendaItem> = {}): AgendaItem => ({
  id,
  title: `Item ${id}`,
  kind: "other",
  starts_at: starts,
  ends_at: null,
  delay_minutes: 0,
  location: null,
  visibility: "public",
  ...extra,
});

function facts(over: Partial<ZoneFacts> = {}): ZoneFacts {
  return {
    now: NOW,
    timeZone: "Europe/Helsinki",
    origin: "https://demo.example",
    eventName: "Demo Event",
    logoUrl: null,
    agenda: { current: [], next: [] },
    venue: null,
    ticker: { text: null, until: null, source: null },
    ...over,
  };
}

function input(over: Partial<BuildInput> = {}): BuildInput {
  return {
    zone: { key: "main", regions: {}, layoutId: null },
    windowLayoutId: null,
    themeLayouts: [],
    portrait: false,
    facts: facts(),
    ...over,
  };
}

const themeLayout = (id: string): Layout => ({
  id,
  name: id,
  aspect: "16:9",
  grid: { columns: 2, rows: 1 },
  regions: [
    {
      id: "main",
      area: { column: 1, row: 1, columns: 2, rows: 1 },
      widgets: [{ widget: "clock" }],
    },
  ],
});

describe("layout choice", () => {
  const pick = (windowLayoutId: string | null, zoneLayoutId: string | null, portrait = false) =>
    chooseLayout({ windowLayoutId, zoneLayoutId, themeLayouts: [themeLayout("stage")], portrait })
      .id;

  it("takes the window's layout, then the zone's, then the orientation's built-in", () => {
    expect(pick("stage", "pulse")).toBe("stage");
    expect(pick(null, "stage")).toBe("stage");
    expect(pick(null, null)).toBe("pulse");
    expect(pick(null, null, true)).toBe("pulse_portrait");
  });

  it("skips an id neither the theme nor the built-ins have", () => {
    expect(pick("gone", "stage")).toBe("stage");
    expect(pick("gone", "also-gone")).toBe("pulse");
    expect(pick("gone", null, true)).toBe("pulse_portrait");
  });

  it("lets a theme layout with a built-in id replace the built-in", () => {
    const own = { ...themeLayout("pulse"), name: "Own pulse" };
    expect(
      chooseLayout({
        windowLayoutId: null,
        zoneLayoutId: "pulse",
        themeLayouts: [own],
        portrait: false,
      }).name,
    ).toBe("Own pulse");
  });
});

describe("region roles", () => {
  it("reads the zone's setting, then the id, then the aliases", () => {
    expect(roleOf("stage", "hero")).toBe("hero");
    expect(roleOf("rail", undefined)).toBe("rail");
    expect(roleOf("main", undefined)).toBe("hero");
    expect(roleOf("side", undefined)).toBe("rail");
    expect(roleOf("misc", undefined)).toBeNull();
  });

  it("never gives a layout region `full` or `overlay`", () => {
    expect(roleOf("full", undefined)).toBeNull();
    expect(roleOf("overlay", undefined)).toBeNull();
    expect(roleOf("hero", "full")).toBeNull();
  });
});

describe("the builder", () => {
  it("draws the built-in pulse with the synthetic regions on top", () => {
    const { layout, regions } = buildRegions(input());
    expect(layout.id).toBe("pulse");
    expect(regions.map((r) => [r.id, r.role, r.layer])).toEqual([
      ["header", "header", 0],
      ["header-2", "header", 0],
      ["hero", "hero", 0],
      ["rail", "rail", 0],
      ["venue_rail", "venue_rail", 0],
      ["venue_rail-2", null, 0],
      ["ticker", "ticker", 1],
      ["_full", "full", 10],
      ["_overlay", "overlay", 11],
    ]);
    expect(regions.find((r) => r.id === "_full")?.area).toEqual({
      column: 1,
      row: 1,
      columns: 12,
      rows: 12,
    });
  });

  it("puts no check-in QR on a built-in layout: check-in is the zone's choice", () => {
    const widgets = buildRegions(input()).regions.flatMap((r) => r.widgets.map((w) => w.widget));
    expect(widgets).not.toContain("checkin_qr");
  });

  it("skips empty widgets in the rotation and rotates on the server clock", () => {
    const agenda = {
      current: [item("a", "2026-01-01T11:00:00Z")],
      next: [item("b", "2026-01-01T13:00:00Z")],
    };
    const rail = buildRegions(input({ facts: facts({ agenda }) })).regions.find(
      (r) => r.id === "rail",
    );
    expect(rail?.order).toEqual([0, 1]);
    expect(rail?.widgets.map((w) => w.dwell_seconds)).toEqual([15, 15]);
    // A 30-second cycle, anchored on the epoch, so every screen of the zone agrees.
    expect(rail?.cycle_started_at).toBe("2026-01-01T12:00:00.000Z");
    const hero = buildRegions(input()).regions.find((r) => r.id === "hero");
    expect(hero?.order).toEqual([]);
  });

  it("keeps empty widgets when the zone says so, and takes the zone's dwell", () => {
    const zone = {
      key: "main",
      layoutId: null,
      regions: { hero: { skip_empty: false, dwell_seconds: 20 } },
    };
    const hero = buildRegions(input({ zone })).regions.find((r) => r.id === "hero");
    // The Director's order (sheet 13): bracket, highlight, playlist, photo, hot game, the day.
    expect(hero?.order).toEqual([2, 4, 0, 3, 1, 5]);
    expect(hero?.widgets.every((w) => w.dwell_seconds === 20)).toBe(true);
  });

  it("shuffles the same way for every screen of a zone within a cycle", () => {
    const zone = {
      key: "main",
      layoutId: null,
      regions: {
        hero: {
          rotation: "shuffle",
          skip_empty: false,
          widgets: [1, 2, 3, 4, 5].map(() => ({ widget: "clock" })),
        },
      },
    };
    const a = buildRegions(input({ zone })).regions.find((r) => r.id === "hero");
    const b = buildRegions(input({ zone })).regions.find((r) => r.id === "hero");
    expect(a?.rotation).toBe("shuffle");
    expect(a?.order).toEqual(b?.order);
    expect([...(a?.order ?? [])].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("shows the next public item with a countdown in an idle `next` hero", () => {
    const zone = { key: "main", layoutId: null, regions: { hero: { idle: "next" } } };
    const agenda = {
      current: [],
      next: [
        item("crew", "2026-01-01T12:30:00Z", { visibility: "crew" }),
        item("din", "2026-01-01T13:00:00Z"),
      ],
    };
    const hero = buildRegions(input({ zone, facts: facts({ agenda }) })).regions.find(
      (r) => r.id === "hero",
    );
    expect(hero?.idle).toBe("next");
    expect(hero?.idle_view).toEqual({
      widget: "countdown",
      view: {
        label: "Item din",
        target_at: "2026-01-01T13:00:00Z",
        ends_text: null,
        kind: "other",
        description: null,
        game: null,
        chip: null,
        qr: null,
        stale: false,
        empty: false,
      },
    });
  });

  it("leaves `idle_view` null without a next item, and for every other idle", () => {
    const zone = { key: "main", layoutId: null, regions: { hero: { idle: "next" } } };
    expect(
      buildRegions(input({ zone })).regions.find((r) => r.id === "hero")?.idle_view,
    ).toBeNull();
    const plain = buildRegions(input()).regions.find((r) => r.id === "hero");
    expect(plain?.idle).toBe("logo");
    expect(plain?.idle_view).toBeNull();
  });
});

describe("view-models", () => {
  it("empties and marks stale the widgets whose source is down", () => {
    const view = viewOf("agenda_now", {}, facts({ agenda: null }));
    expect(view).toMatchObject({ empty: true, stale: true, qr: null });
  });

  it("answers `empty` for the types whose source is not built yet", () => {
    for (const type of [
      "playlist",
      "photo",
      "checkin_qr",
      "embed",
      "hot_game",
      "bracket",
      "leaderboard",
      "food_status",
      "stats",
      "now_playing",
    ]) {
      expect(viewOf(type, {}, facts()).empty).toBe(true);
    }
  });

  it("draws the clock in the event's time zone", () => {
    expect(viewOf("clock", {}, facts())).toMatchObject({
      time: "14:00",
      date: "Thu 1 Jan",
      empty: false,
    });
  });

  it("gives the venue's public Wi-Fi only, with the hub QR when asked", () => {
    const venue = {
      wifi: [
        { ssid: "Guests", password: "welcome", note: null, visibility: "public" },
        { ssid: "Crew", password: "secret", note: null, visibility: "crew" },
      ],
      floor_plan: null,
    };
    const view = viewOf("venue_info", { qr: "auto" }, facts({ venue }));
    expect(view.wifi).toEqual([{ ssid: "Guests", password: "welcome", note: null }]);
    expect(view.qr).toMatchObject({ url: "https://demo.example/notify/", label: "Venue info" });
    expect((view.qr as { image_url: string }).image_url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("makes a `qr` only for a path on the event's hostname", () => {
    expect(viewOf("qr", { url: "/notify/", label: "Hub" }, facts())).toMatchObject({
      url: "https://demo.example/notify/",
      empty: false,
    });
    expect(viewOf("qr", { url: "https://elsewhere.example/" }, facts()).empty).toBe(true);
    expect(viewOf("qr", { url: "//elsewhere.example/" }, facts()).empty).toBe(true);
  });

  it("marks delayed items and keeps crew items off the screen", () => {
    const agenda = {
      current: [item("a", "2026-01-01T11:00:00Z", { delay_minutes: 15 })],
      next: [item("c", "2026-01-01T13:00:00Z", { visibility: "crew" })],
    };
    const view = viewOf("agenda_now", {}, facts({ agenda }));
    expect((view.items as { id: string; state: string }[]).map((i) => [i.id, i.state])).toEqual([
      ["a", "delayed"],
    ]);
  });
});

describe("review fixes", () => {
  it("keeps the hub QR in the venue rail's rotation when the venue has nothing to show", () => {
    const zone = { key: "main", layoutId: null, regions: {}, hubQr: "rotate" as const };
    const rail = buildRegions(input({ zone, facts: facts({ venue: null }) })).regions.find(
      (r) => r.id === "venue_rail",
    );
    const shown = (rail?.order ?? []).map((i) => rail?.widgets[i]);
    expect(shown.map((w) => w?.widget)).toEqual(["qr"]);
    expect(shown[0]?.view).toMatchObject({ url: "https://demo.example/notify/", empty: false });
  });

  it("drops theme layout regions without widgets or an area", () => {
    const broken = {
      ...themeLayout("stage"),
      regions: [{ id: "main" }, ...themeLayout("stage").regions],
    };
    expect(themeLayouts([broken])[0]?.regions.map((r) => r.id)).toEqual(["main"]);
    expect(themeLayouts([broken])[0]?.regions).toHaveLength(1);
  });

  const print = (over: Partial<FingerprintInput> = {}) =>
    zoneFingerprint({
      zone: {
        key: "main",
        name: "Main",
        layout_id: null,
        regions: { hero: { rotation: "shuffle" } },
        header: null,
        hub_qr: "always",
        hero_region: null,
        grow_for_showcase: true,
        sound: { enabled: true, device_id: null },
        epoch: "e1",
      },
      windowLayoutId: null,
      theme: { revision: 1, layouts: [] },
      facts: facts(),
      ...over,
    });

  it("leaves time, cycles and shuffles out of the fingerprint", () => {
    expect(print({ facts: facts({ now: new Date("2026-01-01T12:07:31Z") }) })).toBe(print());
  });

  it("changes the fingerprint with the sound device, the zone's name and the event's name", () => {
    const zone = {
      key: "main",
      name: "Main",
      layout_id: null,
      regions: {},
      header: null,
      hub_qr: "always" as const,
      hero_region: null,
      grow_for_showcase: true,
      sound: { enabled: true, device_id: null },
      epoch: "e1",
    };
    const base = print({ zone });
    expect(print({ zone: { ...zone, sound: { enabled: true, device_id: "dv_1" } } })).not.toBe(
      base,
    );
    expect(print({ zone: { ...zone, name: "Hall" } })).not.toBe(base);
    expect(print({ zone, facts: facts({ eventName: "Other" }) })).not.toBe(base);
  });
});
