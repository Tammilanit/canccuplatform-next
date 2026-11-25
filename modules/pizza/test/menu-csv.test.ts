/** The menu import's contract part (contracts/pizza.md, The menu CSV): the spec's example and each rule. */
import { describe, expect, it } from "vitest";
import { MAX_BYTES, parseMenuCsv, writeMenuCsv } from "../src/menu-csv.js";
import { SPEC_MENU, must } from "./fixtures.js";

const HEAD = "pizzeria,kind,number,name,price";
const csv = (...lines: string[]) => [HEAD, ...lines].join("\n") + "\n";
const errorsOf = (text: string) => parseMenuCsv(text).errors;

describe("the spec's example", () => {
  const r = parseMenuCsv(SPEC_MENU);
  it("reads two pizzerias with their fields, items, base and toppings", () => {
    expect(r.errors).toEqual([]);
    expect(r.pizzerias.map((p) => [p.name, p.phone, p.website, p.service])).toEqual([
      ["Demo Trattoria", "+000 000 0000", "https://trattoria.example", "delivery"],
      ["Demo Corner Grill", "+000 000 0001", null, "takeaway"],
    ]);
    const t = must(r.pizzerias[0]).menu;
    expect(t.items).toEqual([
      { number: "4", name: "Margherita", description: "tomato, mozzarella", price_cents: 800 },
      { number: "7", name: "Funghi", description: "mushroom, mozzarella", price_cents: 850 },
      { number: "12", name: "Kebab", description: "kebab, onion, chili", price_cents: 950 },
    ]);
    expect(t.base).toEqual({
      name: "Own pizza",
      description: "tomato, mozzarella",
      price_cents: 700,
    });
    expect(t.toppings).toEqual([{ name: "Olives", description: null, price_cents: 100 }]);
  });
  it("warns, without stopping, of an item without a price", () => {
    expect(r.warnings).toEqual([{ row: 7, column: "price", message: "Demo Burger has no price" }]);
  });
  it("writes the same file back from what it read", () => {
    expect(writeMenuCsv(r.pizzerias)).toBe(SPEC_MENU);
  });
});

describe("format", () => {
  it("ignores a BOM, takes CRLF and columns in any order, and warns of an unknown column", () => {
    const text = "﻿name,price,pizzeria,number,colour\r\nMargherita,8,Demo,1,red\r\n";
    const r = parseMenuCsv(text);
    expect(r.errors).toEqual([]);
    expect(r.pizzerias[0]?.menu.items[0]).toMatchObject({ number: "1", price_cents: 800 });
    expect(r.warnings).toEqual([{ row: 1, column: "colour", message: "unknown column, ignored" }]);
  });
  it("reads quoted fields with commas, doubled quotes and line breaks", () => {
    const r = parseMenuCsv(csv('Demo,item,1,"Say ""cheese""",8.00', 'Demo,item,2,"Two\nlines",'));
    expect(r.pizzerias[0]?.menu.items.map((i) => i.name)).toEqual(['Say "cheese"', "Two\nlines"]);
  });
  it("needs the pizzeria and name columns", () => {
    expect(errorsOf("kind,number\nitem,1\n")).toEqual([
      { row: 1, column: "pizzeria", message: "missing column" },
      { row: 1, column: "name", message: "missing column" },
    ]);
  });
  it("refuses a column given twice, a row with the wrong field count and a broken quote", () => {
    expect(errorsOf("pizzeria,name,name\nA,b,c\n")[0]).toMatchObject({ row: 1, column: "name" });
    expect(errorsOf(csv("Demo,item,1"))[0]).toMatchObject({ row: 2, column: null });
    expect(errorsOf(csv('Demo,item,1,"open,8'))[0]).toMatchObject({ row: 2 });
  });
  it("refuses more than 1,000 rows and more than 512 KiB", () => {
    const rows = Array.from({ length: 1001 }, (_, i) => `Demo,item,${i},Pizza ${i},1.00`);
    expect(errorsOf(csv(...rows))).toEqual([
      { row: null, column: null, message: "at most 1000 rows" },
    ]);
    const big = csv(`Demo,item,1,"${"x".repeat(MAX_BYTES)}",1`);
    expect(errorsOf(big)).toEqual([{ row: null, column: null, message: "at most 512 KiB" }]);
  });
});

