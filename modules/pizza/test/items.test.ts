/**
 * The legacy `pizza-routes` tests, adapted to sign-in: adding and editing pizzas, the per-person
 * cap, and who sees what (D9, U15) with members only (E15).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  DATABASE_URL,
  errorOf,
  freshDatabase,
  itemId,
  json,
  open,
  seedPizzerias,
  types,
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";

let pool: pg.Pool;
let w: World;
let pz: string;
let grill: string;
let margherita: string;
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
    "TRUNCATE pizza_receipts, pizza_paid, pizza_pay_details, pizza_reader_keys, pizza_reads, pizza_due, pizza_crew, pizza_pizzerias, pizza_menu_entries, pizza_orders, pizza_items, pizza_order_log, pizza_idempotency, pizza_outbox, pizza_outbox_tenants, pizza_tenants",
  );
  w = await world(pool);
  ({ pz, grill } = await seedPizzerias(w));
  margherita = await itemId(w, pz, "1");
  id = json(await open(w, "pena", pz)).id as string;
});

const add = (who: string | null, body: Record<string, unknown>, order = id) =>
  w.call(who, "POST", `/api/pizza/orders/${order}/items`, body);
const mine = { kind: "menu", note: "no onion", comment: "split with Pena" };
const get = (who: string | null, o: { host?: string; ip?: string } = {}) =>
  w.call(who, "GET", `/api/pizza/orders/${id}`, undefined, o);

describe.skipIf(!DATABASE_URL)("adding pizzas", () => {
  it("adds a member's pizza with its snapshot and price, and counts it on the bus", async () => {
    const r = await add("anni", { ...mine, menu_item_id: margherita });
    expect(r.statusCode).toBe(201);
    expect(json(r)).toMatchObject({
      label: "#1 Margherita",
      price_cents: 800,
      note: "no onion",
      mine: true,
    });
    expect(w.events().at(-1)).toMatchObject({
      type: "pizza.item.added",
      data: {
        order_id: id,
        user_id: "u_anni",
        pizza_count: 1,
        people_count: 1,
        order_revision: 2,
        person: { name: "Anni" },
      },
    });
  });
  it("needs sign-in and membership (E15)", async () => {
    expect((await add(null, { ...mine, menu_item_id: margherita })).statusCode).toBe(401);
    const r = await add("outsider", { ...mine, menu_item_id: margherita });
    expect(r.statusCode).toBe(403);
    expect(errorOf(r).code).toBe("not_a_member");
  });
  it("refuses a body that is not JSON (415) and a bad one with the field (400)", async () => {
    const t = await w.call("anni", "POST", `/api/pizza/orders/${id}/items`, undefined, {
      raw: "x",
      contentType: "text/plain",
    });
    expect(t.statusCode).toBe(415);
    const r = await add("anni", { kind: "menu", menu_item_id: "mi_999" });
    expect(r.statusCode).toBe(400);
    expect(errorOf(r)).toMatchObject({ code: "invalid_request", field: "menu_item_id" });
  });
  it("refuses an item of another pizzeria", async () => {
    const burger = await itemId(w, grill, "1");
    expect(errorOf(await add("anni", { kind: "menu", menu_item_id: burger })).field).toBe(
      "menu_item_id",
    );
  });
  it("caps one person's pizzas in one order (U18), 5 by default", async () => {
    for (let i = 0; i < 5; i++)
      expect((await add("anni", { kind: "text", text: `#${i}` })).statusCode).toBe(201);
    const r = await add("anni", { kind: "text", text: "sixth" });
    expect(r.statusCode).toBe(409);
    expect(errorOf(r).code).toBe("item_limit");
    expect((await add("mikko", { kind: "text", text: "mine" })).statusCode).toBe(201);
  });
  it("accepts pizzas past the close time while the order is still open", async () => {
    w.advance(120);
    expect((await add("anni", { ...mine, menu_item_id: margherita })).statusCode).toBe(201);
  });
  it("answers 409 closed with the other open orders once it is closed (E3)", async () => {
    const other = json(await open(w, "anni", grill)).id as string;
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`, {});
    const r = await add("mikko", { ...mine, menu_item_id: margherita });
    expect(r.statusCode).toBe(409);
    expect(errorOf(r)).toMatchObject({ code: "closed", open_orders: [{ id: other, seq: 2 }] });
  });
  it("keeps what was ordered when the menu changes (D15, E7)", async () => {
    await add("anni", { kind: "custom", toppings: ["kinkku"] });
    await add("mikko", { kind: "menu", menu_item_id: margherita });
    await w.call("menus", "PUT", `/api/pizza/pizzerias/${pz}/menu`, {
      base: { name: "Uusi pohja", price: 1 },
      items: [{ number: "1", name: "Margherita deluxe", price: 1500 }],
      toppings: [],
    });
    const items = json(await get("pena")).items as { label: string; price_cents: number }[];
    expect(items.map((i) => [i.label, i.price_cents])).toEqual([
      ["Oma pizza: kinkku", 800],
      ["#1 Margherita", 800],
    ]);
  });
});

describe.skipIf(!DATABASE_URL)("editing and removing", () => {
  let item: string;
  beforeEach(async () => {
    item = json(await add("anni", { ...mine, menu_item_id: margherita })).id as string;
  });
  it("lets the owner edit and remove; others get 403 not_owner", async () => {
    expect(
      (await w.call("anni", "PUT", `/api/pizza/items/${item}`, { kind: "text", text: "XL" }))
        .statusCode,
    ).toBe(200);
    const stranger = await w.call("mikko", "PUT", `/api/pizza/items/${item}`, {
      kind: "text",
      text: "no",
    });
    expect(stranger.statusCode).toBe(403);
    expect(errorOf(stranger).code).toBe("not_owner");
    expect((await w.call("mikko", "DELETE", `/api/pizza/items/${item}`)).statusCode).toBe(403);
    expect((await w.call("anni", "DELETE", `/api/pizza/items/${item}`)).statusCode).toBe(204);
    expect((await w.call("anni", "DELETE", `/api/pizza/items/${item}`)).statusCode).toBe(404);
    expect(types(w.events()).at(-1)).toBe("pizza.item.removed");
  });
  it("after close: the owner is refused, the holder edits, the owner is told and it is audited (U14)", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`, {});
    expect(
      errorOf(await w.call("anni", "PUT", `/api/pizza/items/${item}`, { kind: "text", text: "x" }))
        .code,
    ).toBe("closed");
    const r = await w.call("pena", "PUT", `/api/pizza/items/${item}`, {
      kind: "text",
      text: "no #1 today",
    });
    expect(r.statusCode).toBe(200);
    expect(w.events().at(-1)).toMatchObject({
      type: "pizza.item.changed",
      data: { item_id: item, user_id: "u_anni", actor_user_id: "u_pena" },
    });
    expect(w.audit.at(-1)).toMatchObject({
      action: "pizza.item.changed",
      changes: { label: { old: "#1 Margherita", new: "Other: no #1 today" } },
    });
    const h = json(await w.call("pena", "GET", `/api/pizza/orders/${id}/history`)).entries as {
      kind: string;
    }[];
    expect(h.at(-1)?.kind).toBe("item_changed");
  });
  it("lets the crew remove a pizza from a called-in order, which tells the owner", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
    expect((await w.call("crew", "DELETE", `/api/pizza/items/${item}`)).statusCode).toBe(204);
    expect(w.events().at(-1)).toMatchObject({
      type: "pizza.item.removed",
      data: { user_id: "u_anni", actor_user_id: "u_crew" },
    });
    expect(w.audit.at(-1)?.action).toBe("pizza.item.removed");
  });
  it("refuses changes to a done or cancelled order", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/cancel`, {});
    expect(
      errorOf(await w.call("crew", "PUT", `/api/pizza/items/${item}`, { kind: "text", text: "x" }))
        .code,
    ).toBe("cancelled");
  });
});

describe.skipIf(!DATABASE_URL)("who sees what (D9, U15)", () => {
  beforeEach(async () => {
    await add("anni", { ...mine, menu_item_id: margherita });
    await add("anni", { kind: "menu", menu_item_id: margherita });
    await add("mikko", { kind: "text", text: "Kebab XL", comment: "for a friend" });
  });
  it("shows a member the counts and pizzas without names, and their own rows in full", async () => {
    const d = json(await get("mikko"));
    expect(d.holder).toMatchObject({ name: "Pena" });
    expect(d.lines).toEqual([
      { count: 2, label: "#1 Margherita" },
      { count: 1, label: "Other: Kebab XL" },
    ]);
    expect(d.items).toBeUndefined();
    expect(d.mine).toEqual([
      expect.objectContaining({
        label: "Other: Kebab XL",
        comment: "for a friend",
        price_cents: null,
      }),
    ]);
    const text = JSON.stringify(d);
    expect(text).not.toContain("Anni");
    expect(text).not.toContain("no onion");
    expect(text).not.toContain("split with");
    expect(text).not.toContain("+000");
  });
  it("shows the holder and the crew names, notes, comments and the pizzeria's phone", async () => {
    for (const who of ["pena", "crew"]) {
      const d = json(await get(who));
      expect(d.items).toHaveLength(3);
      expect(d.items).toContainEqual(
        expect.objectContaining({ name: "Anni", note: "no onion", comment: "split with Pena" }),
      );
      expect(d.pizzeria).toMatchObject({ phone: "+000 000 0000" });
    }
  });
  it("shows a guest counts only, no names, when the info pages are public (U15)", async () => {
    const d = json(await get(null));
    expect(d).toMatchObject({
      state: "open",
      pizza_count: 3,
      people_count: 2,
      pizzeria: { name: "Demo Pizzeria" },
    });
    expect(d.holder).toBeUndefined();
    expect(d.lines).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/Pena|Anni|Mikko|Kebab/);
    const list = json(await w.call(null, "GET", "/api/pizza/orders"));
    expect(JSON.stringify(list)).not.toMatch(/Pena|Anni/);
  });
  it("refuses a guest where the info pages are closed, and away from the venue for venue_only", async () => {
    const closedOrders = await w.call(null, "GET", "/api/pizza/orders", undefined, {
      host: "closed.test",
    });
    expect(closedOrders.statusCode).toBe(403);
    expect(errorOf(closedOrders).code).toBe("info_pages_closed");
    expect(
      (
        await w.call(null, "GET", "/api/pizza/orders", undefined, {
          host: "venue.test",
          ip: "192.0.2.1",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await w.call(null, "GET", "/api/pizza/orders", undefined, {
          host: "venue.test",
          ip: "10.0.0.7",
        })
      ).statusCode,
    ).toBe(200);
  });
  it("shows a signed-in non-member what a guest sees", async () => {
    const d = json(await get("outsider"));
    expect(d.holder).toBeUndefined();
    expect(d.pizza_count).toBe(3);
  });
  it("keeps the summary and the history for the holder and the crew", async () => {
    expect((await w.call("anni", "GET", `/api/pizza/orders/${id}/summary`)).statusCode).toBe(403);
    const s = json(await w.call("pena", "GET", `/api/pizza/orders/${id}/summary`));
    expect(s.text).toContain("1 × #1 Margherita — no onion");
    expect(s.text).not.toContain("split with");
    expect((await w.call("anni", "GET", `/api/pizza/orders/${id}/history`)).statusCode).toBe(403);
  });
  it("uses no guessable ids", () => {
    expect(id).toMatch(/^po_[A-Za-z0-9_-]{16,}$/);
  });
  it("lets a crew right count only from where admin is reachable (admin_access)", async () => {
    const venue = { host: "restricted.test", ip: "10.0.0.7" };
    const away = { host: "restricted.test", ip: "192.0.2.9" };
    const refused = await w.call("menus", "POST", "/api/pizza/pizzerias", { name: "R" }, away);
    expect(errorOf(refused).code).toBe("admin_access_restricted");
    const p = json(await w.call("menus", "POST", "/api/pizza/pizzerias", { name: "R" }, venue)).id;
    const body = { pizzeria_id: p, closes_at: "2026-10-29T17:00:00Z" };
    const o = json(await w.call("pena", "POST", "/api/pizza/orders", body, away)).id as string;
    const take = await w.call("crew", "POST", `/api/pizza/orders/${o}/take-over`, {}, away);
    expect(take.statusCode).toBe(403);
    expect(errorOf(take).code).toBe("admin_access_restricted");
    const read = json(await w.call("crew", "GET", `/api/pizza/orders/${o}`, undefined, away));
    expect(read.items).toBeUndefined(); // a member's view away from the venue
    expect(
      (await w.call("crew", "POST", `/api/pizza/orders/${o}/take-over`, {}, venue)).statusCode,
    ).toBe(200);
  });
});
