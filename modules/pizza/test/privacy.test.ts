/**
 * Personal data (O6, contracts/README.md Privacy): the export and delete, the 12-month
 * anonymisation, a deleted user and event, a member who leaves (E5), and clone with an event.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { handlePlatformEvent, handleTenantEvent } from "../src/consumer.js";
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
import { must } from "./fixtures.js";

let pool: pg.Pool;
let w: World;
let pz: string;
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
    "TRUNCATE pizza_pizzerias, pizza_menu_entries, pizza_orders, pizza_items, pizza_order_log, pizza_idempotency, pizza_outbox, pizza_outbox_tenants, pizza_tenants",
  );
  w = await world(pool);
  ({ pz } = await seedPizzerias(w));
  id = json(await open(w, "pena", pz)).id as string;
  const margherita = await itemId(w, pz, "1");
  await w.call("anni", "POST", `/api/pizza/orders/${id}/items`, {
    kind: "menu",
    menu_item_id: margherita,
    comment: "for a friend",
  });
  await w.call("mikko", "POST", `/api/pizza/orders/${id}/items`, {
    kind: "menu",
    menu_item_id: margherita,
  });
  await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
  await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, { total_cents: 1700 });
});

const event = (
  type: string,
  data: Record<string, unknown>,
  tenant: string | null = "demo",
): Event => ({
  id: `e_${type}_${Math.random()}`,
  type,
  version: 1,
  time: w.now.toISOString(),
  source: "tenants",
  ...(tenant === null ? {} : { tenant }),
  data,
});
const asTenant = (e: Event) => withTenant(e.tenant ?? "", () => handleTenantEvent(w.deps, e));
const crewView = async () => json(await w.call("crew", "GET", `/api/pizza/orders/${id}`));
const text = async () =>
  JSON.stringify(await crewView()) +
  JSON.stringify(json(await w.call("crew", "GET", `/api/pizza/orders/${id}/history`)));

describe.skipIf(!DATABASE_URL)("the privacy export and delete", () => {
  it("exports everything held on the caller at this event", async () => {
    const r = json(await w.call("anni", "GET", "/api/pizza/me/export"));
    expect(r.items).toEqual([
      expect.objectContaining({
        order_id: id,
        label: "#1 Margherita",
        comment: "for a friend",
        price_cents: 800,
      }),
    ]);
    expect(r.amounts).toEqual([{ order_id: id, amount_cents: 850 }]);
    const holder = json(await w.call("pena", "GET", "/api/pizza/me/export"));
    expect(holder.orders).toEqual([
      expect.objectContaining({ order_id: id, held: true, opened: true, paid: true }),
    ]);
    expect((holder.history as unknown[]).length).toBeGreaterThan(0);
    expect((await w.call(null, "GET", "/api/pizza/me/export")).statusCode).toBe(401);
  });
  it("deletes it: the caller's rows lose their name and id; the counts and the total stay", async () => {
    expect((await w.call("anni", "DELETE", "/api/pizza/me")).statusCode).toBe(204);
    const after = await crewView();
    expect(after).toMatchObject({ pizza_count: 2, people_count: 2, total_cents: 1700 });
    expect(await text()).not.toMatch(/Anni|u_anni|for a friend/);
    expect(json(await w.call("anni", "GET", "/api/pizza/me/export")).items).toEqual([]);
  });
  it("takes the caller's pizzas out of an order still open, which they can no longer collect", async () => {
    const grill = json(await w.call("menus", "POST", "/api/pizza/pizzerias", { name: "G" }))
      .id as string;
    const second = json(await open(w, "mikko", grill)).id as string;
    await w.call("anni", "POST", `/api/pizza/orders/${second}/items`, { kind: "text", text: "x" });
    await w.call("anni", "DELETE", "/api/pizza/me");
    expect(json(await w.call("crew", "GET", `/api/pizza/orders/${second}`)).pizza_count).toBe(0);
  });
  it("drops other people's stored answers that name the deleted person", async () => {
    const stored = async () =>
      (
        await pool.query(
          `SELECT user_id || ' ' || key AS k, coalesce(body::text, '') AS b FROM pizza_idempotency`,
        )
      ).rows as { k: string; b: string }[];
    const naming = (b: string) => /u_anni|Anni/.test(b);
    const before = await stored();
    // The holder's call-in answered with every pizza and its person: Anni among them.
    expect(before.some((r) => !r.k.startsWith("u_anni ") && naming(r.b))).toBe(true);
    const kept = before.filter((r) => !r.k.startsWith("u_anni ") && !naming(r.b)).map((r) => r.k);
    expect(kept.length).toBeGreaterThan(0);
    await w.call("anni", "DELETE", "/api/pizza/me");
    const after = await stored();
    expect(after.filter((r) => naming(r.b))).toEqual([]);
    // Answers that name nobody deleted stay, so their retries still answer without acting twice.
    expect(after.map((r) => r.k)).toEqual(expect.arrayContaining(kept));
  });
  it("drops the stored answers that name a deleted user, in every event", async () => {
    await handlePlatformEvent(w.deps, event("tenants.user.deleted", { user_id: "u_anni" }, null));
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pizza_idempotency WHERE strpos(body::text, 'u_anni') > 0`,
    );
    expect((rows[0] as { n: number }).n).toBe(0);
  });
  it("clears the holder and the payer of a holder who deletes", async () => {
    await w.call("pena", "DELETE", "/api/pizza/me");
    const after = await crewView();
    expect(after.holder).toBeNull();
    expect(after.payer).toBeNull();
    expect(await text()).not.toMatch(/Pena|u_pena/);
  });
});

describe.skipIf(!DATABASE_URL)("retention and the tenants events", () => {
  it("anonymises every person 12 months after the event (personal), totals and counts kept", async () => {
    await asTenant(event("tenants.retention.reached", { data_class: "personal" }));
    const after = await crewView();
    expect(after).toMatchObject({
      pizza_count: 2,
      people_count: 2,
      total_cents: 1700,
      holder: null,
    });
    expect(await text()).not.toMatch(/Pena|Anni|Mikko|u_pena|u_anni|u_mikko|for a friend/);
    const record = json(await w.call("treasurer", "GET", "/api/pizza/record"));
    expect((record.days as { total_cents: number }[])[0]?.total_cents).toBe(1700);
  });
  it("ignores the presence class: pizza holds none", async () => {
    await asTenant(event("tenants.retention.reached", { data_class: "presence" }));
    expect(await text()).toContain("Anni");
  });
  it("forgets a deleted user in every event", async () => {
    await handlePlatformEvent(w.deps, event("tenants.user.deleted", { user_id: "u_anni" }, null));
    expect(await text()).not.toMatch(/Anni|u_anni/);
    expect(await text()).toContain("Mikko");
  });
  it("deletes a deleted event's data", async () => {
    await handlePlatformEvent(w.deps, event("tenants.tenant.deleted", { tenant_id: "demo" }, null));
    expect((await w.call("crew", "GET", `/api/pizza/orders/${id}`)).statusCode).toBe(404);
    expect(json(await w.call("pena", "GET", "/api/pizza/pizzerias")).pizzerias).toEqual([]);
  });
  it("releases a leaving member's holds and drops their pizzas from open orders (E5)", async () => {
    const grill = json(await w.call("menus", "POST", "/api/pizza/pizzerias", { name: "G" }))
      .id as string;
    const second = json(await open(w, "anni", grill)).id as string;
    await w.call("anni", "POST", `/api/pizza/orders/${second}/items`, { kind: "text", text: "x" });
    await w.call("mikko", "POST", `/api/pizza/orders/${second}/items`, { kind: "text", text: "y" });
    await asTenant(event("tenants.member.left", { user_id: "u_anni", actor_user_id: "u_anni" }));
    const o = json(await w.call("crew", "GET", `/api/pizza/orders/${second}`));
    expect(o).toMatchObject({ holder: null, pizza_count: 1 });
    expect(
      w
        .events()
        .filter((e) => e.type === "pizza.order.released")
        .at(-1)?.data,
    ).toMatchObject({ reason: "released", actor_user_id: null });
    expect((await crewView()).pizza_count).toBe(2); // a called-in order keeps theirs
  });
});

describe.skipIf(!DATABASE_URL)("clone with an event", () => {
  it("copies the source's pizzerias and menus into an event that has none, once", async () => {
    const clone = event(
      "tenants.tenant.cloned",
      { source_tenant_id: "demo", shift_seconds: 0, actor_user_id: "u_admin" },
      "two",
    );
    await asTenant(clone);
    await asTenant(clone);
    const list = json(
      await w.call("pena", "GET", "/api/pizza/pizzerias", undefined, { host: "two.test" }),
    ).pizzerias as { id: string; name: string }[];
    expect(list.map((p) => p.name)).toEqual(["Demo Grill", "Demo Pizzeria"]);
    const copy = json(
      await w.call("pena", "GET", `/api/pizza/pizzerias/${must(list[1]).id}`, undefined, {
        host: "two.test",
      }),
    );
    expect(copy.phone).toBeUndefined();
    expect(copy.website).toBe("https://pizzeria.example");
    const menu = copy.menu as {
      items: { number: string; price_cents: number }[];
      base: { name: string };
      toppings: unknown[];
    };
    expect(menu.items.map((i) => [i.number, i.price_cents])).toEqual([
      ["1", 800],
      ["3", 900],
      ["12", 950],
      ["20", null],
    ]);
    expect(menu.base.name).toBe("Oma pizza");
    expect(menu.toppings).toHaveLength(2);
    expect(
      json(await w.call("crew", "GET", "/api/pizza/orders", undefined, { host: "two.test" }))
        .orders,
    ).toEqual([]);
  });
});
