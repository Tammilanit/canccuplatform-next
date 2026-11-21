/**
 * The module's own transitions (actor null), which #118's scheduler calls: auto-close and the
 * empty order's cancel (U3, E9), auto-release (the legacy 2 h rule), the timer's done (O7, the
 * forgotten orders), and the archive's cancel (E11). The pizza-db test is ported here too.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { assertTenantIsolation } from "@canccu/kit/testing";
import { withTenant } from "@canccu/kit";
import { scheduled } from "../src/lifecycle.js";
import {
  DATABASE_URL,
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

const run = (id: string, kind: Parameters<typeof scheduled>[3]) =>
  w.tx("demo", (c) => scheduled(c, w.deps, id, kind, w.now));
const state = async (id: string) => json(await w.call("crew", "GET", `/api/pizza/orders/${id}`));

describe.skipIf(!DATABASE_URL)("the scheduler's transitions", () => {
  let id: string;
  beforeEach(async () => {
    id = json(await open(w, "pena", pz)).id as string;
  });
  it("auto-closes an order with pizzas, actor null", async () => {
    await w.call("anni", "POST", `/api/pizza/orders/${id}/items`, {
      kind: "menu",
      menu_item_id: margherita,
    });
    expect(await run(id, "close")).toBe(true);
    expect((await state(id)).state).toBe("closed");
    expect(w.events().at(-1)).toMatchObject({
      type: "pizza.order.closed",
      data: { actor_user_id: null },
    });
  });
  it("cancels an empty order at its close time instead (E9)", async () => {
    await run(id, "close");
    expect(await state(id)).toMatchObject({ state: "cancelled" });
    expect(w.events().at(-1)).toMatchObject({
      type: "pizza.order.cancelled",
      data: { reason: "cancelled", actor_user_id: null },
    });
  });
  it("does nothing to an order that already moved on, and says so", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`, {});
    const before = w.events().length;
    expect(await run(id, "close")).toBe(false);
    expect(w.events()).toHaveLength(before);
  });
  it("auto-releases the holder only, with reason timeout, and the record flags it", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`, {});
    await run(id, "release");
    expect((await state(id)).holder).toBeNull();
    expect(w.events().at(-1)).toMatchObject({
      type: "pizza.order.released",
      data: { reason: "timeout", actor_user_id: null },
    });
    expect(json(await w.call("treasurer", "GET", "/api/pizza/record")).flags).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("released automatically") as unknown,
      }),
    ]);
  });
  it("takes a called-in order straight to done with reason timer, without arriving", async () => {
    await w.call("anni", "POST", `/api/pizza/orders/${id}/items`, {
      kind: "menu",
      menu_item_id: margherita,
    });
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
    await run(id, "done");
    expect(await state(id)).toMatchObject({ state: "done", done_reason: "timer" });
    expect(w.events().map((e) => e.type)).not.toContain("pizza.order.arrived");
    expect(w.events().at(-1)).toMatchObject({
      type: "pizza.order.done",
      data: { reason: "timer", actor_user_id: null },
    });
  });
  it("cancels a forgotten order never called in, actor null", async () => {
    await run(id, "cancel");
    expect((await state(id)).state).toBe("cancelled");
  });
  it("cancels open and closed orders when the event is archived (E11), and leaves placed ones", async () => {
    const grill = json(await w.call("menus", "POST", "/api/pizza/pizzerias", { name: "G" }))
      .id as string;
    const second = json(await open(w, "anni", grill)).id as string;
    await w.call("anni", "POST", `/api/pizza/orders/${second}/items`, { kind: "text", text: "x" });
    await w.call("anni", "POST", `/api/pizza/orders/${second}/place`, {});
    const { handleTenantEvent } = await import("../src/consumer.js");
    await withTenant("demo", () =>
      handleTenantEvent(w.deps, {
        id: "e1",
        type: "tenants.status.changed",
        version: 1,
        time: w.now.toISOString(),
        source: "tenants",
        tenant: "demo",
        data: { from: "live", to: "archived" },
      }),
    );
    expect((await state(id)).state).toBe("cancelled");
    expect((await state(second)).state).toBe("placed");
  });
});

describe.skipIf(!DATABASE_URL)("the tables (the legacy pizza-db test)", () => {
  it("backstops one open order per pizzeria with a partial unique index", async () => {
    await open(w, "pena", pz);
    await expect(
      w.tx("demo", (c) =>
        c.query(
          `INSERT INTO pizza_orders (id, day, seq, pizzeria_id, pizzeria_name, state, closes_at, opened_at)
           VALUES ('po_x', '2026-10-29', 9, $1, 'x', 'open', now(), now())`,
          [pz],
        ),
      ),
    ).rejects.toThrow(/pizza_orders_one_open/);
  });
  it("backstops one held order per person", async () => {
    const grill = json(await w.call("menus", "POST", "/api/pizza/pizzerias", { name: "G" }))
      .id as string;
    await open(w, "pena", pz);
    await expect(
      w.tx("demo", (c) =>
        c.query(
          `INSERT INTO pizza_orders (id, day, seq, pizzeria_id, pizzeria_name, state, closes_at, opened_at, holder_user_id, holder_name)
           VALUES ('po_y', '2026-10-29', 9, $1, 'x', 'open', now(), now(), 'u_pena', 'Pena')`,
          [grill],
        ),
      ),
    ).rejects.toThrow(/pizza_orders_one_held/);
  });
  it("keeps each event's orders to itself (RLS)", async () => {
    await assertTenantIsolation(
      {
        seed: async (tenant, marker) => {
          const p = json(
            await w.call(
              "menus",
              "POST",
              "/api/pizza/pizzerias",
              { name: marker },
              { host: `${tenant}.test` },
            ),
          ).id;
          expect(p).toBeTruthy();
        },
        read: async (tenant) => {
          const r = await w.call("pena", "GET", "/api/pizza/pizzerias", undefined, {
            host: `${tenant}.test`,
          });
          return JSON.stringify(json(r));
        },
      },
      ["demo", "two"],
    );
  });
});
