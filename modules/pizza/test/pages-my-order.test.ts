/**
 * The attendee's order pages (mockups 02, 04, 05 and 16): the menu with its filter and prices, own
 * pizza, other and the same again; editing until close; my order's steps from open to "I've got
 * mine"; and the edge states, each never a dead end.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  DATABASE_URL,
  freshDatabase,
  itemId,
  json,
  open,
  seedPizzerias,
  world,
} from "./helpers.js";
import { form, view } from "./forms.js";
import type { World } from "./helpers.js";

let pool: pg.Pool;
let w: World;
let pz: string;
let grill: string;
let id: string;

beforeAll(async () => {
  if (DATABASE_URL) pool = await freshDatabase();
});
afterAll(async () => {
  if (DATABASE_URL) await pool.end();
});
beforeEach(async () => {
  if (!DATABASE_URL) return;
  await pool.query(
    "TRUNCATE pizza_due, pizza_crew, pizza_pizzerias, pizza_menu_entries, pizza_orders, pizza_items, pizza_order_log, pizza_idempotency, pizza_outbox, pizza_outbox_tenants, pizza_tenants",
  );
  w = await world(pool);
  ({ pz, grill } = await seedPizzerias(w));
  id = json(await open(w, "pena", pz)).id as string;
});

const location = (r: { headers: Record<string, unknown> }) => String(r.headers.location);
const mine = async (who = "anni", order = id) =>
  json(await w.call(who, "GET", `/api/pizza/orders/${order}`)).mine as {
    id: string;
    label: string;
    note: string | null;
    comment: string | null;
    handed_out: boolean;
  }[];
const step = (s: string, body: Record<string, unknown> = {}) =>
  w.call("pena", "POST", `/api/pizza/orders/${id}/${s}`, body);

describe.skipIf(!DATABASE_URL)("the menu", () => {
  it("lists the pizzeria's items with their prices, and filters by name or ingredient", async () => {
    let r = await view(w, "anni", `/orders/${id}/add`);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("#12 Kebab");
    expect(r.body).toContain("kebab, onion, jalapeño");
    expect(r.body).toContain("€9.50");
    expect(r.body).toContain("#1 Margherita");
    r = await view(w, "anni", `/orders/${id}/add?q=jalap`);
    expect(r.body).toContain("#12 Kebab");
    expect(r.body).not.toContain("#1 Margherita");
  });

  it("adds a menu pizza with its note and comment, then shows it under your pizzas", async () => {
    const r = await form(w, "anni", `/orders/${id}/add`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, "12"),
      note: "no onion",
      comment: "split with Mikko",
    });
    expect(r.statusCode).toBe(303);
    expect(location(r)).toBe(`/pizza/orders/${id}?added=1`);
    expect(await mine()).toMatchObject([
      { label: "#12 Kebab", note: "no onion", comment: "split with Mikko" },
    ]);
    const page = await view(w, "anni", `/orders/${id}?added=1`);
    expect(page.body).toContain("Added to order 1");
    expect(page.body).toContain("#12 Kebab");
    expect(page.body).toContain("no onion · split with Mikko");
    expect(page.body).toContain(`data-live="/api/pizza/stream?order=${id}"`);
  });

  it("builds an own pizza from the base and its toppings", async () => {
    const own = await view(w, "anni", `/orders/${id}/add?tab=own`);
    expect(own.body).toContain("Oma pizza");
    expect(own.body).toContain('value="ananas"');
    await form(w, "anni", `/orders/${id}/add`, { kind: "custom", toppings: "kinkku" });
    const r = await w.app.inject({
      method: "POST",
      url: `/orders/${id}/add`,
      headers: {
        host: "demo.test",
        cookie: "canccu_session=mikko",
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "idempotency_key=own-two-0001&kind=custom&toppings=kinkku&toppings=ananas",
    });
    expect(r.statusCode).toBe(303);
    expect((await mine("mikko"))[0]?.label).toContain("kinkku, ananas");
  });

  it("offers no own pizza where the pizzeria has no base", async () => {
    const other = json(await open(w, "tero", grill)).id as string;
    const r = await view(w, "anni", `/orders/${other}/add`);
    expect(r.body).not.toContain("?tab=own");
  });

  it("takes Other as free text", async () => {
    expect((await view(w, "anni", `/orders/${id}/add?tab=other`)).body).toContain('maxlength="80"');
    await form(w, "anni", `/orders/${id}/add`, { kind: "text", text: "Gluten-free margherita" });
    expect((await mine())[0]?.label).toContain("Gluten-free margherita");
  });

  it("offers your last pizza from this pizzeria, one tap to add again (U6)", async () => {
    await form(w, "anni", `/orders/${id}/add`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, "12"),
      note: "no onion",
    });
    await step("cancel", { reason: "too late" });
    const next = json(await open(w, "pena", pz)).id as string;
    const r = await view(w, "anni", `/orders/${next}/add`);
    expect(r.body).toContain("Last time");
    expect(r.body).toContain("#12 Kebab · no onion");
    const again = await form(w, "anni", `/orders/${next}/add`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, "12"),
      note: "no onion",
    });
    expect(again.statusCode).toBe(303);
    expect(await mine("anni", next)).toMatchObject([{ label: "#12 Kebab", note: "no onion" }]);
  });

  it("says a refusal in words on the menu", async () => {
    const r = await form(w, "anni", `/orders/${id}/add`, { kind: "text", text: "" });
    expect(location(r)).toMatch(new RegExp(`^/pizza/orders/${id}/add\\?tab=other&error=`));
  });

  it("offers the orders still open when the order closed while you chose (E3)", async () => {
    const other = json(await open(w, "tero", grill)).id as string;
    await step("close");
    const r = await form(w, "anni", `/orders/${id}/add`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, "12"),
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Order 1 closed while you chose");
    expect(r.body).toContain("Your pizza was not added.");
    expect(r.body).toContain("Order 2 · Demo Grill");
    expect(r.body).toContain(`href="/pizza/orders/${other}/add"`);
  });
});

describe.skipIf(!DATABASE_URL)("your pizzas", () => {
  beforeEach(async () => {
    await form(w, "anni", `/orders/${id}/add`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, "12"),
      note: "no onion",
    });
  });

  it("are edited and removed while the order is open", async () => {
    const [p] = await mine();
    const edit = await view(w, "anni", `/orders/${id}/add?edit=${p?.id}`);
    expect(edit.body).toContain("no onion");
    const r = await form(w, "anni", `/orders/${id}/add`, {
      edit: p?.id ?? "",
      kind: "menu",
      menu_item_id: await itemId(w, pz, "3"),
      note: "extra cheese",
    });
    expect(location(r)).toBe(`/pizza/orders/${id}`);
    expect(await mine()).toMatchObject([{ label: "#3 Pepperoni", note: "extra cheese" }]);
    const del = await form(w, "anni", `/items/${p?.id}/delete`, { order_id: id });
    expect(location(del)).toBe(`/pizza/orders/${id}`);
    expect(await mine()).toEqual([]);
  });

  it("lock once the order is closed, and say whom to ask", async () => {
    await step("close");
    const r = await view(w, "anni", `/orders/${id}`);
    expect(r.body).toContain("Closed: Pena is calling");
    expect(r.body).toContain("The order is closed: ask Pena for a change.");
    expect(r.body).not.toContain("/delete");
  });
});

describe.skipIf(!DATABASE_URL)("my order", () => {
  beforeEach(async () => {
    await form(w, "anni", `/orders/${id}/add`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, "12"),
    });
  });

  it("shows the steps as they happen, with the estimate", async () => {
    let r = await view(w, "anni", `/orders/${id}`);
    expect(r.body).toContain("Open · closes 19:00");
    expect(r.body).toContain("What happens next");
    await step("place", { estimate_minutes: 40 });
    r = await view(w, "anni", `/orders/${id}`);
    expect(r.body).toContain("Called in 18:00");
    expect(r.body).toContain("about 18:40, the pizzeria said");
    expect(r.body).toContain("Collect from Pena");
  });

  it("says where to collect it, and ticks you off with I’ve got mine (U9)", async () => {
    await step("place");
    await step("arrive", { pickup: "Entrance table" });
    let r = await view(w, "anni", `/orders/${id}`);
    expect(r.body).toContain("Pizza is here");
    expect(r.body).toContain("Collect at Entrance table");
    expect(r.body).toContain("I’ve got mine");
    const got = await form(w, "anni", `/orders/${id}/got-mine`);
    expect(location(got)).toBe(`/pizza/orders/${id}`);
    expect((await mine())[0]?.handed_out).toBe(true);
    r = await view(w, "anni", `/orders/${id}`);
    expect(r.body).toContain("You’ve got yours");
  });

  it("says who cancelled it and why, and points to the open orders", async () => {
    await step("cancel", { reason: "the pizzeria is closed today" });
    const r = await view(w, "anni", `/orders/${id}`);
    expect(r.body).toContain("Order 1 was cancelled");
    expect(r.body).toContain("the pizzeria is closed today");
    expect(r.body).toContain("Your pizza was not ordered.");
    expect(r.body).toContain('href="/pizza/"');
  });

  it("offers to take over an order nobody holds", async () => {
    await step("release");
    const r = await view(w, "anni", `/orders/${id}`);
    expect(r.body).toContain("Nobody holds order 1");
    const take = await form(w, "anni", `/orders/${id}/step/claim`);
    expect(location(take)).toBe(`/pizza/hold/${id}`);
    expect(json(await w.call("anni", "GET", `/api/pizza/orders/${id}`)).you_hold).toBe(true);
  });

  it("shows a guest the order's state and the way to sign in, never who ordered", async () => {
    const r = await view(w, null, `/orders/${id}`);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Order 1 · Demo Pizzeria");
    expect(r.body).not.toContain("Anni");
    expect(r.body).toContain("Order with your Discord account");
  });

  it("sends a guest to sign in before the menu", async () => {
    const r = await view(w, null, `/orders/${id}/add`);
    expect(r.statusCode).toBe(303);
    expect(location(r)).toBe(
      `/admin/sign-in?next=${encodeURIComponent(`/pizza/orders/${id}/add`)}`,
    );
  });

  it("reads in Finnish", async () => {
    w.languages.set("demo", "fi");
    const r = await view(w, "anni", `/orders/${id}`);
    expect(r.body).toContain("Pizzasi");
  });
});
