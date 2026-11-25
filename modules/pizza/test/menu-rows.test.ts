/**
 * A menu read's rows (#789 items 4–6 and 15) on the synthetic two-column menu (`fake-menu.ts`,
 * no real pizzeria): category prices given to the items without one, also across the column and
 * the page; campaigns and lunch prices kept as notes; toppings gathered from the ingredients;
 * rows of a second read merged; the CSV for the import; Finnish price forms.
 */
import { describe, expect, it } from "vitest";
import { DEMO_MENU_NOTES, DEMO_MENU_ROWS } from "../src/fake-menu.js";
import {
  applyCategories,
  gatherToppings,
  mergeRows,
  priceCents,
  rowsToCsv,
} from "../src/menu-rows.js";
import { menuOf } from "../src/reader-schemas.js";
import type { MenuRow } from "../src/reader.js";

const CATEGORY = "Demo-/Kebab-/Kana-pizzat";
const byNumber = (rows: MenuRow[], n: string) => rows.find((r) => r.number === n) as MenuRow;
const read = () => applyCategories(DEMO_MENU_ROWS);

describe("a category's price", () => {
  it("is given to each of the category's items that has no price of its own", () => {
    const rows = read().filter((r) => r.category === CATEGORY);
    expect(rows.map((r) => r.number)).toEqual(["21", "22", "23", "24", "25", "26", "27"]);
    for (const r of rows) {
      expect(r.price_cents).toBe(1390);
      expect(r.price_from_category).toBe(true);
      expect(r.category_price_cents).toBe(1390);
    }
  });

  it("runs on into the right column and the next page, where the heading is not repeated", () => {
    const rows = read();
    expect(byNumber(DEMO_MENU_ROWS, "25").category_price_cents).toBeNull();
    expect(byNumber(rows, "25").price_cents).toBe(1390);
    expect(byNumber(rows, "27")).toMatchObject({ page: 2, price_cents: 1390 });
  });

  it("never replaces an item's own price", () => {
    const rows = applyCategories([
      { ...byNumber(DEMO_MENU_ROWS, "21") },
      { ...byNumber(DEMO_MENU_ROWS, "22"), price_cents: 1490 },
    ]);
    expect(byNumber(rows, "22")).toMatchObject({ price_cents: 1490 });
    expect(byNumber(rows, "22").price_from_category).toBeUndefined();
    expect(rows.find((r) => r.number === "3")).toBeUndefined();
    expect(byNumber(read(), "3")).toMatchObject({ price_cents: 1150, category: "Classics" });
  });

  it("leaves an item without a price when its category has none", () => {
    const rows = applyCategories([{ ...byNumber(DEMO_MENU_ROWS, "1"), price_cents: null }]);
    expect(rows[0]?.price_cents).toBeNull();
  });
});

describe("campaigns and lunch prices", () => {
  it("are notes, never prices or rows", () => {
    const answer = menuOf(
      { readable: true, reason: null, rows: DEMO_MENU_ROWS, notes: DEMO_MENU_NOTES },
      2,
    );
    expect(answer.notes.map((n) => n.kind)).toEqual(["campaign", "lunch"]);
    const rows = applyCategories(answer.rows);
    expect(rows.some((r) => r.price_cents === 1190 || r.price_cents === 990)).toBe(false);
    expect(rows.some((r) => /kampanja|lounas/i.test(r.name))).toBe(false);
  });
});

describe("the model's answer", () => {
  it("is taken as outside input: bounded numbers, cut texts, pages within the read", () => {
    const answer = menuOf(
      {
        rows: [
          { ...DEMO_MENU_ROWS[0], page: 9, name: "x".repeat(200), price_cents: -5 },
          { ...DEMO_MENU_ROWS[0], kind: "item", number: null },
          { ...DEMO_MENU_ROWS[9], included_toppings: 99, extra_topping_cents: 150 },
          { ...DEMO_MENU_ROWS[10], tier: "gold" },
        ],
        notes: [
          { kind: "other", text: "x", page: 1 },
          { kind: "lunch", text: "Lounas 9,90€", page: 3 },
        ],
      },
      2,
    );
    expect(answer.rows[0]).toMatchObject({ page: 2, price_cents: null });
    expect(answer.rows[0]?.name).toHaveLength(80);
    expect(answer.rows).toHaveLength(3);
    expect(answer.rows[1]).toMatchObject({ kind: "base", included_toppings: null });
    expect(answer.rows[2]).toMatchObject({ kind: "topping", tier: null });
    expect(answer.notes).toEqual([{ kind: "lunch", text: "Lounas 9,90€", page: 2 }]);
  });
});

