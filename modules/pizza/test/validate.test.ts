/** The legacy `pizza-validate` tests, ported: the rules for a pizza, a menu and the money fields. */
import { describe, expect, it } from "vitest";
import type { MenuEntry } from "../src/model.js";
import {
  InvalidBody,
  ownPizzaPrice,
  parseItemBody,
  parseMenuBody,
  parsePrice,
  parseTime,
  parseTotal,
  snapshotOf,
} from "../src/validate.js";

const entry = (o: Partial<MenuEntry> & Pick<MenuEntry, "id" | "name">): MenuEntry => ({
  kind: "item",
  number: null,
  description: null,
  price_cents: null,
  category: null,
  included_toppings: null,
  extra_topping_cents: null,
  tier: null,
  ...o,
});
const items = [
  entry({ id: "mi_1", number: "1", name: "Margherita", description: "tomato", price_cents: 800 }),
  entry({ id: "mi_12", number: "12", name: "Kebab", price_cents: null }),
];
const toppings = ["kinkku", "ananas", "sipuli", "salami", "jalapeno"].map((name, i) =>
  entry({ id: `mt_${i}`, kind: "topping", name, price_cents: 100 }),
);
const base = entry({ id: "mb_1", kind: "base", name: "Oma pizza", price_cents: 700 });
const ctx = { items, base, toppings };

describe("parseItemBody", () => {
  it("accepts an own pizza with 1 and 6 toppings and refuses 7 (#789, Q3)", () => {
    expect(parseItemBody({ kind: "custom", toppings: ["kinkku"] }, ctx).toppings).toEqual([
      "kinkku",
    ]);
    const six = [...toppings.map((t) => t.name), "tonnikala"];
    const wide = {
      ...ctx,
      toppings: [
        ...toppings,
        entry({ id: "mt_9", kind: "topping", name: "tonnikala" }),
        entry({ id: "mt_10", kind: "topping", name: "oliivi" }),
      ],
    };
    expect(parseItemBody({ kind: "custom", toppings: six }, wide).toppings).toHaveLength(6);
    expect(() => parseItemBody({ kind: "custom", toppings: [...six, "oliivi"] }, wide)).toThrow(
      /1 to 6 toppings/,
    );
  });
  it("refuses a topping of another pizzeria, duplicates, and an own pizza without a base", () => {
    expect(() => parseItemBody({ kind: "custom", toppings: ["tonnikala"] }, ctx)).toThrow(
      /toppings/,
    );
    expect(() => parseItemBody({ kind: "custom", toppings: ["kinkku", "KINKKU"] }, ctx)).toThrow(
      /duplicates/,
    );
    expect(() =>
      parseItemBody({ kind: "custom", toppings: ["kinkku"] }, { ...ctx, base: null }),
    ).toThrow(/own pizza/);
  });
  it("checks menu items, the text, the note and the comment", () => {
    expect(parseItemBody({ kind: "menu", menu_item_id: "mi_1", note: "no onion" }, ctx).note).toBe(
      "no onion",
    );
    expect(() => parseItemBody({ kind: "menu", menu_item_id: "mi_99" }, ctx)).toThrow(
      /menu_item_id/,
    );
    expect(() => parseItemBody({ kind: "text", text: "x".repeat(81) }, ctx)).toThrow(/text/);
    expect(() =>
      parseItemBody({ kind: "text", text: "XL", comment: "x".repeat(121) }, ctx),
    ).toThrow(/comment/);
    expect(() => parseItemBody({ kind: "text", text: "" }, ctx)).toThrow(/text/);
    expect(() => parseItemBody({ kind: "pasta" }, ctx)).toThrow(/kind/);
  });
  it("names the field it refused", () => {
    try {
      parseItemBody({ kind: "menu", menu_item_id: 3 }, ctx);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidBody);
      expect((err as InvalidBody).field).toBe("menu_item_id");
      expect((err as InvalidBody).status).toBe(400);
      expect((err as InvalidBody).toBody().error).toMatchObject({
        code: "invalid_request",
        field: "menu_item_id",
      });
    }
  });
});