describe("rules", () => {
  const one = (line: string) => errorsOf(csv(line))[0];
  it("names the row and the column of each refused value", () => {
    expect(one(",item,1,A,1")).toEqual({ row: 2, column: "pizzeria", message: "required" });
    expect(one("Demo,item,1,,1")).toEqual({ row: 2, column: "name", message: "required" });
    expect(one(`Demo,item,1,${"x".repeat(81)},1`)).toMatchObject({ column: "name" });
    expect(one("Demo,item,,A,1")).toEqual({
      row: 2,
      column: "number",
      message: "an item needs its menu number",
    });
    expect(one("Demo,item,123456789,A,1")).toMatchObject({ column: "number" });
    expect(one("Demo,base,4,Own,7")).toMatchObject({ column: "number" });
    expect(one("Demo,pasta,1,A,1")).toMatchObject({ column: "kind" });
  });
  it("takes prices as a dot decimal with at most two decimals, 0 to 999.99, no sign", () => {
    for (const bad of ["8,50", "8.505", "-1", "1000", "€8", "1e2"]) {
      const r = parseMenuCsv(`pizzeria,number,name,price\nDemo,1,A,"${bad}"\n`);
      expect(r.errors[0], bad).toMatchObject({ row: 2, column: "price" });
    }
    const ok = parseMenuCsv(
      "pizzeria,number,name,price\nDemo,1,A,999.99\nDemo,2,B,0\nDemo,3,C,7.5\n",
    );
    expect(ok.pizzerias[0]?.menu.items.map((i) => i.price_cents)).toEqual([99999, 0, 750]);
  });
  it("checks the description's length, the web page and the service", () => {
    const head = "pizzeria,number,name,description,website,service";
    const e = (line: string) => parseMenuCsv(`${head}\n${line}\n`).errors[0];
    expect(e(`Demo,1,A,${"x".repeat(301)},,`)).toMatchObject({ column: "description" });
    expect(e("Demo,1,A,,ftp://x.example,")).toMatchObject({ column: "website" });
    expect(e("Demo,1,A,,not a url,")).toMatchObject({ column: "website" });
    expect(e("Demo,1,A,,,boat")).toMatchObject({ column: "service" });
    const fine = parseMenuCsv(`${head}\nDemo,1,A,,http://x.example/menu,\n`);
    // Left empty, the service is not given: a new pizzeria gets delivery, a stored one keeps its own.
    expect(fine.pizzerias[0]).toMatchObject({
      service: null,
      website: "http://x.example/menu",
    });
  });
  it("groups rows by pizzeria in any case, under the first spelling", () => {
    const r = parseMenuCsv(csv("Demo Pizza,item,1,A,1", "DEMO PIZZA,item,2,B,1"));
    expect(r.pizzerias).toHaveLength(1);
    expect(r.pizzerias[0]?.name).toBe("Demo Pizza");
  });
  it("refuses a number twice in one pizzeria, but not in two", () => {
    expect(errorsOf(csv("Demo,item,1,A,1", "Demo,item,1,B,1"))[0]).toEqual({
      row: 3,
      column: "number",
      message: "1 is already on row 2",
    });
    expect(errorsOf(csv("Demo,item,1,A,1", "Other,item,1,B,1"))).toEqual([]);
  });
  it("allows one base per pizzeria and each topping once", () => {
    expect(errorsOf(csv("Demo,base,,Own,7", "Demo,base,,Own 2,7"))[0]).toMatchObject({
      row: 3,
      column: "kind",
    });
    expect(errorsOf(csv("Demo,topping,,Olives,1", "Demo,topping,,olives,1"))[0]).toMatchObject({
      row: 3,
      column: "name",
    });
  });
  it("lets phone, web page and service stand on any row of a pizzeria, but they must agree", () => {
    const head = "pizzeria,phone,service,number,name";
    const ok = parseMenuCsv(`${head}\nDemo,,,1,A\nDemo,+000 1,takeaway,2,B\nDemo,+000 1,,3,C\n`);
    expect(ok.errors).toEqual([]);
    expect(ok.pizzerias[0]).toMatchObject({ phone: "+000 1", service: "takeaway" });
    const clash = parseMenuCsv(`${head}\nDemo,+000 1,,1,A\nDemo,+000 2,,2,B\n`);
    expect(clash.errors[0]).toEqual({
      row: 3,
      column: "phone",
      message: "differs from row 2 of Demo",
    });
  });
  it("reports every error, not only the first", () => {
    expect(errorsOf(csv(",item,1,A,1", "Demo,item,,B,1"))).toHaveLength(2);
  });
});

describe("writeMenuCsv", () => {
  it("quotes what needs it and leaves empty prices empty", () => {
    const text = writeMenuCsv([
      {
        name: 'Demo "Best", Pizza',
        phone: null,
        website: null,
        service: "delivery",
        menu: {
          items: [{ number: "1", name: "A", description: "line\nbreak", price_cents: null }],
          base: null,
          toppings: [],
        },
      },
    ]);
    expect(text.split("\n")[1]).toBe('"Demo ""Best"", Pizza",,,delivery,item,1,A,"line');
  });
});

