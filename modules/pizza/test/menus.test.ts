/** Pizzerias and menus per event (D6, D7 B, D11), the menu import's preview and apply, and download. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  DATABASE_URL,
  errorOf,
  freshDatabase,
  json,
  open,
  seedPizzerias,
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";
import { SPEC_MENU, must } from "./fixtures.js";

let pool: pg.Pool;
let w: World;

beforeAll(async () => {
  if (DATABASE_URL) pool = await freshDatabase();
});
afterAll(async () => {
  if (DATABASE_URL) await pool.end();
});
beforeEach(async () => {
  if (!DATABASE_URL) return;
  await pool.query(
    "TRUNCATE pizza_pizzerias, pizza_menu_entries, pizza_orders, pizza_items, pizza_order_log, pizza_idempotency, pizza_outbox, pizza_outbox_tenants, pizza_tenants",
  );
  w = await world(pool);
});

const csvCall = (who: string, path: string, text: string) =>
  w.call(who, "POST", `/api/pizza/${path}`, undefined, { raw: text, contentType: "text/csv" });
type Menu = {
  items: {
    id: string;
    number: string;
    name: string;
    price_cents: number | null;
    hidden?: boolean;
  }[];
  base: unknown;
  toppings: { name: string }[];
};
const menuOf = async (id: string, who = "pena", q = "") =>
  json(await w.call(who, "GET", `/api/pizza/pizzerias/${id}${q}`)).menu as Menu;

describe.skipIf(!DATABASE_URL)("pizzerias", () => {
  it("needs pizza.menu.write to add or edit, and checks the fields", async () => {
    expect((await w.call("pena", "POST", "/api/pizza/pizzerias", { name: "X" })).statusCode).toBe(
      403,
    );
    const r = await w.call("menus", "POST", "/api/pizza/pizzerias", {
      name: "Demo Pizzeria",
      phone: "+000",
      website: "https://p.example",
      service: "takeaway",
    });
    expect(r.statusCode).toBe(201);
    expect(json(r)).toMatchObject({
      name: "Demo Pizzeria",
      service: "takeaway",
      website: "https://p.example",
    });
    expect(
      errorOf(
        await w.call("menus", "POST", "/api/pizza/pizzerias", {
          name: "Y",
          website: "javascript:x",
        }),
      ).field,
    ).toBe("website");
    expect(
      errorOf(await w.call("menus", "POST", "/api/pizza/pizzerias", { name: "Y", service: "boat" }))
        .field,
    ).toBe("service");
    const dup = await w.call("menus", "POST", "/api/pizza/pizzerias", { name: "demo pizzeria" });
    expect(dup.statusCode).toBe(409);
    expect(errorOf(dup).code).toBe("pizzeria_exists");
    expect(w.audit.map((a) => a.action)).toEqual(["pizza.pizzeria.added"]);
  });
  it("lists them for members and guests, the phone only for the crew and the menu writers", async () => {
    await seedPizzerias(w);
    const asMember = json(await w.call("pena", "GET", "/api/pizza/pizzerias"));
    const list = asMember.pizzerias as Record<string, unknown>[];
    expect(list.map((p) => p.name)).toEqual(["Demo Grill", "Demo Pizzeria"]);
    expect(list[1]).toMatchObject({ website: "https://pizzeria.example", service: "delivery" });
    expect(list[1]?.phone).toBeUndefined();
    expect(
      (
        json(await w.call("menus", "GET", "/api/pizza/pizzerias")).pizzerias as Record<
          string,
          unknown
        >[]
      )[1]?.phone,
    ).toBe("+000 000 0000");
    expect((await w.call(null, "GET", "/api/pizza/pizzerias")).statusCode).toBe(200);
  });
  it("hides a pizzeria instead of deleting it; its old orders keep it", async () => {
    const { pz } = await seedPizzerias(w);
    const o = json(await open(w, "pena", pz)).id as string;
    await w.call("pena", "POST", `/api/pizza/orders/${o}/cancel`, {});
    await w.call("menus", "PATCH", `/api/pizza/pizzerias/${pz}`, { hidden: true });
    const names = (
      json(await w.call("pena", "GET", "/api/pizza/pizzerias")).pizzerias as { name: string }[]
    ).map((p) => p.name);
    expect(names).toEqual(["Demo Grill"]);
    expect(json(await w.call("crew", "GET", `/api/pizza/orders/${o}`)).pizzeria).toMatchObject({
      name: "Demo Pizzeria",
    });
    expect(errorOf(await open(w, "pena", pz)).field).toBe("pizzeria_id");
    expect((await w.call("menus", "DELETE", `/api/pizza/pizzerias/${pz}`)).statusCode).toBe(404);
  });
});

describe.skipIf(!DATABASE_URL)("menus", () => {
  it("replaces a menu: items matched by number, missing ones hidden, returning ones shown again", async () => {
    const { pz } = await seedPizzerias(w);
    await w.call("menus", "PUT", `/api/pizza/pizzerias/${pz}/menu`, {
      items: [
        { number: "3", name: "Pepperoni XL", price: 1000 },
        { number: "4", name: "Hawaii" },
      ],
      toppings: [{ name: "tonnikala" }],
    });
    let m = await menuOf(pz);
    expect(m.items.map((i) => [i.number, i.name])).toEqual([
      ["3", "Pepperoni XL"],
      ["4", "Hawaii"],
    ]);
    expect(m.base).toBeNull();
    expect(m.toppings.map((t) => t.name)).toEqual(["tonnikala"]);
    const hidden = await menuOf(pz, "menus", "?hidden=true");
    expect(hidden.items.filter((i) => i.hidden).map((i) => i.number)).toEqual(["1", "12", "20"]);
    const firstId = must(hidden.items.find((i) => i.number === "1")).id;
    await w.call("menus", "PUT", `/api/pizza/pizzerias/${pz}/menu`, {
      items: [{ number: "1", name: "Margherita" }],
    });
    m = await menuOf(pz);
    expect(m.items.map((i) => i.id)).toEqual([firstId]);
    expect(w.audit.at(-1)).toMatchObject({
      action: "pizza.menu.replaced",
      target: { type: "pizzeria", id: pz },
    });
  });
  it("shows hidden items only to the menu writers", async () => {
    const { pz } = await seedPizzerias(w);
    expect((await w.call("pena", "GET", `/api/pizza/pizzerias/${pz}?hidden=true`)).statusCode).toBe(
      403,
    );
  });
});

describe.skipIf(!DATABASE_URL)("the menu import", () => {
  it("previews the spec's example without changing anything", async () => {
    const r = await csvCall("menus", "menu/import/preview", SPEC_MENU);
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({
      errors: [],
      warnings: [{ row: 7, column: "price", message: "Demo Burger has no price" }],
      pizzerias: [
        {
          name: "Demo Trattoria",
          status: "new",
          items: { added: 3, updated: 0, hidden: 0 },
          base: "Own pizza",
          toppings: 1,
        },
        {
          name: "Demo Corner Grill",
          status: "new",
          items: { added: 1, updated: 0, hidden: 0 },
          base: null,
          toppings: 0,
        },
      ],
    });
    expect(json(await w.call("pena", "GET", "/api/pizza/pizzerias")).pizzerias).toEqual([]);
  });
  it("applies it: new pizzerias added, an existing one matched by name, its missing items hidden", async () => {
    const { pz } = await seedPizzerias(w);
    const text = `${SPEC_MENU}demo pizzeria,,,,item,1,Margherita,,8.50\n`;
    const preview = json(await csvCall("menus", "menu/import/preview", text));
    expect((preview.pizzerias as Record<string, unknown>[])[2]).toMatchObject({
      name: "Demo Pizzeria",
      status: "matched",
      items: { added: 0, updated: 1, hidden: 3 },
    });
    const r = await csvCall("menus", "menu/import", text);
    expect(r.statusCode).toBe(200);
    const m = await menuOf(pz);
    expect(m.items.map((i) => [i.number, i.price_cents])).toEqual([["1", 850]]);
    const list = json(await w.call("pena", "GET", "/api/pizza/pizzerias")).pizzerias as {
      name: string;
    }[];
    expect(list.map((p) => p.name)).toEqual([
      "Demo Corner Grill",
      "Demo Grill",
      "Demo Pizzeria",
      "Demo Trattoria",
    ]);
    expect(w.audit.at(-1)).toMatchObject({
      action: "pizza.menu.imported",
      changes: {
        pizzerias_added: { old: null, new: 2 },
        items_added: { old: null, new: 4 },
        items_hidden: { old: null, new: 3 },
      },
    });
  });
  it("stops the whole import on an error, naming its row and column", async () => {
    const r = await csvCall(
      "menus",
      "menu/import",
      `${SPEC_MENU}Demo Trattoria,,,,item,4,Twice,,1\n`,
    );
    expect(r.statusCode).toBe(400);
    expect(errorOf(r)).toMatchObject({
      code: "menu_csv_invalid",
      errors: [{ row: 8, column: "number", message: "4 is already on row 2" }],
    });
    expect(json(await w.call("pena", "GET", "/api/pizza/pizzerias")).pizzerias).toEqual([]);
  });
  it("keeps ordered rows as they were (D15)", async () => {
    const { pz } = await seedPizzerias(w);
    const o = json(await open(w, "pena", pz)).id as string;
    const mi = must((await menuOf(pz)).items[0]).id;
    await w.call("anni", "POST", `/api/pizza/orders/${o}/items`, {
      kind: "menu",
      menu_item_id: mi,
    });
    await csvCall(
      "menus",
      "menu/import",
      "pizzeria,number,name,price\nDemo Pizzeria,1,Changed,1.00\n",
    );
    expect(
      (json(await w.call("pena", "GET", `/api/pizza/orders/${o}`)).items as { label: string }[])[0]
        ?.label,
    ).toBe("#1 Margherita");
  });
  it("needs pizza.menu.write, and a CSV body", async () => {
    expect((await csvCall("pena", "menu/import/preview", SPEC_MENU)).statusCode).toBe(403);
    expect(
      (await w.call("menus", "POST", "/api/pizza/menu/import/preview", { csv: 1 })).statusCode,
    ).toBe(415);
  });
  it("downloads the same columns for one pizzeria or all, without hidden items", async () => {
    await csvCall("menus", "menu/import", SPEC_MENU);
    const all = await w.call("menus", "GET", "/api/pizza/menu.csv");
    expect(all.headers["content-type"]).toBe("text/csv; charset=utf-8");
    const lines = SPEC_MENU.split("\n");
    // Sorted by pizzeria name: the grill's row comes first.
    expect(all.body).toBe([lines[0], lines[6], ...lines.slice(1, 6), ""].join("\n"));
    const list = json(await w.call("pena", "GET", "/api/pizza/pizzerias")).pizzerias as {
      id: string;
      name: string;
    }[];
    const grill = must(list.find((p) => p.name === "Demo Corner Grill")).id;
    const one = await w.call("menus", "GET", `/api/pizza/menu.csv?pizzeria_id=${grill}`);
    expect(one.body.split("\n")).toHaveLength(3);
    expect((await w.call("pena", "GET", "/api/pizza/menu.csv")).statusCode).toBe(403);
  });
});