describe("snapshotOf (D15: a row keeps what was ordered, its price included)", () => {
  it("snapshots a menu item with its number, description and price", () => {
    const s = snapshotOf(parseItemBody({ kind: "menu", menu_item_id: "mi_1" }, ctx), ctx);
    expect(s).toEqual({
      menu_item_id: "mi_1",
      number: "1",
      label: "#1 Margherita",
      description: "tomato",
      toppings: null,
      text: null,
      price_cents: 800,
    });
  });
  it("prices an own pizza as its base plus each topping", () => {
    const s = snapshotOf(
      parseItemBody({ kind: "custom", toppings: ["KINKKU", "ananas"] }, ctx),
      ctx,
    );
    expect(s).toMatchObject({ label: "Oma pizza: kinkku, ananas", price_cents: 900 });
    const unpriced = { ...ctx, toppings: [entry({ id: "t", kind: "topping", name: "kinkku" })] };
    const t = snapshotOf(
      parseItemBody({ kind: "custom", toppings: ["kinkku"] }, unpriced),
      unpriced,
    );
    expect(t.price_cents).toBeNull();
  });
  it("prices a Fantasia own pizza by its included toppings (#789 item 6)", () => {
    const fantasia = {
      ...ctx,
      base: entry({ ...base, price_cents: 1000, included_toppings: 3, extra_topping_cents: 150 }),
      toppings: [
        ...toppings,
        entry({
          id: "ms_1",
          kind: "topping",
          name: "prosciutto",
          price_cents: 250,
          tier: "special",
        }),
      ],
    };
    const priced = (names: string[]) =>
      snapshotOf(parseItemBody({ kind: "custom", toppings: names }, fantasia), fantasia)
        .price_cents;
    expect(priced(["kinkku", "ananas", "sipuli"])).toBe(1000);
    expect(priced(["kinkku", "ananas", "sipuli", "salami", "jalapeno"])).toBe(1300);
    expect(priced(["kinkku", "ananas", "prosciutto"])).toBe(1250);
  });
  it("leaves Other without a price", () => {
    const s = snapshotOf(parseItemBody({ kind: "text", text: "XL family" }, ctx), ctx);
    expect(s).toMatchObject({ label: "Other: XL family", price_cents: null, text: "XL family" });
  });
});

describe("parseMenuBody", () => {
  it("trims, keeps prices and de-duplicates toppings case-insensitively", () => {
    const m = parseMenuBody({
      base: { name: " Oma pizza ", price: 700 },
      items: [{ number: 12, name: " Kebab ", description: "kebab, onion", price: 950 }],
      toppings: [{ name: "kinkku", price: 100 }, { name: "Kinkku" }],
    });
    expect(m.base).toEqual({ name: "Oma pizza", description: null, price_cents: 700 });
    expect(m.items).toEqual([
      { number: "12", name: "Kebab", description: "kebab, onion", price_cents: 950 },
    ]);
    expect(m.toppings).toEqual([{ name: "kinkku", description: null, price_cents: 100 }]);
  });
  it("refuses an item without a number, a number twice, and over-long text", () => {
    expect(() => parseMenuBody({ items: [{ name: "Kebab" }] })).toThrow(/items\[0\]\.number/);
    expect(() =>
      parseMenuBody({
        items: [
          { number: "1", name: "A" },
          { number: "1", name: "B" },
        ],
      }),
    ).toThrow(/items\[1\]\.number: 1 is on the menu twice/);
    expect(() => parseMenuBody({ items: [{ number: "123456789", name: "A" }] })).toThrow(
      /at most 8/,
    );
    expect(() => parseMenuBody({ items: [{ number: "1", name: "x".repeat(81) }] })).toThrow(
      /at most 80/,
    );
    expect(() =>
      parseMenuBody({ items: [{ number: "1", name: "A", description: "x".repeat(301) }] }),
    ).toThrow(/at most 300/);
  });
  it("allows no base and no toppings", () => {
    expect(parseMenuBody({ base: null, items: [] })).toEqual({
      base: null,
      items: [],
      toppings: [],
    });
  });
});