describe("categories and the own pizza's fields (#789 items 4 and 6)", () => {
  const FULL =
    "pizzeria,kind,number,name,description,price,category,category_price,included_toppings,extra_topping_price,tier";
  const full = (...lines: string[]) => [FULL, ...lines, ""].join("\n");
  const MENU = full(
    "Demo,item,1,Demo Margherita,,9.00,Classics,,,,",
    "Demo,item,21,Demo Kebab,,,Kebab pizzas,13.90,,,",
    "Demo,item,22,Demo Kana,,14.50,Kebab pizzas,13.90,,,",
    "Demo,base,,Demo Fantasia,choose 3,10.00,,,3,1.50,",
    "Demo,topping,,Kinkku,,1.50,,,,,normal",
    "Demo,topping,,Katkarapu,,2.50,,,,,special",
    "Demo,topping,,Ananas,,1.50,,,,,",
  );

  it("import: an item keeps its category, and one without a price takes the category's", () => {
    const r = parseMenuCsv(MENU);
    expect(r.errors).toEqual([]);
    const m = must(r.pizzerias[0]).menu;
    expect(m.items).toEqual([
      {
        number: "1",
        name: "Demo Margherita",
        description: null,
        price_cents: 900,
        category: "Classics",
      },
      {
        number: "21",
        name: "Demo Kebab",
        description: null,
        price_cents: 1390,
        category: "Kebab pizzas",
      },
      {
        number: "22",
        name: "Demo Kana",
        description: null,
        price_cents: 1450,
        category: "Kebab pizzas",
      },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("import: the base's included toppings and extra price, and each topping's tier", () => {
    const m = must(parseMenuCsv(MENU).pizzerias[0]).menu;
    expect(m.base).toEqual({
      name: "Demo Fantasia",
      description: "choose 3",
      price_cents: 1000,
      included_toppings: 3,
      extra_topping_cents: 150,
    });
    expect(m.toppings.map((t) => [t.name, t.tier ?? "normal"])).toEqual([
      ["Kinkku", "normal"],
      ["Katkarapu", "special"],
      ["Ananas", "normal"],
    ]);
  });

  it("export: writes the columns back when the menu uses them", () => {
    expect(writeMenuCsv(parseMenuCsv(MENU).pizzerias)).toBe(
      full(
        "Demo,,,,item,1,Demo Margherita,,9.00,Classics,,,,",
        "Demo,,,,item,21,Demo Kebab,,13.90,Kebab pizzas,,,,",
        "Demo,,,,item,22,Demo Kana,,14.50,Kebab pizzas,,,,",
        "Demo,,,,base,,Demo Fantasia,choose 3,10.00,,,3,1.50,",
        "Demo,,,,topping,,Kinkku,,1.50,,,,,",
        "Demo,,,,topping,,Katkarapu,,2.50,,,,,special",
        "Demo,,,,topping,,Ananas,,1.50,,,,,",
      ).replace(FULL, `pizzeria,phone,website,service,${FULL.slice("pizzeria,".length)}`),
    );
  });

  it("tier must be normal or special, and only on a topping", () => {
    expect(errorsOf(full("Demo,topping,,Kinkku,,1.50,,,,,gold"))[0]).toMatchObject({
      row: 2,
      column: "tier",
    });
    expect(errorsOf(full("Demo,item,1,A,,1.00,,,,,special"))[0]).toMatchObject({ column: "tier" });
  });

  it("included toppings (0 to 10) and the extra price only on a base", () => {
    expect(errorsOf(full("Demo,item,1,A,,1.00,,,3,,"))[0]).toMatchObject({
      column: "included_toppings",
    });
    expect(errorsOf(full("Demo,base,,Own,,7.00,,,11,,"))[0]).toMatchObject({
      column: "included_toppings",
    });
    expect(errorsOf(full("Demo,topping,,Olives,,1.00,,,,1.00,"))[0]).toMatchObject({
      column: "extra_topping_price",
    });
  });

  it("a category and its price only on an item, the price as a price", () => {
    expect(errorsOf(full("Demo,base,,Own,,7.00,Pizzas,,,,"))[0]).toMatchObject({
      column: "category",
    });
    expect(errorsOf(full("Demo,item,1,A,,,Pizzas,13,90,,,"))[0]).toMatchObject({ row: 2 });
    expect(errorsOf(full("Demo,item,1,A,,,Pizzas,x,,,"))[0]).toMatchObject({
      column: "category_price",
    });
    expect(errorsOf(full(`Demo,item,1,A,,,${"c".repeat(61)},,,,`))[0]).toMatchObject({
      column: "category",
    });
  });

  it("old CSVs without the new columns import and export as before", () => {
    const r = parseMenuCsv(SPEC_MENU);
    expect(r.warnings.map((w) => w.column)).toEqual(["price"]);
    expect(writeMenuCsv(r.pizzerias)).toBe(SPEC_MENU);
  });
});
