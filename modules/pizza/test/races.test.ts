/**
 * Concurrency (E1, E2, E12), sized for a party of about 70 (O1): every transition is one
 * conditional update, so of two racing requests one wins, and every change sends one event.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DATABASE_URL, errorOf, freshDatabase, itemId, json, open, seedPizzerias, types, world } from "./helpers.js";
import type { World } from "./helpers.js";

let pool: pg.Pool;
let w: World;
let pz: string;
let grill: string;
let margherita: string;

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
  ({ pz, grill } = await seedPizzerias(w));
  margherita = await itemId(w, pz, "1");
});

const people = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const statuses = (rs: { statusCode: number }[]) => rs.map((r) => r.statusCode).sort();

describe.skipIf(!DATABASE_URL)("races", () => {
  it("takes 70 people joining at once, each pizza counted once, revisions in order", async () => {
    const id = json(await open(w, "pena", pz)).id as string;
    const rs = await Promise.all(
      people(70).map((p) => w.call(p, "POST", `/api/pizza/orders/${id}/items`, { kind: "menu", menu_item_id: margherita })),
    );
    expect(rs.every((r) => r.statusCode === 201)).toBe(true);
    const d = json(await w.call("pena", "GET", `/api/pizza/orders/${id}`));
    expect(d).toMatchObject({ pizza_count: 70, people_count: 70, revision: 71 });
    const added = w.events().filter((e) => e.type === "pizza.item.added");
    expect(added).toHaveLength(70);
    expect(added.map((e) => e.data.order_revision).sort((a, b) => Number(a) - Number(b))).toEqual(
      Array.from({ length: 70 }, (_, i) => i + 2),
    );
    expect(new Set(added.map((e) => e.data.pizza_count)).size).toBe(70);
  });

  it("holds the per-person cap when one person adds ten at once", async () => {
    const id = json(await open(w, "pena", pz)).id as string;
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => w.call("anni", "POST", `/api/pizza/orders/${id}/items`, { kind: "text", text: `t${i}` })),
    );
    expect(statuses(rs)).toEqual([201, 201, 201, 201, 201, 409, 409, 409, 409, 409]);
  });

  it("lets one of twenty claims win; the rest get 409 claimed with the holder (E1)", async () => {
    const id = json(await open(w, "pena", pz)).id as string;
    await w.call("pena", "POST", `/api/pizza/orders/${id}/release`, {});
    const rs = await Promise.all(people(20).map((p) => w.call(p, "POST", `/api/pizza/orders/${id}/claim`, {})));
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const winner = json(rs.find((r) => r.statusCode === 200)!).holder as { name: string };
    for (const r of rs.filter((x) => x.statusCode !== 200)) {
      expect(r.statusCode).toBe(409);
      expect(errorOf(r)).toMatchObject({ code: "claimed", holder: winner.name });
    }
    expect(types(w.events()).filter((t) => t === "pizza.order.claimed")).toHaveLength(1);
  });

  it("lets one of two crews' take-overs win, one event each", async () => {
    const id = json(await open(w, "pena", pz)).id as string;
    const rs = await Promise.all(["crew", "admin"].map((c) => w.call(c, "POST", `/api/pizza/orders/${id}/take-over`, {})));
    // Both may win in turn (a take-over takes a held order), but never lose an event.
    const ok = rs.filter((r) => r.statusCode === 200).length;
    expect(types(w.events()).filter((t) => t === "pizza.order.claimed")).toHaveLength(ok);
  });

  it("opens one order per pizzeria when ten open at once", async () => {
    const rs = await Promise.all(people(10).map((p) => open(w, p, pz)));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.statusCode === 409).every((r) => errorOf(r).code === "another_open")).toBe(true);
  });

  it("keeps to the event's limit of open orders when pizzerias open at once (O5)", async () => {
    const s = await w.deps.settings("demo");
    w.settings.set("demo", { ...s, max_open_orders: 1 });
    const rs = await Promise.all([open(w, "pena", pz), open(w, "anni", grill)]);
    expect(statuses(rs)).toEqual([201, 409]);
  });

  it("gives one seq per order, even when they open at once", async () => {
    const third = json(await w.call("menus", "POST", "/api/pizza/pizzerias", { name: "Third" })).id as string;
    const rs = await Promise.all([open(w, "pena", pz), open(w, "anni", grill), open(w, "mikko", third)]);
    expect(rs.map((r) => json(r).seq).sort()).toEqual([1, 2, 3]);
  });

  it.each([
    ["close", [], "pizza.order.closed"],
    ["place", ["close"], "pizza.order.placed"],
    ["arrive", ["place"], "pizza.order.arrived"],
    ["done", ["place", "arrive"], "pizza.order.done"],
    ["undo", ["place"], "pizza.order.reverted"],
    ["cancel", [], "pizza.order.cancelled"],
    ["release", [], "pizza.order.released"],
    ["reopen", ["close"], "pizza.order.reopened"],
  ])("runs %s once when the holder and the crew press it at once", async (step, before, type) => {
    const id = json(await open(w, "pena", pz)).id as string;
    await w.call("anni", "POST", `/api/pizza/orders/${id}/items`, { kind: "menu", menu_item_id: margherita });
    for (const b of before) await w.call("pena", "POST", `/api/pizza/orders/${id}/${b}`, {});
    const sent = w.events().length;
    const rs = await Promise.all(
      ["pena", "crew", "pena", "crew"].map((who) => w.call(who, "POST", `/api/pizza/orders/${id}/${step}`, {})),
    );
    expect(rs.filter((r) => r.statusCode === 200).length).toBeGreaterThanOrEqual(1);
    // The loser is told why: 409 for a step already taken, 403 once the release left it unheld.
    expect(rs.every((r) => [200, 403, 409].includes(r.statusCode))).toBe(true);
    expect(types(w.events().slice(sent)).filter((t) => t === type)).toHaveLength(1);
  });

  it("never lets a pizza in after the close wins the race", async () => {
    const id = json(await open(w, "pena", pz)).id as string;
    const rs = await Promise.all([
      ...people(15).map((p) => w.call(p, "POST", `/api/pizza/orders/${id}/items`, { kind: "text", text: "x" })),
      w.call("pena", "POST", `/api/pizza/orders/${id}/close`, {}),
    ]);
    const added = rs.slice(0, 15).filter((r) => r.statusCode === 201).length;
    const d = json(await w.call("pena", "GET", `/api/pizza/orders/${id}`));
    expect(d.state).toBe("closed");
    expect(d.pizza_count).toBe(added);
  });
});
