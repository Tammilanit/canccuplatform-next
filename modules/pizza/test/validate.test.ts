/** The legacy `pizza-validate` tests, ported: the rules for a pizza, a menu and the money fields. */
import { describe, expect, it } from "vitest";
import type { MenuEntry } from "../src/model.js";
import {
  InvalidBody,
  parseItemBody,
  parseMenuBody,
  parsePrice,
  parseTotal,
  snapshotOf,
} from "../src/validate.js";

const entry = (o: Partial<MenuEntry> & Pick<MenuEntry, "id" | "name">): MenuEntry => ({
  kind: "item",
  number: null,
  description: null,
  price_cents: null,
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
  it("accepts an own pizza with 1 and 4 toppings and refuses 5", () => {
    expect(parseItemBody({ kind: "custom", toppings: ["kinkku"] }, ctx).toppings).toEqual([
      "kinkku",
    ]);
    const four = ["kinkku", "ananas", "sipuli", "salami"];
    expect(parseItemBody({ kind: "custom", toppings: four }, ctx).toppings).toHaveLength(4);
    expect(() => parseItemBody({ kind: "custom", toppings: [...four, "jalapeno"] }, ctx)).toThrow(
      InvalidBody,
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
