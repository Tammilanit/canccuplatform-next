/**
 * The even-share limit on the pages (#789 item 8): the holder's money step names who pays above
 * it, My order tells that person, and an order with no menu average says plain even shares.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  DATABASE_URL,
  TRUNCATE,
  freshDatabase,
  itemId,
  json,
  open,
  seedPizzerias,
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";
import { form, view } from "./forms.js";

let pool: pg.Pool;
let w: World;
let pz: string;
let id: string;
let margherita: string;

beforeAll(async () => {
  if (DATABASE_URL) pool = await freshDatabase();
});
afterAll(async () => {
  if (DATABASE_URL) await pool.end();
});
beforeEach(async () => {
  if (!DATABASE_URL) return;
  await pool.query(TRUNCATE);
  w = await world(pool);
  ({ pz } = await seedPizzerias(w));
  id = json(await open(w, "pena", pz)).id as string;
  for (const [who, number] of [
    ["anni", "12"],
    ["anni", "12"],
    ["mikko", "1"],
    ["pena", "3"],
  ] as const) {
    const added = json(
      await w.call(who, "POST", `/api/pizza/orders/${id}/items`, {
        kind: "menu",
        menu_item_id: await itemId(w, pz, number),
      }),
    );
    if (who === "mikko") margherita = added.id as string;
  }
  // Called in with the menu's 800, 900 and 950: the limit is 1150.
  await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
});

describe.skipIf(!DATABASE_URL)("the even-share limit on the pages (#789 item 8)", () => {
  it('the holder\'s page says "Even shares · €10.40 each · Mikko +€2.10, over the limit"', async () => {
    // Mikko's pizza at 13.60 is 2.10 over; 4 × 10.40 + 2.10 = 43.70.
    await w.call("pena", "PUT", `/api/pizza/items/${margherita}/price`, { price_cents: 1360 });
    await form(w, "pena", `/hold/${id}/money/total`, { total: "43.70" });
    await form(w, "pena", `/hold/${id}/money/split`, { split: "even" });
    const page = (await view(w, "pena", `/hold/${id}/money`)).body;
    expect(page).toContain("Even shares · €10.40 each · Mikko +€2.10, over the limit");
    expect(page).toContain("€12.50");
  });

  it("My order tells the person whose pizza is over the limit, and nobody else", async () => {
    await w.call("pena", "PUT", `/api/pizza/items/${margherita}/price`, { price_cents: 1360 });
    await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, {
      total_cents: 4370,
      split: "even",
    });
    const mikko = (await view(w, "mikko", `/orders/${id}`)).body;
    expect(mikko).toContain("€12.50");
    expect(mikko).toContain("Even shares, plus €2.10 for your pizza over the limit.");
    const anni = (await view(w, "anni", `/orders/${id}`)).body;
    expect(anni).not.toContain("over the limit");
  });

  it('says "Even shares, no menu average" when the menu has no prices', async () => {
    await w.call("menus", "PUT", `/api/pizza/pizzerias/${pz}/menu`, {
      items: ["1", "3", "12", "20"].map((number) => ({ number, name: `Pizza ${number}` })),
    });
    // Called in before the menu had prices: no limit was stored.
    await pool.query("UPDATE pizza_orders SET even_limit_cents = NULL WHERE id = $1", [id]);
    await form(w, "pena", `/hold/${id}/money/total`, { total: "40.00" });
    await form(w, "pena", `/hold/${id}/money/split`, { split: "even" });
    const page = (await view(w, "pena", `/hold/${id}/money`)).body;
    expect(page).toContain("Even shares, no menu average: €40.00 ÷ 4 pizzas = €10.00 a pizza");
  });

  it("in Finnish too", async () => {
    await w.call("pena", "PUT", `/api/pizza/items/${margherita}/price`, { price_cents: 1360 });
    await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, {
      total_cents: 4370,
      split: "even",
    });
    w.languages.set("demo", "fi");
    const page = (await view(w, "pena", `/hold/${id}/money`)).body;
    expect(page).toContain("Tasajako · 10,40 € / pizza · Mikko +2,10 €, yli rajan");
  });
});
