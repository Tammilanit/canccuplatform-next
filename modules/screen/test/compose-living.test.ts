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

  it("shows tonight from the hour to midnight, with what runs and starts then, public and of this zone", () => {
    const view = viewOf("agenda_timeline", {}, facts({ timeline: day, zoneKey: "main" }));
    expect(view.empty).toBe(false);
    expect(view.subtitle).toBe("Tonight from now to midnight");
    expect(view.from).toBe("2026-03-14T18:00:00.000Z");
    expect(view.to).toBe("2026-03-15T00:00:00.000Z");
    expect(view.now).toBe("2026-03-14T18:10:00.000Z");
    expect([view.hours, view.span_seconds]).toEqual([6, 6 * 3600]);
    expect((view.ticks as { text: string }[]).map((t) => t.text)).toEqual([
      "18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "00:00",
    ]); // prettier-ignore
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
      range_text: "19:30–21:00",
      col: 10,
      cols: 9,
      row: 2,
      align: "start",
    });
    // Begun before the line: it starts at the line's edge, in the first lane.
    expect((view.items as Record<string, unknown>[])[0]).toMatchObject({ col: 1, cols: 3, row: 1 });
    expect([view.from_text, view.to_text]).toEqual(["18:00", "00:00"]);
  });

  it("starts on the event's own hour and keeps at least three hours near midnight", () => {
    // 22:40 in Kolkata (UTC+05:30) is 17:10 UTC: the line starts at 22:00 there, not on a UTC hour.
    const late = viewOf(
      "agenda_timeline",
      {},
      facts({
        now: new Date("2026-03-14T17:10:00Z"),
        timeZone: "Asia/Kolkata",
        timeline: [item("k1", "Finals", "2026-03-14T17:30:00Z", "2026-03-14T18:30:00Z")],
      }),
    );
    expect(late.from).toBe("2026-03-14T16:30:00.000Z");
    expect(late.to).toBe("2026-03-14T19:30:00.000Z");
    expect(late.subtitle).toBe("The next 3 hours");
    expect((late.ticks as { text: string }[]).map((t) => t.text)).toEqual([
      "22:00", "23:00", "00:00", "01:00",
    ]); // prettier-ignore
    // In the afternoon the line holds six hours, never the whole day to midnight.
    const day6 = viewOf(
      "agenda_timeline",
      {},
      facts({ now: new Date("2026-03-14T13:20:00Z"), timeline: day.slice(0, 1) }),
    );
    expect([day6.from_text, day6.to_text, day6.subtitle]).toEqual([
      "13:00",
      "19:00",
      "The next 6 hours",
    ]);
  });

  it("gives items that meet or touch their own lanes, so no block covers another", () => {
    const busy = [
      item("b1", "Quiz", "2026-03-14T18:20:00Z", "2026-03-14T19:00:00Z"),
      item("b2", "Karaoke", "2026-03-14T18:30:00Z", "2026-03-14T20:00:00Z"),
      item("b3", "Board games", "2026-03-14T18:40:00Z", "2026-03-14T19:10:00Z"),
      // Starts once the quiz's lane is free, but not next to the item before it.
      item("b4", "Finals", "2026-03-14T21:30:00Z", null),
    ];
    const items = viewOf("agenda_timeline", {}, facts({ timeline: busy })).items as {
      row: number;
      cols: number;
      range_text: string;
      align: string;
    }[];
    expect(items.map((i) => i.row)).toEqual([1, 2, 3, 1]);
    // No end: one column and its start alone.
    expect(items[3]).toMatchObject({ cols: 1, range_text: "21:30" });
  });

  it("reaches a late block's label back from the line's end", () => {
    const view = viewOf(
      "agenda_timeline",
      {},
      facts({ timeline: [item("l1", "Night run", "2026-03-14T23:40:00Z", null)] }),
    );
    const [late] = view.items as {
      align: string;
      col: number;
      label_col: number;
      label_cols: number;
    }[];
    expect(late).toMatchObject({ col: 35, align: "end" });
    expect((late?.label_col ?? 0) + (late?.label_cols ?? 0) - 1).toBe(36);
    expect(late?.label_col).toBeLessThan(35);
  });

  it("keeps every label clear of the other blocks of its lane, and leaves out one with no room", () => {
    const hourly = [18, 19, 20, 21, 22].map((h) =>
      item(`h${String(h)}`, `Item ${String(h)}`, `2026-03-14T${String(h)}:30:00Z`, `2026-03-14T${String(h + 1)}:30:00Z`),
    ); // prettier-ignore
    // The Dashboard's hero, a third of the screen wide: a label needs nearly three hours there.
    const small = viewOf("agenda_timeline", {}, facts({ timeline: hourly }), null, 59);
    expect(small.to_text).toBe("22:00");
    const narrow = small.items as {
      name: string;
      col: number;
      cols: number;
      row: number;
      label_col: number;
      label_cols: number;
    }[];
    // Four hours there, so the axis's times never meet; 21:30's label has no lane left.
    expect(narrow.map((i) => i.name)).toEqual(["Item 18", "Item 19", "Item 20"]);
    const reach = (i: (typeof narrow)[number]) => [
      Math.min(i.col, i.label_col),
      Math.max(i.col + i.cols - 1, i.label_col + i.label_cols - 1),
    ];
    for (const a of narrow)
      for (const b of narrow) {
        if (a === b || a.row !== b.row) continue;
        const [[a0, a1], [b0, b1]] = [reach(a), reach(b)] as [number[], number[]];
        expect((a1 as number) < (b0 as number) || (b1 as number) < (a0 as number)).toBe(true);
      }
    // A whole screen's width has room for all five.
    expect(
      (viewOf("agenda_timeline", {}, facts({ timeline: hourly })).items as unknown[]).length,
    ).toBe(5);
  });

  it("marks an open food order's close on the line", () => {
    const view = viewOf(
      "agenda_timeline",
      {},
      facts({ timeline: day, food: { orders: [order()], names: false } }),
    );
    expect(view.marks).toEqual([
      {
        label: "Pizza order closes",
        at: "2026-03-14T18:30:00Z",
        at_text: "18:30",
        col: 4,
        align: "start",
      },
    ]);
  });

  it("draws the first five items by start, so a small box never cuts a row's text", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      item(
        `m${String(i)}`,
        `Talk ${String(i)}`,
        `2026-03-14T${String(18 + (i % 3))}:${i < 3 ? "20" : "40"}:00Z`,
        null,
      ),
    );
    const names = (
      viewOf("agenda_timeline", {}, facts({ timeline: many, zoneKey: "main" })).items as {
        name: string;
      }[]
    ).map((i) => i.name);
    expect(names).toHaveLength(5);
    expect(names).toEqual(
      [...many]
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
        .slice(0, 5)
        .map((i) => i.title),
    );
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
    expect((view.join as { image_url: string }).image_url).toMatch(/^data:image\/svg/);
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

