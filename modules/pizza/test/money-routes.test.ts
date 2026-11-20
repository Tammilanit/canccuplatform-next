/**
 * Money on the order, in the API only (the step 5 plan, Money): the payer, the total, a price per
 * pizza, the split and settle to; who may change what, audited, and the person told (U14).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DATABASE_URL, errorOf, freshDatabase, itemId, json, open, seedPizzerias, world } from "./helpers.js";
import type { World } from "./helpers.js";

let pool: pg.Pool;
let w: World;
let pz: string;
let id: string;
let items: { anni: string; mikko: string };

beforeAll(async () => {
  if (DATABASE_URL) pool = await freshDatabase();
});
afterAll(async () => {
  await pool?.end();
});
beforeEach(async () => {
  if (!DATABASE_URL) return;
  await pool.query(
    "TRUNCATE pizza_pizzerias, pizza_menu_entries, pizza_orders, pizza_items, pizza_order_log, pizza_idempotency, pizza_outbox, pizza_outbox_tenants, pizza_tenants",
  );
  w = await world(pool);
  ({ pz } = await seedPizzerias(w));
  id = json(await open(w, "pena", pz)).id as string;
  const add = async (who: string, number: string) =>
    json(await w.call(who, "POST", `/api/pizza/orders/${id}/items`, { kind: "menu", menu_item_id: await itemId(w, pz, number) })).id as string;
  items = { anni: await add("anni", "1"), mikko: await add("mikko", "12") };
});

const money = (who = "pena") => w.call(who, "GET", `/api/pizza/orders/${id}/money`);
const patch = (who: string, body: unknown) => w.call(who, "PATCH", `/api/pizza/orders/${id}/money`, body);
const place = () => w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});

describe.skipIf(!DATABASE_URL)("money", () => {
  it("gives each person an exact amount as soon as they order, from the menu's prices (D7 B)", async () => {
    expect(json(await money())).toMatchObject({
      total_cents: null,
      split: null,
      split_effective: "exact",
      estimated: true,
      people: [
        { name: "Anni", units: 1, amount_cents: 800 },
        { name: "Mikko", units: 1, amount_cents: 950 },
      ],
    });
    expect(json(await w.call("anni", "GET", `/api/pizza/orders/${id}`)).my_amount_cents).toBe(800);
  });
  it("splits the extras per pizza once the total is in", async () => {
    await place();
    const r = await patch("pena", { total_cents: 1950 });
    expect(json(r)).toMatchObject({ total_cents: 1950, extras_cents: 200, people: [{ amount_cents: 900 }, { amount_cents: 1050 }] });
  });
  it("needs a call-in before a total (409 not_placed), and checks its range", async () => {
    expect(errorOf(await patch("pena", { total_cents: 100 })).code).toBe("not_placed");
    await place();
    expect(errorOf(await patch("pena", { total_cents: -5 })).field).toBe("total_cents");
  });
  it("takes exact only when every pizza is priced (409 prices_missing)", async () => {
    await w.call("pena", "PUT", `/api/pizza/items/${items.anni}/price`, { price_cents: null });
    expect(json(await money()).split_effective).toBe("even");
    expect(errorOf(await patch("pena", { split: "exact" })).code).toBe("prices_missing");
    expect(json(await patch("pena", { split: "even" })).split).toBe("even");
  });
  it("settles to the payer only when the event allows it (M1)", async () => {
    expect(errorOf(await patch("pena", { settle_to: "payer" })).code).toBe("settle_to_payer_off");
    w.settings.set("demo", { ...(await w.deps.settings("demo")), settle_to_payer: true });
    expect(json(await patch("pena", { settle_to: "payer" })).settle_to).toBe("payer");
  });
  it("lets the holder correct the payer to someone in the order; the crew too, audited", async () => {
    await place();
    expect(json(await patch("pena", { payer_user_id: "u_mikko" })).payer).toMatchObject({ name: "Mikko" });
    expect(errorOf(await patch("crew", { payer_user_id: "u_tero" })).field).toBe("payer_user_id");
    await patch("crew", { payer_user_id: "u_anni" });
    expect(w.audit.at(-1)).toMatchObject({ action: "pizza.order.money_changed", actor_user_id: "u_crew", changes: { payer: { old: "u_mikko", new: "u_anni" } } });
  });
  it("is the holder's until the event day turns at 06:00, the crew's after", async () => {
    await place();
    w.setNow("2026-10-30T03:59:00Z"); // 05:59 local
    expect((await patch("pena", { total_cents: 1800 })).statusCode).toBe(200);
    w.setNow("2026-10-30T04:00:00Z");
    expect(errorOf(await patch("pena", { total_cents: 1900 })).code).toBe("money_locked");
    expect((await patch("crew", { total_cents: 1900 })).statusCode).toBe(200);
  });
  it("keeps others out: members see only their own amount, the record reader sees all", async () => {
    expect((await money("anni")).statusCode).toBe(403);
    expect((await patch("anni", { split: "even" })).statusCode).toBe(403);
    expect((await money("treasurer")).statusCode).toBe(200);
    const member = JSON.stringify(json(await w.call("mikko", "GET", `/api/pizza/orders/${id}`)));
    expect(member).not.toContain("800");
  });
  it("tells the people whose amount changed after close, audits it, and puts no money on the bus", async () => {
    await place();
    await patch("pena", { total_cents: 1750 });
    const before = w.events().length;
    await w.call("pena", "PUT", `/api/pizza/items/${items.mikko}/price`, { price_cents: 1050 });
    const told = w.events().slice(before);
    expect(told).toEqual([
      expect.objectContaining({ type: "pizza.amount.changed", data: { order_id: id, user_ids: ["u_anni", "u_mikko"], actor_user_id: "u_pena" } }),
    ]);
    expect(w.audit.at(-1)).toMatchObject({ action: "pizza.order.money_changed", changes: { [`price:${items.mikko}`]: { old: 950, new: 1050 } } });
    for (const e of w.events()) expect(JSON.stringify(e.data)).not.toMatch(/total|price|amount_cents|cents/);
  });
  it("tells nobody while the order is still open", async () => {
    await w.call("pena", "PUT", `/api/pizza/items/${items.mikko}/price`, { price_cents: 1050 });
    expect(w.events().map((e) => e.type)).not.toContain("pizza.amount.changed");
  });
  it("refuses money changes on a cancelled order", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/cancel`, {});
    expect(errorOf(await patch("crew", { split: "even" })).code).toBe("cancelled");
  });
});