describe("money fields", () => {
  it("totals are integer cents from 0 to 500000", () => {
    expect(parseTotal(0)).toBe(0);
    expect(parseTotal(500000)).toBe(500000);
    expect(() => parseTotal(500001)).toThrow(InvalidBody);
    expect(() => parseTotal(1.5)).toThrow(InvalidBody);
    expect(() => parseTotal("12")).toThrow(InvalidBody);
  });
  it("prices are integer cents from 0 to 99999, or null", () => {
    expect(parsePrice(null, "price")).toBeNull();
    expect(parsePrice(99999, "price")).toBe(99999);
    expect(() => parsePrice(100000, "price")).toThrow(/price/);
    expect(() => parsePrice(-1, "price")).toThrow(InvalidBody);
  });
});

describe("parseTime (RFC 3339: a time names its offset)", () => {
  it("reads Z and ±HH:MM, with or without fractions", () => {
    expect(parseTime("2026-10-29T16:00:00Z", "at").toISOString()).toBe("2026-10-29T16:00:00.000Z");
    expect(parseTime("2026-10-29T18:00:00+02:00", "at").toISOString()).toBe(
      "2026-10-29T16:00:00.000Z",
    );
    expect(parseTime("2026-10-29T16:00:00.250Z", "at").toISOString()).toBe(
      "2026-10-29T16:00:00.250Z",
    );
  });
  it("refuses a time without an offset, which the host's zone would read", () => {
    for (const v of [
      "2026-10-29T18:00:00",
      "2026-10-29T18:00",
      "2026-10-29T18:00+02:00",
      "2026-10-29T18:00:00.000",
      "2026-10-29T18:00:00+0200",
      "2026-10-29T18:00:00 Z",
      "2026-10-29",
    ]) {
      expect(() => parseTime(v, "at"), v).toThrow(InvalidBody);
    }
  });
});

describe("ownPizzaPrice (#789 item 6: the Fantasia own pizza)", () => {
  const fantasia = { price_cents: 1000, included_toppings: 3, extra_topping_cents: 150 };
  const normal = (price_cents: number | null = 100) => ({ price_cents, tier: "normal" as const });
  const special = (price_cents: number | null = 250) => ({ price_cents, tier: "special" as const });
  it("three normal toppings cost the base", () => {
    expect(ownPizzaPrice(fantasia, [normal(), normal(), normal()])).toBe(1000);
  });
  it("five normal toppings cost two extras", () => {
    expect(ownPizzaPrice(fantasia, [normal(), normal(), normal(), normal(), normal()])).toBe(1300);
  });
  it("two normal and one special cost the base plus the special", () => {
    expect(ownPizzaPrice(fantasia, [normal(), normal(), special()])).toBe(1250);
  });
  it("a special topping never uses up an included one", () => {
    expect(ownPizzaPrice(fantasia, [normal(), normal(), normal(), special()])).toBe(1250);
  });
  it("normal toppings' own prices do not count while the base includes toppings", () => {
    expect(ownPizzaPrice(fantasia, [normal(null), normal(900)])).toBe(1000);
  });
  it("no included_toppings prices as before: the base plus each topping's price", () => {
    const plain = { price_cents: 700, included_toppings: null, extra_topping_cents: null };
    expect(ownPizzaPrice(plain, [normal(100), special(250)])).toBe(1050);
    expect(ownPizzaPrice(plain, [normal(null)])).toBeNull();
  });
  it("a missing price makes the own pizza unpriced", () => {
    expect(ownPizzaPrice({ ...fantasia, price_cents: null }, [normal()])).toBeNull();
    expect(ownPizzaPrice(fantasia, [normal(), special(null)])).toBeNull();
    // Past the included ones without an extra price.
    const noExtra = { ...fantasia, extra_topping_cents: null };
    expect(ownPizzaPrice(noExtra, [normal(), normal(), normal()])).toBe(1000);
    expect(ownPizzaPrice(noExtra, [normal(), normal(), normal(), normal()])).toBeNull();
  });
});
