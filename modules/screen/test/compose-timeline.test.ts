import { describe, expect, it } from "vitest";
import type { FoodOrder } from "../src/compose/food.js";
import { viewOf } from "../src/compose/widgets.js";
import type { AgendaItem, ZoneFacts } from "../src/compose/widgets.js";

// The coming hours (issue #787 D1, sheet 01; part B's Task 1): tonight from the event's hour to
// midnight, items as blocks in lanes, the hour axis, and an open order's close on it.
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
    // Begun before the line: it starts at the line's edge, in the first lane, as wide as its label.
    expect((view.items as Record<string, unknown>[])[0]).toMatchObject({ col: 1, cols: 5, row: 1 });
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
    // No end: its start alone, in a box as wide as its label needs.
    expect(items[3]).toMatchObject({ range_text: "21:30" });
    expect(items[3]?.cols).toBeGreaterThan(1);
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
      cols: number;
      label_col: number;
      label_cols: number;
    }[];
    // The box reaches back from the line's end with its label, and the label is the box's own.
    expect(late).toMatchObject({ align: "end" });
    expect((late?.col ?? 0) + (late?.cols ?? 0) - 1).toBe(36);
    expect(late?.col).toBeLessThan(35);
    expect(late?.label_col).toBe(late?.col);
    expect(late?.label_cols).toBe(late?.cols);
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