describe("gathered toppings", () => {
  it("are the ingredients of at least two pizzas, split at commas and 'ja', for the crew to confirm", () => {
    const rows = gatherToppings(read());
    const gathered = rows.filter((r) => r.gathered === true);
    const names = gathered.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["Kinkku", "Ananas", "Aurajuusto", "Salami"]));
    expect(names).not.toContain("Tomaatti");
    expect(names).not.toContain("Poro");
    expect(names.some((n) => / ja |,/.test(n))).toBe(false);
    for (const r of gathered)
      expect(r).toMatchObject({ kind: "topping", tier: "normal", unsure: true });
  });

  it("are not gathered when the menu lists normal toppings, or has no own pizza", () => {
    const normal: MenuRow = { ...(DEMO_MENU_ROWS[10] as MenuRow), name: "Oliivi", tier: "normal" };
    expect(gatherToppings([...read(), normal]).some((r) => r.gathered)).toBe(false);
    expect(gatherToppings(read().filter((r) => r.kind !== "base")).some((r) => r.gathered)).toBe(
      false,
    );
  });
});

describe("rows of another read", () => {
  it("are added, a repeated number merged and a conflicting price highlighted", () => {
    const old = read();
    const added: MenuRow[] = [
      byNumber(old, "1"),
      { ...byNumber(old, "2"), price_cents: 1100 },
      { ...byNumber(old, "1"), number: "40", name: "Demo Uusi", page: 3 },
    ];
    const { rows, conflicts } = mergeRows(old, added);
    expect(rows).toHaveLength(old.length + 1);
    expect(byNumber(rows, "2").price_cents).toBe(1050);
    expect(conflicts).toEqual([old.findIndex((r) => r.number === "2")]);
    expect(rows.at(-1)).toMatchObject({ number: "40", page: 3 });
  });

  it("merge a numberless row by its name, in any case", () => {
    const old = read();
    const { rows } = mergeRows(old, [
      { ...byNumber(old, "1"), number: null, kind: "topping", name: "KATKARAPU", tier: "special" },
    ]);
    expect(rows).toHaveLength(old.length);
  });
});

describe("the CSV", () => {
  it("carries each row's category and its price, the own pizza's fields and the topping tiers", () => {
    const csv = rowsToCsv("Demo Pizzeria", read()).split("\n");
    expect(csv[0]).toBe(
      "pizzeria,kind,number,name,description,price,category,category_price,included_toppings,extra_topping_price,tier",
    );
    expect(csv).toContain(
      'Demo Pizzeria,item,21,Demo Kebab,"kebab, sipuli ja jalapeno",,Demo-/Kebab-/Kana-pizzat,13.90,,,',
    );
    expect(csv).toContain(
      'Demo Pizzeria,item,1,Demo Margherita,"tomaatti, juusto",9.00,Classics,,,,',
    );
    expect(csv).toContain("Demo Pizzeria,base,,Demo Fantasia,valitse 3 täytettä,10.00,,,3,1.50,");
    expect(csv).toContain("Demo Pizzeria,topping,,Katkarapu,,2.50,,,,,special");
  });
});

describe("a price as typed", () => {
  it.each([
    ["13,90€", 1390],
    ["€ 13,90", 1390],
    ["13.90 €", 1390],
    ["13,9", 1390],
    ["13", 1300],
    [" 0,50 ", 50],
  ])("reads %s as %i cents", (text, cents) => {
    expect(priceCents(text)).toBe(cents);
  });

  it.each(["", "  ", "abc", "13,999", "-1", "1000,00"])("reads %j as no price", (text) => {
    expect(priceCents(text)).toBeNull();
  });
});
