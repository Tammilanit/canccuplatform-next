/** The legacy `pizza-orders` tests, continued: cancel (E10, D17) and idempotent writes (E2). */
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
let margherita: string;

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
  ({ pz } = await seedPizzerias(w));
  margherita = await itemId(w, pz, "1");
});

const post = (who: string | null, path: string, body: unknown = {}) =>
  w.call(who, "POST", `/api/pizza/${path}`, body);
const get = (who: string | null, path: string) => w.call(who, "GET", `/api/pizza/${path}`);
const opened = async (who = "pena", pizzeria = pz) =>
  json(await open(w, who, pizzeria)).id as string;

describe.skipIf(!DATABASE_URL)("cancel", () => {
  let id: string;
  beforeEach(async () => {
    id = await opened("pena");
  });
  it("is for the holder and the crew; a stranger gets 403 the same day", async () => {
    expect((await post("anni", `orders/${id}/cancel`)).statusCode).toBe(403);
    await post("anni", `orders/${id}/items`, { kind: "menu", menu_item_id: margherita });
    const r = await post("pena", `orders/${id}/cancel`, { reason: "The pizzeria is closed today" });
    expect(json(r)).toMatchObject({
      state: "cancelled",
      cancel_reason: "The pizzeria is closed today",
    });
    expect(w.events().at(-1)).toMatchObject({
      type: "pizza.order.cancelled",
      data: { reason: "cancelled", user_ids: ["u_anni"], actor_user_id: "u_pena" },
    });
    // E2: a repeat is a no-op without a second event.
    const sent = w.events().length;
    expect((await post("pena", `orders/${id}/cancel`)).statusCode).toBe(200);
    expect(w.events()).toHaveLength(sent);
  });
  it("lets any member cancel an order left over from an earlier day (E10), as stale", async () => {
    w.advance(24 * 60);
    expect(json(await get("anni", `orders/${id}`)).stale).toBe(true);
    expect((await post(null, `orders/${id}/cancel`)).statusCode).toBe(401);
    expect(json(await post("anni", `orders/${id}/cancel`)).state).toBe("cancelled");
    expect(w.events().at(-1)?.data).toMatchObject({ reason: "stale" });
    expect((await open(w, "anni", pz)).statusCode).toBe(201);
  });
  it("lets the crew cancel a called-in order, audited; the holder cannot", async () => {
    await post("pena", `orders/${id}/place`);
    expect(errorOf(await post("pena", `orders/${id}/cancel`)).code).toBe("placed");
    expect(json(await post("crew", `orders/${id}/cancel`, { reason: "never came" })).state).toBe(
      "cancelled",
    );
    expect(w.audit.at(-1)).toMatchObject({
      action: "pizza.order.cancelled",
      changes: { state: { old: "placed", new: "cancelled" } },
    });
  });
  it("never reopens a cancelled order, which keeps its pizzas", async () => {
    await post("anni", `orders/${id}/items`, { kind: "menu", menu_item_id: margherita });
    await post("pena", `orders/${id}/cancel`);
    expect(errorOf(await post("pena", `orders/${id}/reopen`)).code).toBe("cancelled");
    expect((await post("anni", `orders/${id}/claim`)).statusCode).toBe(409);
    expect(json(await get("crew", `orders/${id}`)).items).toHaveLength(1);
  });
  it("has no delete (D17)", async () => {
    expect((await w.call("crew", "DELETE", `/api/pizza/orders/${id}`)).statusCode).toBe(404);
  });
});

describe.skipIf(!DATABASE_URL)("idempotency (E2)", () => {
  it("answers a repeated close with the first answer and sends one event", async () => {
    const id = await opened("pena");
    const a = await w.call(
      "pena",
      "POST",
      `/api/pizza/orders/${id}/close`,
      {},
      { key: "close-once-1" },
    );
    const b = await w.call(
      "pena",
      "POST",
      `/api/pizza/orders/${id}/close`,
      {},
      { key: "close-once-1" },
    );
    expect(b.statusCode).toBe(a.statusCode);
    expect(json(b)).toEqual(json(a));
    expect(types(w.events()).filter((t) => t === "pizza.order.closed")).toHaveLength(1);
  });
  it("needs a key on every write", async () => {
    const id = await opened("pena");
    const r = await w.app.inject({
      method: "POST",
      url: `/api/pizza/orders/${id}/close`,
      headers: {
        host: "demo.test",
        cookie: "canccu_session=pena",
        "content-type": "application/json",
      },
      payload: "{}",
    });
    expect(r.statusCode).toBe(400);
  });
});