describe("the slideshow's turn (D6a)", () => {
  const playlist = (run: number | null) => ({
    item: {
      kind: "image" as const,
      url: "/api/screen/files/a.png",
      slide_urls: [],
      started_at: "2026-03-14T18:09:00Z",
      offset_seconds: 0,
      duration_seconds: 10,
      muted: true,
    },
    next_item: null,
    run_seconds: run,
  });
  const dwellOf = (run: number | null) =>
    buildRegions({ ...input(), facts: facts({ playlist: playlist(run) }) })
      .regions.find((r) => r.id === "hero")
      ?.widgets.find((w) => w.widget === "playlist")?.dwell_seconds;

  it("lasts one run of the playlist in the hero, at most 5 minutes", () => {
    expect(dwellOf(200)).toBe(200);
    expect(dwellOf(900)).toBe(300);
    expect(dwellOf(3)).toBe(5);
  });

  it("takes the hero's turn while the run is unknown", () => {
    expect(dwellOf(null)).toBe(45);
  });
});

describe("one place for the rotation's items (D7, addition of 2026-11-26)", () => {
  const played = (f: ZoneFacts, zone: Partial<BuildInput["zone"]>, id = "hero") => {
    const region = buildRegions({
      ...input(),
      zone: { ...input().zone, ...zone },
      facts: f,
    }).regions.find((r) => r.id === id);
    return region?.order.map((i) => region.widgets[i]?.widget);
  };
  const counted = facts({
    agenda: { current: [], next: [item("a1", "Semi-finals", "2026-03-14T19:30:00Z", null)] },
    stats: { checked_in: 164 },
  });

  it("skips the hero's numbers while the Dashboard's Right now box shows them as its only item", () => {
    expect(played(counted, { layoutId: "dashboard" }, "right_now")).toEqual(["stats"]);
    expect(played(counted, { layoutId: "dashboard" })).toEqual(["countdown"]);
  });

  it("keeps the hero's numbers where no other box shows only them", () => {
    expect(played(counted, { layoutId: "pulse" })).toEqual(["countdown", "stats"]);
  });

  it("keeps the hero's food item when a box shows only food: the food box steps aside", () => {
    const f = facts({ food: { orders: [order()], names: false } });
    const zone = {
      layoutId: "pulse",
      regions: { venue_rail: { widgets: [{ widget: "food_status" }] } },
    };
    expect(played(f, zone, "venue_rail")).toEqual(["food_status"]);
    expect(played(f, zone)).toContain("food_status");
  });
});
