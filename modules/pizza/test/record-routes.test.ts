/** The daily record and the export, per event day and for the whole event (O10, M4), and me/orders (D14). */
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
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";
import { must } from "./fixtures.js";

let pool: pg.Pool;
let w: World;
let pz: string;
let grill: string;

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
});

/** Day one: order 1 at the pizzeria, called in with a total; order 2 at the grill, called in without. Day two: order 1. */
async function twoDays(): Promise<string[]> {
  const margherita = await itemId(w, pz, "1");
  const one = json(await open(w, "pena", pz)).id as string;
  await w.call("anni", "POST", `/api/pizza/orders/${one}/items`, {
    kind: "menu",
    menu_item_id: margherita,
    comment: "split",
  });
  await w.call("anni", "POST", `/api/pizza/orders/${one}/items`, {
    kind: "menu",
    menu_item_id: margherita,
  });
  await w.call("pena", "POST", `/api/pizza/orders/${one}/items`, { kind: "text", text: "XL" });
  await w.call("pena", "POST", `/api/pizza/orders/${one}/place`, { at: "2026-10-29T16:20:00Z" });
  await w.call("pena", "PATCH", `/api/pizza/orders/${one}/money`, { total_cents: 3000 });
  const two = json(await open(w, "anni", grill)).id as string;
  await w.call("mikko", "POST", `/api/pizza/orders/${two}/items`, { kind: "text", text: "Burger" });
  await w.call("anni", "POST", `/api/pizza/orders/${two}/place`, {});
  w.advance(24 * 60);
  const three = json(await open(w, "mikko", pz)).id as string;
  await w.call("tero", "POST", `/api/pizza/orders/${three}/items`, {
    kind: "menu",
    menu_item_id: margherita,
  });
  await w.call("mikko", "POST", `/api/pizza/orders/${three}/place`, { at: "2026-10-30T15:00:00Z" });
  await w.call("mikko", "PATCH", `/api/pizza/orders/${three}/money`, { total_cents: 900 });
  return [one, two, three];
}

describe.skipIf(!DATABASE_URL)("the daily record", () => {
  it("needs pizza.record.read", async () => {
    expect((await w.call("crew", "GET", "/api/pizza/record")).statusCode).toBe(403);
    expect((await w.call("pena", "GET", "/api/pizza/export.csv")).statusCode).toBe(403);
  });
  it("groups the whole event by day, or one day, with amounts and flags", async () => {
    await twoDays();
    const all = json(await w.call("treasurer", "GET", "/api/pizza/record"));
    const days = all.days as {
      day: string;
      total_cents: number;
      orders: { seq: number; people: { name: string; amount_cents: number }[] }[];
    }[];
    expect(days.map((d) => [d.day, d.total_cents])).toEqual([
      ["2026-10-29", 3000],
      ["2026-10-30", 900],
    ]);
    expect(days[0]?.orders[0]?.people.map((p) => [p.name, p.amount_cents])).toEqual([
      ["Anni", 2000],
      ["Pena", 1000],
    ]);
    expect(all.flags).toEqual([
      {
        order_id: expect.any(String) as unknown,
        text: "2026-10-29 order 2 (Demo Grill): total missing",
      },
    ]);
    const one = json(await w.call("treasurer", "GET", "/api/pizza/record?day=2026-10-30"));
    expect((one.days as unknown[]).length).toBe(1);
    expect(errorOf(await w.call("treasurer", "GET", "/api/pizza/record?day=30.10.")).field).toBe(
      "day",
    );
  });
});

describe.skipIf(!DATABASE_URL)("the export", () => {
  it("writes the export spec's format, per day and for the whole event", async () => {
    await twoDays();
    const r = await w.call("treasurer", "GET", "/api/pizza/export.csv");
    expect(r.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(r.headers["content-disposition"]).toBe('attachment; filename="pizza-demo-all.csv"');
    expect(r.body).toBe(
      [
        "order_id,ordered_at,pizzeria,payer_nick,order_total,settle_to,nick,discord_id,units,amount",
        "2026-10-29-1,2026-10-29T18:20:00+02:00,Demo Pizzeria,Pena,30.00,organiser,Anni,,2,",
        "2026-10-29-1,2026-10-29T18:20:00+02:00,Demo Pizzeria,Pena,30.00,organiser,Pena,100000000000000001,1,",
        "2026-10-30-1,2026-10-30T17:00:00+02:00,Demo Pizzeria,Mikko,9.00,organiser,Tero,,1,9.00",
        "",
      ].join("\n"),
    );
    expect(r.headers["canccu-left-out"]).toBe("2026-10-29-2");
    const day = await w.call("treasurer", "GET", "/api/pizza/export.csv?day=2026-10-30");
    expect(day.body.split("\n")).toHaveLength(3);
    expect(day.headers["content-disposition"]).toBe(
      'attachment; filename="pizza-demo-2026-10-30.csv"',
    );
  });
  it("names the orders left out in the JSON answer", async () => {
    await twoDays();
    const r = json(await w.call("treasurer", "GET", "/api/pizza/export?day=2026-10-29"));
    expect(r).toMatchObject({
      file_name: "pizza-demo-2026-10-29.csv",
      left_out: [{ order_id: "2026-10-29-2", pizzeria: "Demo Grill", reason: "no_total" }],
    });
    expect(r.csv).toContain("2026-10-29-1,");
  });
  it("leaves out an order cancelled after call-in, which the record flags", async () => {
    const [one] = await twoDays();
    await w.call("crew", "POST", `/api/pizza/orders/${must(one)}/cancel`, {});
    expect((await w.call("treasurer", "GET", "/api/pizza/export.csv")).body).not.toContain(
      "2026-10-29-1,",
    );
    const flags = json(await w.call("treasurer", "GET", "/api/pizza/record")).flags as {
      text: string;
    }[];
    expect(flags.map((f) => f.text)).toContain(
      "2026-10-29 order 1 (Demo Pizzeria): cancelled after call-in, remove it in the payment system",
    );
  });
});

describe.skipIf(!DATABASE_URL)("the caller's own orders (D14)", () => {
  it("lists this event's orders with the caller's rows, status and amount", async () => {
    await twoDays();
    const r = json(await w.call("anni", "GET", "/api/pizza/me/orders"));
    const orders = r.orders as Record<string, unknown>[];
    expect(orders.map((o) => [o.seq, o.state, o.my_amount_cents, o.you_hold])).toEqual([
      [2, "placed", null, true],
      [1, "placed", 2000, false],
    ]);
    expect((orders[1]?.mine as unknown[]).length).toBe(2);
    expect((await w.call(null, "GET", "/api/pizza/me/orders")).statusCode).toBe(401);
  });
});
