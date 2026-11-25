import { describe, expect, it } from "vitest";
import { buildRegions } from "../src/compose/build.js";
import type { BuildInput, RegionView } from "../src/compose/build.js";
import type { FoodOrder } from "../src/compose/food.js";
import { BUILT_IN_LAYOUTS } from "../src/compose/layouts.js";
import { viewOf } from "../src/compose/widgets.js";
import type { AgendaItem, ZoneFacts } from "../src/compose/widgets.js";
import { zoneInput } from "../src/zone-input.js";

// A living screen, part A (issue #787, docs/plans/issue-787.md D1–D4): the idle rotation's items,
// the organiser's order and switches, 45 s turns, and the hero items' view-models.
const NOW = Date.parse("2026-03-14T18:10:00Z");

const item = (id: string, title: string, starts: string, ends: string | null, over = {}) =>
  ({
    id,
    title,
    kind: "tournament",
    starts_at: starts,
    ends_at: ends,
    delay_minutes: 0,
    location: "Main stage",
    visibility: "public",
    status: "scheduled",
    zone: null,
    ...over,
  }) as AgendaItem;

const order = (over: Partial<FoodOrder> = {}): FoodOrder => ({
  id: "po_1",
  seq: 3,
  state: "open",
  pizzeria_name: "Demo Pizzeria",
  target_at: "2026-03-14T18:30:00Z",
  closes_at: "2026-03-14T18:30:00Z",
  estimate_at: null,
  pickup: null,
  holder_name: null,
  pizza_count: 9,
  people_count: 6,
  placed_at: null,
  arrived_at: null,
  ...over,
});

function facts(over: Partial<ZoneFacts> = {}): ZoneFacts {
  return {
    now: new Date(NOW),
    timeZone: "UTC",
    origin: "https://demo.example",
    eventName: "Demo Event",
    logoUrl: null,
    agenda: { current: [], next: [] },
    venue: null,
    ticker: { text: null, until: null, source: null },
    ...over,
  };
}

const input = (regions: Record<string, Record<string, unknown>> = {}): BuildInput => ({
  zone: { key: "main", layoutId: null, regions },
  windowLayoutId: null,
  themeLayouts: [],
  portrait: false,
  facts: facts(),
});

const hero = (regions: Record<string, Record<string, unknown>> = {}): RegionView => {
  const found = buildRegions(input(regions)).regions.find((r) => r.id === "hero");
  if (found === undefined) throw new Error("no hero");
  return found;
};

describe("the idle rotation's items (D1, D4)", () => {
  const PO_ITEMS = [
    "countdown",
    "agenda_timeline",
    "food_status",
    "leaderboard",
    "now_playing",
    "photo",
    "playlist",
    "stats",
  ];

  it("gives every built-in hero the PO's items in the PO's order", () => {
    for (const id of ["pulse", "dashboard", "hero", "split", "pulse_portrait"]) {
      const layout = BUILT_IN_LAYOUTS.find((l) => l.id === id);
      const region = layout?.regions.find((r) => r.id === "hero");
      expect(
        region?.widgets.map((w) => w.widget),
        id,
      ).toEqual(PO_ITEMS);
      expect(region?.rotate_seconds, id).toBe(45);
    }
  });

  it("turns every 45 s on a built-in hero, unless the zone sets its own time", () => {
    expect(hero().widgets.every((w) => w.dwell_seconds === 45)).toBe(true);
    expect(hero({ hero: { dwell_seconds: 30 } }).widgets.every((w) => w.dwell_seconds === 30)).toBe(
      true,
    );
  });

  it("plays the built-in items that have something in the PO's order, skipping the empty ones", () => {
    const f = facts({
      agenda: { current: [], next: [item("a1", "Semi-finals", "2026-03-14T19:30:00Z", null)] },
      timeline: [item("a1", "Semi-finals", "2026-03-14T19:30:00Z", "2026-03-14T21:00:00Z")],
      food: { orders: [order()], names: false },
      stats: { members: 40, online: 12, in_voice: 3 },
    });
    const region = buildRegions({ ...input(), facts: f }).regions.find((r) => r.id === "hero");
    const types = region?.order.map((i) => region.widgets[i]?.widget);
    expect(types).toEqual(["countdown", "agenda_timeline", "food_status", "stats"]);
  });
});

