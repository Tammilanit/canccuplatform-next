/**
 * The demo event's food on the dev server (#715): the profile's `pizza` section applied and one
 * open demo order with several people, some marked paid; dev mode only, idempotent, never over
 * menus or orders made by hand, and `force` as the reset.
 */
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import type { SqlClient } from "@canccu/kit";
import {
  HAND_MADE_MENUS,
  LOADED_MENUS,
  NO_PIZZERIA,
  OPENED_ORDER,
  ORDER_LIVE,
  Refused,
  UP_TO_DATE_MENUS,
  demoPizzerias,
  seedDemoFood,
} from "../src/dev-seed.js";
import type { SeedDeps } from "../src/dev-seed.js";
import { DATABASE_URL, freshDatabase, json, types, world } from "./helpers.js";
import type { World } from "./helpers.js";

const PROFILE = fileURLToPath(new URL("../../../events/demo/", import.meta.url));

describe.skipIf(!DATABASE_URL)("the dev seed's food", () => {
  let pool: pg.Pool;
  let w: World;
  let pizzerias: unknown;

  beforeAll(async () => {
    pool = await freshDatabase();
    pizzerias = await demoPizzerias(PROFILE);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(
      `TRUNCATE pizza_pizzerias, pizza_menu_entries, pizza_orders, pizza_items, pizza_order_log,
         pizza_paid, pizza_outbox, pizza_due CASCADE`,
    );
    w = await world(pool);
  });

  const deps = (): SeedDeps => ({
    db: w.db,
    outbox: w.deps.outbox,
    now: () => w.now,
    filesRoot: w.filesRoot,
  });
  const seed = (o: { force?: boolean; version?: string; pizzerias?: unknown } = {}) =>
    seedDemoFood(deps(), {
      version: o.version ?? "dev",
      timeZone: "Europe/Helsinki",
      pizzerias: o.pizzerias ?? pizzerias,
      force: o.force ?? false,
    });
  const q = <T>(sql: string, args: unknown[] = []): Promise<T[]> =>
    w.tx("demo", async (c: SqlClient) => (await c.query(sql, args)).rows as T[]);
  const orders = () =>
    q<{ id: string; state: string; pizzeria_name: string; settle_to: string; payer_name: string }>(
      `SELECT id, state, pizzeria_name, settle_to, payer_name FROM pizza_orders ORDER BY opened_at`,
    );

  it("reads the demo profile's two pizzerias", () => {
    expect((pizzerias as { name: string }[]).map((p) => p.name)).toEqual([
      "Demo Pizzeria",
      "Demo Trattoria",
    ]);
  });

  it("is refused outside dev mode and changes nothing", async () => {
    await expect(seed({ version: "1.4.0" })).rejects.toThrow(Refused);
    expect(await q(`SELECT id FROM pizza_pizzerias`)).toEqual([]);
  });

  it("applies the profile's pizzerias and menus, and opens one demo order", async () => {
    expect(await seed()).toEqual([LOADED_MENUS, OPENED_ORDER]);
    const list = json(await w.call("u_alice", "GET", "/api/pizza/pizzerias")).pizzerias as {
      id: string;
      name: string;
    }[];
    expect(list.map((p) => p.name).sort()).toEqual(["Demo Pizzeria", "Demo Trattoria"]);
    const pz = list.find((p) => p.name === "Demo Pizzeria");
    const one = json(await w.call("u_alice", "GET", `/api/pizza/pizzerias/${pz?.id ?? ""}`));
    const menu = one.menu as { items: { number: string; price: number }[] };
    expect(menu.items.map((i) => i.number)).toEqual(["1", "3", "12", "20"]);

    const [order, ...more] = await orders();
    expect(more).toEqual([]);
    expect(order).toMatchObject({ state: "open", pizzeria_name: "Demo Pizzeria" });
    // Several people, settling to the holder, some of them marked paid (#704's demo order).
    const people = await q<{ name: string }>(
      `SELECT DISTINCT name FROM pizza_items WHERE order_id = $1`,
      [order?.id],
    );
    expect(people.length).toBeGreaterThanOrEqual(4);
    expect(order).toMatchObject({ settle_to: "payer", payer_name: "Alex" });
    const paid = await q(`SELECT user_id FROM pizza_paid WHERE order_id = $1`, [order?.id]);
    expect(paid.length).toBeGreaterThanOrEqual(2);
    expect(paid.length).toBeLessThan(people.length - 1);
    // Screens and the hub hear of it as of any order.
    expect(types(w.events())).toContain("pizza.order.opened");
    expect(types(w.events()).filter((t) => t === "pizza.item.added").length).toBe(people.length);
  });

  it("the order stays open through the event day", async () => {
    await seed();
    const [row] = await q<{ closes_at: Date }>(`SELECT closes_at FROM pizza_orders`);
    // T0 is 18:00 in Helsinki; the event day turns at 06:00, so it closes at 05:00.
    expect(row?.closes_at.toISOString()).toBe("2026-10-30T03:00:00.000Z");
  });

  it("a second run changes nothing", async () => {
    await seed();
    const before = w.events().length;
    expect(await seed()).toEqual([UP_TO_DATE_MENUS, ORDER_LIVE]);
    expect(w.events().length).toBe(before);
    expect((await orders()).length).toBe(1);
  });

  it("follows a changed profile while the menus are the seed's", async () => {
    await seed();
    const changed = structuredClone(pizzerias) as { items: { price: number }[] }[];
    const first = changed[0]?.items[0];
    if (first) first.price = 850;
    expect((await seed({ pizzerias: changed }))[0]).toBe(LOADED_MENUS);
    const [m] = await q<{ price_cents: number }>(
      `SELECT price_cents FROM pizza_menu_entries WHERE number = '1' AND hidden_at IS NULL
         AND pizzeria_id = (SELECT id FROM pizza_pizzerias WHERE name = 'Demo Pizzeria')`,
    );
    expect(m?.price_cents).toBe(850);
  });

  it("never over menus changed by hand", async () => {
    await seed();
    const [pz] = await q<{ id: string }>(
      `SELECT id FROM pizza_pizzerias WHERE name = 'Demo Trattoria'`,
    );
    const put = await w.call("menus", "PUT", `/api/pizza/pizzerias/${pz?.id ?? ""}/menu`, {
      items: [{ number: "4", name: "Margherita", price: 990 }],
    });
    expect(put.statusCode).toBe(200);
    const changed = structuredClone(pizzerias) as { phone: string }[];
    if (changed[0]) changed[0].phone = "+000 999 9999";
    expect((await seed({ pizzerias: changed }))[0]).toBe(HAND_MADE_MENUS);
    const [m] = await q<{ price_cents: number }>(
      `SELECT price_cents FROM pizza_menu_entries WHERE pizzeria_id = $1 AND number = '4'`,
      [pz?.id],
    );
    expect(m?.price_cents).toBe(990);
  });

  it("menus made by hand before any seed keep it out", async () => {
    const add = await w.call("menus", "POST", "/api/pizza/pizzerias", { name: "Corner Grill" });
    expect(add.statusCode).toBe(201);
    expect(await seed()).toEqual([HAND_MADE_MENUS, NO_PIZZERIA]);
    expect((await q<{ name: string }>(`SELECT name FROM pizza_pizzerias`)).length).toBe(1);
  });

  it("leaves an order under way alone, and opens a new demo order once none is", async () => {
    await seed();
    const [first] = await orders();
    const cancel = await w.call("crew", "POST", `/api/pizza/orders/${first?.id ?? ""}/cancel`, {
      reason: "demo over",
    });
    expect(cancel.statusCode).toBe(200);
    w.advance(5);
    expect((await seed())[1]).toBe(OPENED_ORDER);
    const after = await orders();
    expect(after.map((o) => o.state)).toEqual(["cancelled", "open"]);
  });

  it("force re-applies the menus over hand changes and opens a fresh demo order", async () => {
    await seed();
    const [pz] = await q<{ id: string }>(
      `SELECT id FROM pizza_pizzerias WHERE name = 'Demo Trattoria'`,
    );
    await w.call("menus", "PUT", `/api/pizza/pizzerias/${pz?.id ?? ""}/menu`, {
      items: [{ number: "4", name: "Margherita", price: 990 }],
    });
    w.advance(1);
    expect(await seed({ force: true })).toEqual([LOADED_MENUS, OPENED_ORDER]);
    const [m] = await q<{ price_cents: number }>(
      `SELECT price_cents FROM pizza_menu_entries WHERE pizzeria_id = $1 AND number = '4'
         AND hidden_at IS NULL`,
      [pz?.id],
    );
    expect(m?.price_cents).toBe(800);
    expect((await orders()).map((o) => o.state)).toEqual(["cancelled", "open"]);
  });

  it("other events are untouched", async () => {
    await seed();
    const rows = await w.tx(
      "two",
      async (c) => (await c.query(`SELECT id FROM pizza_orders`)).rows,
    );
    expect(rows).toEqual([]);
  });
});
