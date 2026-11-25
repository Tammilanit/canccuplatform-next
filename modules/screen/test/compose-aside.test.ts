/**
 * Nearby content and the QR of an announcement (contracts/screen.md, Moments drive it: claims;
 * #780): a full-screen Info or Important carries the source's status or now and next beside it.
 */
import { describe, expect, it } from "vitest";
import type { BuildInput } from "../src/compose/build.js";
import { overrideOf } from "../src/compose/claims.js";
import type { Override } from "../src/compose/claims.js";
import type { FoodOrder } from "../src/compose/food.js";
import type { ZoneFacts } from "../src/compose/widgets.js";
import { placeZone } from "../src/compose/zone-claims.js";

const NOW = new Date("2026-01-01T19:30:10Z");

const ORDER: FoodOrder = {
  id: "o_7",
  seq: 7,
  state: "arrived",
  pizzeria_name: "Demo Pizzeria",
  target_at: null,
  closes_at: null,
  estimate_at: null,
  pickup: "the café",
  holder_name: null,
  pizza_count: 4,
  people_count: 3,
  placed_at: "2026-01-01T18:30:00Z",
  arrived_at: "2026-01-01T19:30:00Z",
};

function facts(orders: FoodOrder[]): ZoneFacts {
  return {
    now: NOW,
    timeZone: "Europe/Helsinki",
    origin: "https://demo.example",
    eventName: "Demo Event",
    logoUrl: null,
    agenda: {
      current: [
        {
          id: "i_1",
          title: "Demo Game Cup",
          kind: "tournament",
          starts_at: "2026-01-01T19:00:00Z",
          ends_at: "2026-01-01T21:00:00Z",
          delay_minutes: 0,
          location: null,
          visibility: "public",
        },
      ],
      next: [],
    },
    venue: null,
    ticker: { text: null, until: null, source: null },
    food: { orders, names: true },
  };
}

const input = (orders: FoodOrder[]): Omit<BuildInput, "showcase"> => ({
  zone: { key: "main", regions: {}, layoutId: "pulse" },
  windowLayoutId: null,
  themeLayouts: [],
  portrait: false,
  facts: facts(orders),
});

function card(level: string, regions: string[], module = "pizza", extra = {}): Override {
  const parsed = overrideOf({
    id: "ov_card",
    kind: "block",
    zones: [],
    rank: 80,
    source: { module, event_id: null, ref: "o_7" },
    template: "announcement",
    content: {
      title: "Pizza is here",
      body: "",
      level,
      starts_at: "2026-01-01T19:30:00Z",
      ...extra,
    },
    regions,
    starts_at: "2026-01-01T19:30:00Z",
    ends_at: null,
  });
  if (parsed === null) throw new Error("fixture does not parse");
  return parsed;
}

const claimIn = (view: ReturnType<typeof placeZone>, id: string) =>
  view.regions.find((r) => r.id === id)?.claim;

describe("nearby content", () => {
  it("is the food box's view for a pizza-sourced Important at full screen", () => {
    const view = placeZone(input([ORDER]), [card("important", ["full"])], true);
    const aside = claimIn(view, "_full")?.aside;
    expect(aside?.widget).toBe("food_status");
    expect(aside?.view.empty).toBe(false);
  });

  it("survives the stored row: stringified and parsed again, it still knows its source", () => {
    const stored = overrideOf(JSON.parse(JSON.stringify(card("important", ["full"]))));
    if (stored === null) throw new Error("stored override does not parse");
    const view = placeZone(input([ORDER]), [stored], true);
    expect(claimIn(view, "_full")?.aside?.widget).toBe("food_status");
  });

  it("is now and next while the food box is empty", () => {
    const view = placeZone(input([]), [card("important", ["full"])], true);
    const aside = claimIn(view, "_full")?.aside;
    expect(aside?.widget).toBe("agenda_now");
    expect(aside?.view.items).toEqual([expect.objectContaining({ name: "Demo Game Cup" })]);
  });

  it("is now and next for a composed Info, whatever the food box holds", () => {
    const view = placeZone(input([ORDER]), [card("info", ["full"], "moments")], true);
    expect(claimIn(view, "_full")?.aside?.widget).toBe("agenda_now");
  });

  it("is absent on an Urgent one, which wears no decoration", () => {
    const view = placeZone(input([ORDER]), [card("urgent", ["full"])], true);
    expect(claimIn(view, "_full")).not.toHaveProperty("aside");
  });

  it("is absent on a card in the hero", () => {
    const view = placeZone(input([ORDER]), [card("important", ["hero"])], true);
    expect(claimIn(view, "hero")).not.toHaveProperty("aside");
  });
});

describe("an announcement's QR", () => {
  it("is made whole on the event's hostname, with its image", () => {
    const qr = { url: "/pizza/orders/o_7", label: "Your order" };
    const view = placeZone(input([]), [card("important", ["hero"], "pizza", { qr })], true);
    const made = claimIn(view, "hero")?.content.qr as Record<string, string> | undefined;
    expect(made?.url).toBe("https://demo.example/pizza/orders/o_7");
    expect(made?.label).toBe("Your order");
    expect(made?.image_url).toMatch(/^data:image\/svg\+xml/);
  });

  it("keeps a whole one as it is", () => {
    const qr = {
      url: "https://demo.example/x",
      label: "X",
      image_url: "data:image/svg+xml;base64,AA",
    };
    const view = placeZone(input([]), [card("important", ["hero"], "pizza", { qr })], true);
    expect(claimIn(view, "hero")?.content.qr).toEqual(qr);
  });
});
