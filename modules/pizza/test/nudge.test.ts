/**
 * The hand-out nudge (D12, mockup 09): once per order, from the holder or the crew, one
 * `pizza.reminder.triggered` to each person whose pizza is not ticked yet.
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
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";

let pool: pg.Pool;
let w: World;
let id: string;
const items: Record<string, string> = {};

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
  const { pz } = await seedPizzerias(w);
  const margherita = await itemId(w, pz, "1");
  id = json(await open(w, "pena", pz)).id as string;
  for (const who of ["anni", "mikko", "tero"]) {
    const r = await w.call(who, "POST", `/api/pizza/orders/${id}/items`, {
      kind: "menu",
      menu_item_id: margherita,
    });
    items[who] = json(r).id as string;
  }
  await w.call("pena", "POST", `/api/pizza/orders/${id}/place`);
});

const nudge = (who: string) => w.call(who, "POST", `/api/pizza/orders/${id}/nudge`);
const nudges = () =>
  w
    .events()
    .filter((e) => e.type === "pizza.reminder.triggered")
    .map((e) => [e.data.user_id, e.data.kind, e.data.role]);

describe.skipIf(!DATABASE_URL)("the nudge", () => {
  it("reaches each person not collected yet, once per order", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/arrive`, { pickup: "Entrance table" });
    await w.call("anni", "POST", `/api/pizza/items/${items.anni}/hand-out`, { handed_out: true });
    const r = await nudge("pena");
    expect(r.statusCode).toBe(200);
    expect(json(r).nudged_at).toBe(w.now.toISOString());
    expect(nudges()).toEqual([
      ["u_mikko", "not_collected", "member"],
      ["u_tero", "not_collected", "member"],
    ]);
    const again = await nudge("pena");
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe("nudged");
    expect(nudges()).toHaveLength(2);
  });

  it("is the holder's or the crew's, and only once the order is here", async () => {
    expect(errorOf(await nudge("pena")).code).toBe("not_arrived");
    await w.call("pena", "POST", `/api/pizza/orders/${id}/arrive`);
    expect(errorOf(await nudge("anni")).code).toBe("not_holder");
    expect((await nudge("crew")).statusCode).toBe(200);
  });
});
