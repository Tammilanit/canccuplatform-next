/**
 * The legacy `pizza-orders` tests as the spec of the lifecycle: open, claim, take over, release,
 * close, call in, arrive, hand out, done, undo and cancel, each with its event and its history.
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
import { must } from "./fixtures.js";

let pool: pg.Pool;
let w: World;
let pz: string;
let grill: string;
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
    "TRUNCATE pizza_pizzerias, pizza_menu_entries, pizza_orders, pizza_items, pizza_order_log, pizza_idempotency, pizza_outbox, pizza_outbox_tenants, pizza_tenants",
  );
  w = await world(pool);
  ({ pz, grill } = await seedPizzerias(w));
  margherita = await itemId(w, pz, "1");
});

const post = (who: string | null, path: string, body: unknown = {}) =>
  w.call(who, "POST", `/api/pizza/${path}`, body);
const get = (who: string | null, path: string) => w.call(who, "GET", `/api/pizza/${path}`);
const history = async (id: string) =>
  (json(await get("crew", `orders/${id}/history`)).entries as { kind: string }[]).map(
    (e) => e.kind,
  );
const opened = async (who = "pena", pizzeria = pz) =>
  json(await open(w, who, pizzeria)).id as string;

describe.skipIf(!DATABASE_URL)("opening", () => {
  it("makes the caller the holder, numbered for the event day, and says so on the bus", async () => {
    const r = await open(w, "pena", pz);
    expect(r.statusCode).toBe(201);
    expect(json(r)).toMatchObject({
      seq: 1,
      day: "2026-10-29",
      state: "open",
      holder: { user_id: "u_pena", name: "Pena" },
      you_hold: true,
    });
    const e = must(w.events().at(-1));
    expect(e.type).toBe("pizza.order.opened");
    expect(e.data).toMatchObject({
      actor_user_id: "u_pena",
      order: {
        seq: 1,
        state: "open",
        pizzeria: { id: pz, name: "Demo Pizzeria" },
        holder: { user_id: "u_pena", discord_user_id: "100000000000000001", name: "Pena" },
        pizza_count: 0,
        people_count: 0,
        revision: 1,
      },
    });
    const order = (e.data as { order: Record<string, unknown> }).order;
    expect(order.closes_at).toBe(order.target_at);
    expect(JSON.stringify(e)).not.toMatch(/price|total|phone/);
    expect(await history(json(r).id as string)).toEqual(["opened"]);
  });
  it("needs a known pizzeria and a close time in the future", async () => {
    expect(
      errorOf(
        await post("pena", "orders", { pizzeria_id: "pz_nope", closes_at: "2026-10-29T17:00:00Z" }),
      ),
    ).toMatchObject({ field: "pizzeria_id" });
    expect(
      errorOf(await post("pena", "orders", { pizzeria_id: pz, closes_at: "soon" })),
    ).toMatchObject({ field: "closes_at" });
    expect(
      errorOf(await post("pena", "orders", { pizzeria_id: pz, closes_at: "2026-10-29T15:00:00Z" })),
    ).toMatchObject({ field: "closes_at" });
  });
  it("refuses a second open order at one pizzeria with 409 another_open and that order", async () => {
    const first = await opened("pena");
    const r = await open(w, "anni", pz);
    expect(r.statusCode).toBe(409);
    expect(errorOf(r)).toMatchObject({ code: "another_open", open: { id: first, seq: 1 } });
  });
  it("opens orders at several pizzerias at once (D1), numbering them 1 and 2", async () => {
    await opened("pena", pz);
    const second = await open(w, "anni", grill);
    expect(json(second).seq).toBe(2);
  });
  it("lets a person hold one open order only (E14)", async () => {
    await opened("pena", pz);
    const r = await open(w, "pena", grill);
    expect(r.statusCode).toBe(409);
    expect(errorOf(r).code).toBe("already_holding");
  });
  it("allows at most N open orders per event (O5)", async () => {
    w.settings.set("demo", { ...(await w.deps.settings("demo")), max_open_orders: 1 });
    await opened("pena", pz);
    const r = await open(w, "anni", grill);
    expect(r.statusCode).toBe(409);
    expect(errorOf(r).code).toBe("too_many_open");
  });
  it("refuses while ordering is off (O3), and is crew only when the event says so (U2)", async () => {
    const s = await w.deps.settings("demo");
    w.settings.set("demo", { ...s, ordering_open: false });
    expect(errorOf(await open(w, "pena", pz)).code).toBe("ordering_closed");
    w.settings.set("demo", { ...s, open_by: "crew" });
    expect(errorOf(await open(w, "pena", pz)).code).toBe("missing_right");
    expect((await open(w, "opener", pz)).statusCode).toBe(201);
  });
});

describe.skipIf(!DATABASE_URL)("claim, take over and release", () => {
  let id: string;
  beforeEach(async () => {
    id = await opened("pena");
  });
  it("claims an order nobody holds; the holder's claim is a no-op; others get 409 claimed", async () => {
    expect((await post("pena", `orders/${id}/claim`)).statusCode).toBe(200);
    const held = await post("anni", `orders/${id}/claim`);
    expect(held.statusCode).toBe(409);
    expect(errorOf(held)).toMatchObject({
      code: "claimed",
      holder: "Pena",
      since: "2026-10-29T16:00:00.000Z",
    });
    expect((await post("pena", `orders/${id}/release`)).statusCode).toBe(200);
    const taken = await post("anni", `orders/${id}/claim`);
    expect(json(taken).holder).toMatchObject({ name: "Anni" });
    expect(types(w.events()).slice(1)).toEqual(["pizza.order.released", "pizza.order.claimed"]);
    expect(w.events()[1]?.data).toMatchObject({
      reason: "released",
      previous_holder: { name: "Pena" },
    });
  });
  it("refuses release by a stranger; the crew's forced release is audited", async () => {
    const no = await post("anni", `orders/${id}/release`);
    expect(no.statusCode).toBe(403);
    expect(errorOf(no).code).toBe("not_holder");
    expect((await post("crew", `orders/${id}/release`, { reason: "gone home" })).statusCode).toBe(
      200,
    );
    expect(w.events().at(-1)?.data).toMatchObject({ reason: "forced", actor_user_id: "u_crew" });
    expect(w.audit.at(-1)).toMatchObject({
      action: "pizza.order.released",
      actor_user_id: "u_crew",
      target: { type: "order", id },
      changes: { holder: { old: "u_pena", new: null } },
    });
    expect(await history(id)).toEqual(["opened", "released"]);
  });
  it("lets the crew take over a held order, before and after audited (D16)", async () => {
    const r = await post("crew", `orders/${id}/take-over`);
    expect(json(r).holder).toMatchObject({ user_id: "u_crew" });
    expect(w.events().at(-1)).toMatchObject({
      type: "pizza.order.claimed",
      data: { previous_holder: { name: "Pena" }, actor_user_id: "u_crew" },
    });
    expect(w.audit.at(-1)).toMatchObject({
      action: "pizza.order.taken_over",
      changes: { holder: { old: "u_pena", new: "u_crew" } },
    });
    expect((await post("anni", `orders/${id}/take-over`)).statusCode).toBe(403);
  });
  it("keeps the pizzas through a release", async () => {
    await post("anni", `orders/${id}/items`, { kind: "menu", menu_item_id: margherita });
    await post("pena", `orders/${id}/release`);
    const d = json(await get("crew", `orders/${id}`));
    expect(d.holder).toBeNull();
    expect(d.items).toHaveLength(1);
  });
  it("locks the pizzeria once there are pizzas (409 has_pizzas)", async () => {
    const other = (await w.call("menus", "POST", "/api/pizza/pizzerias", { name: "Third" })).json<{
      id: string;
    }>().id;
    expect(
      (await w.call("pena", "PATCH", `/api/pizza/orders/${id}`, { pizzeria_id: other })).statusCode,
    ).toBe(200);
    expect(
      (await w.call("pena", "PATCH", `/api/pizza/orders/${id}`, { pizzeria_id: pz })).statusCode,
    ).toBe(200);
    await post("anni", `orders/${id}/items`, { kind: "text", text: "XL" });
    const r = await w.call("pena", "PATCH", `/api/pizza/orders/${id}`, { pizzeria_id: other });
    expect(r.statusCode).toBe(409);
    expect(errorOf(r).code).toBe("has_pizzas");
  });
});

describe.skipIf(!DATABASE_URL)("close, call in, arrive, hand out, done, undo", () => {
  let id: string;
  beforeEach(async () => {
    id = await opened("pena");
    await post("anni", `orders/${id}/items`, { kind: "menu", menu_item_id: margherita });
    await post("mikko", `orders/${id}/items`, { kind: "menu", menu_item_id: margherita });
  });
  it("closes and reopens; reopen is refused once called in", async () => {
    expect(json(await post("pena", `orders/${id}/close`)).state).toBe("closed");
    expect(json(await post("pena", `orders/${id}/reopen`)).state).toBe("open");
    await post("pena", `orders/${id}/place`);
    const r = await post("pena", `orders/${id}/reopen`);
    expect(r.statusCode).toBe(409);
    expect(errorOf(r).code).toBe("placed");
  });
  it("calls in: closes the order, sets the payer to the holder and the estimate", async () => {
    const r = await post("pena", `orders/${id}/place`, {
      estimate_minutes: 45,
      at: "2026-10-29T16:05:00Z",
    });
    expect(json(r)).toMatchObject({
      state: "placed",
      placed_at: "2026-10-29T16:05:00.000Z",
      estimate_at: "2026-10-29T16:50:00.000Z",
      payer: { user_id: "u_pena", name: "Pena" },
    });
    expect(json(r).closed_at).toBeTruthy();
    // E2: a repeated call-in is a no-op, never a second event (the legacy answered 409).
    expect((await post("pena", `orders/${id}/place`)).statusCode).toBe(200);
    expect(types(w.events()).slice(-2)).toEqual(["pizza.order.closed", "pizza.order.placed"]);
  });
  it("lets the holder name another payer at call-in, a person of the order", async () => {
    const r = await post("pena", `orders/${id}/place`, { payer_user_id: "u_anni" });
    expect(json(r).payer).toMatchObject({ name: "Anni" });
    expect((await post("pena", `orders/${id}/undo`)).statusCode).toBe(200);
    expect(
      errorOf(await post("pena", `orders/${id}/place`, { payer_user_id: "u_tero" })),
    ).toMatchObject({ field: "payer_user_id" });
  });
  it("a stranger cannot call in; the crew can, and the payer is still set (U13)", async () => {
    expect((await post("anni", `orders/${id}/place`)).statusCode).toBe(403);
    await post("pena", `orders/${id}/release`);
    const r = await post("crew", `orders/${id}/place`);
    expect(json(r).payer).toMatchObject({ user_id: "u_crew" });
  });
  it("arrives with a pickup place, tells everyone in the order, then is done by hand-out ticks", async () => {
    await post("pena", `orders/${id}/place`);
    const arrived = await post("pena", `orders/${id}/arrive`, { pickup: "Info desk" });
    expect(json(arrived)).toMatchObject({ state: "arrived", pickup: "Info desk" });
    expect(w.events().at(-1)).toMatchObject({
      type: "pizza.order.arrived",
      data: { user_ids: ["u_anni", "u_mikko"], order: { pickup: "Info desk" } },
    });
    const items = json(await get("pena", `orders/${id}`)).items as { id: string }[];
    expect(
      (await post("anni", `items/${must(items[0]).id}/hand-out`, { handed_out: true })).statusCode,
    ).toBe(200);
    expect(json(await get("pena", `orders/${id}`)).state).toBe("arrived");
    await post("pena", `items/${must(items[1]).id}/hand-out`, { handed_out: true });
    const done = json(await get("pena", `orders/${id}`));
    expect(done).toMatchObject({ state: "done", done_reason: "handed_out" });
    expect(w.events().at(-1)).toMatchObject({
      type: "pizza.order.done",
      data: { reason: "handed_out" },
    });
  });
  it("ticks everyone at once with Everyone got theirs (U4)", async () => {
    await post("pena", `orders/${id}/place`);
    expect((await post("pena", `orders/${id}/hand-out`)).statusCode).toBe(409);
    await post("pena", `orders/${id}/arrive`);
    const r = await post("pena", `orders/${id}/hand-out`);
    expect(json(r)).toMatchObject({ state: "done", done_reason: "handed_out" });
    expect((json(r).items as { handed_out: boolean }[]).every((i) => i.handed_out)).toBe(true);
  });
  it("is done by the holder's Done too, with reason holder", async () => {
    await post("pena", `orders/${id}/place`);
    expect((await post("pena", `orders/${id}/done`)).statusCode).toBe(409);
    await post("pena", `orders/${id}/arrive`);
    expect(json(await post("pena", `orders/${id}/done`))).toMatchObject({
      state: "done",
      done_reason: "holder",
    });
  });
  it("undoes arrived to placed and placed to closed, keeping the total but not the payer", async () => {
    await post("pena", `orders/${id}/place`);
    await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, { total_cents: 1600 });
    await post("pena", `orders/${id}/arrive`);
    expect(json(await post("pena", `orders/${id}/undo`)).state).toBe("placed");
    const u = json(await post("pena", `orders/${id}/undo`));
    expect(u).toMatchObject({ state: "closed", placed_at: null, payer: null, total_cents: 1600 });
    expect(
      w
        .events()
        .filter((e) => e.type === "pizza.order.reverted")
        .map((e) => e.data.from_state),
    ).toEqual(["arrived", "placed"]);
    expect((await post("pena", `orders/${id}/undo`)).statusCode).toBe(409);
  });
  it("cannot undo a call-in while another order of the pizzeria is open", async () => {
    await post("pena", `orders/${id}/place`);
    await open(w, "anni", pz);
    const r = await post("pena", `orders/${id}/undo`);
    expect(r.statusCode).toBe(409);
    expect(errorOf(r).code).toBe("another_open");
  });
  it("corrects the call-in time of a placed order", async () => {
    await post("pena", `orders/${id}/place`);
    const r = await w.call("pena", "PATCH", `/api/pizza/orders/${id}`, {
      placed_at: "2026-10-29T16:20:00Z",
    });
    expect(json(r).placed_at).toBe("2026-10-29T16:20:00.000Z");
  });
  it("writes every step to the order's history", async () => {
    await post("pena", `orders/${id}/close`);
    await post("pena", `orders/${id}/reopen`);
    await post("pena", `orders/${id}/release`);
    await post("anni", `orders/${id}/claim`);
    await post("anni", `orders/${id}/place`);
    await post("anni", `orders/${id}/undo`);
    await post("anni", `orders/${id}/cancel`, { reason: "closed today" });
    expect(await history(id)).toEqual([
      "opened",
      "item_added",
      "item_added",
      "closed",
      "reopened",
      "released",
      "claimed",
      "placed",
      "reverted",
      "cancelled",
    ]);
  });
});

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