describe("the organiser's order and switches (D3)", () => {
  const own = [
    { widget: "stats" },
    { widget: "countdown" },
    { widget: "ticker", enabled: false },
    { widget: "clock" },
  ];
  const f = facts({
    agenda: { current: [], next: [item("a1", "Semi-finals", "2026-03-14T19:30:00Z", null)] },
    stats: { members: 40, online: 12, in_voice: 3 },
    ticker: { text: "Welcome", until: null, source: null },
  });

  it("plays the zone's own hero list in the zone's order, not the Director's type order", () => {
    const region = buildRegions({ ...input({ hero: { widgets: own } }), facts: f }).regions.find(
      (r) => r.id === "hero",
    );
    expect(region?.rotation).toBe("director");
    expect(region?.order.map((i) => region.widgets[i]?.widget)).toEqual([
      "stats",
      "countdown",
      "clock",
    ]);
  });

  it("keeps a switched-off item in its place, skipped as an empty one is", () => {
    const region = buildRegions({ ...input({ hero: { widgets: own } }), facts: f }).regions.find(
      (r) => r.id === "hero",
    );
    expect(region?.widgets.map((w) => w.widget)).toEqual(["stats", "countdown", "ticker", "clock"]);
    expect(region?.widgets[2]?.enabled).toBe(false);
    expect(region?.order).not.toContain(2);
  });

  it("takes `enabled` as a widget setting and refuses anything but true or false", () => {
    const zone = (widgets: unknown[]) => ({
      key: "main",
      name: "Main",
      regions: { hero: { widgets } },
    });
    expect(zoneInput(zone([{ widget: "stats", enabled: false }])).regions.hero).toEqual({
      widgets: [{ widget: "stats", enabled: false }],
    });
    expect(() => zoneInput(zone([{ widget: "stats", enabled: "no" }]))).toThrow(/enabled/);
  });
});

describe("the coming hours (`agenda_timeline`)", () => {
  const day = [
    item("a0", "Dinner", "2026-03-14T17:30:00Z", "2026-03-14T18:30:00Z", { kind: "food" }),
    item("a1", "Semi-finals", "2026-03-14T19:30:00Z", "2026-03-14T21:00:00Z"),
    item("a2", "Crew meeting", "2026-03-14T19:00:00Z", "2026-03-14T19:15:00Z", {
      visibility: "crew",
    }),
    item("a3", "Other hall", "2026-03-14T19:00:00Z", "2026-03-14T20:00:00Z", { zone: "side" }),
    item("a4", "Breakfast", "2026-03-15T07:00:00Z", "2026-03-15T08:00:00Z"),
    item("a5", "Lunch", "2026-03-14T12:00:00Z", "2026-03-14T13:00:00Z"),
  ];

  it("shows the next three hours with what runs and starts in them, public and of this zone", () => {
    const view = viewOf("agenda_timeline", {}, facts({ timeline: day, zoneKey: "main" }));
    expect(view.empty).toBe(false);
    expect(view.from).toBe("2026-03-14T18:00:00.000Z");
    expect(view.to).toBe("2026-03-14T21:00:00.000Z");
    expect(view.now).toBe("2026-03-14T18:10:00.000Z");
    expect((view.items as { name: string }[]).map((i) => i.name)).toEqual([
      "Dinner",
      "Semi-finals",
    ]);
    expect((view.items as Record<string, unknown>[])[1]).toMatchObject({
      name: "Semi-finals",
      kind: "tournament",
      starts_at: "2026-03-14T19:30:00Z",
      ends_at: "2026-03-14T21:00:00Z",
      place: "Main stage",
      starts_text: "19:30",
    });
  });

  it("marks an open food order's close on the line", () => {
    const view = viewOf(
      "agenda_timeline",
      {},
      facts({ timeline: day, food: { orders: [order()], names: false } }),
    );
    expect(view.marks).toEqual([
      { label: "Pizza order closes", at: "2026-03-14T18:30:00Z", at_text: "18:30" },
    ]);
  });

  it("is empty when nothing runs or starts in the coming hours", () => {
    expect(viewOf("agenda_timeline", {}, facts({ timeline: [day[4] as AgendaItem] })).empty).toBe(
      true,
    );
    expect(viewOf("agenda_timeline", {}, facts()).empty).toBe(true);
  });
});

describe("the food item in the hero (D1, D9)", () => {
  it("gives an open order its join link and QR, and the first order's time to count down to", () => {
    const view = viewOf("food_status", {}, facts({ food: { orders: [order()], names: false } }));
    expect((view.orders as Record<string, unknown>[])[0]?.join_url).toBe(
      "https://demo.example/pizza/orders/po_1",
    );
    expect(view.join).toMatchObject({
      url: "https://demo.example/pizza/orders/po_1",
      label: "Join the order",
    });
    expect(String((view.join as { image_url: string }).image_url)).toMatch(/^data:image\/svg/);
    expect(view.countdown_at).toBe("2026-03-14T18:30:00Z");
  });

  it("counts down to the estimate once called in, with no join link", () => {
    const placed = order({
      state: "placed",
      placed_at: "2026-03-14T18:00:00Z",
      estimate_at: "2026-03-14T18:45:00Z",
    });
    const view = viewOf("food_status", {}, facts({ food: { orders: [placed], names: false } }));
    expect((view.orders as Record<string, unknown>[])[0]?.join_url).toBeNull();
    expect(view.join).toBeNull();
    expect(view.countdown_at).toBe("2026-03-14T18:45:00Z");
  });
});
