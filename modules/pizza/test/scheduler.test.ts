/**
 * The scheduler (O2; the plan's Forgotten orders): last call, auto-close, the reminders to the
 * holder and then the crew, the release, "has it arrived?", done after arrival and the day's turn,
 * each once per order; two replicas and a restart send nothing twice; its lag in /health.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Event } from "@canccu/kit";
import { Scheduler } from "../src/scheduler.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import {
  DATABASE_URL,
  T0,
  freshDatabase,
  itemId,
  json,
  open,
  seedPizzerias,
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";

const db = DATABASE_URL === undefined ? describe.skip : describe;

db("the scheduler", () => {
  let pool: pg.Pool;
  let w: World;
  let pz: string;
  let margherita: string;
  let scheduler: Scheduler;

  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(
      `TRUNCATE pizza_receipts, pizza_paid, pizza_due, pizza_crew, pizza_order_log, pizza_items, pizza_orders, pizza_menu_entries,
         pizza_pizzerias, pizza_idempotency, pizza_outbox, pizza_outbox_tenants, pizza_tenants`,
    );
    w = await world(pool);
    ({ pz } = await seedPizzerias(w));
    margherita = await itemId(w, pz, "1");
    scheduler = new Scheduler(w.deps);
    // The crew is who pizza has seen with pizza.order.manage.
    await w.call("crew", "GET", "/api/pizza/orders");
  });

  /** Pena opens an order closing at T0 + 60 min, and Anni adds a pizza. */
  async function anOrder(extra: Record<string, unknown> = {}): Promise<string> {
    const id = json(await open(w, "pena", pz, extra)).id as string;
    await w.call("anni", "POST", `/api/pizza/orders/${id}/items`, {
      kind: "menu",
      menu_item_id: margherita,
    });
    return id;
  }

  const at = async (minutes: number) => {
    w.setNow(new Date(T0.getTime() + minutes * 60_000).toISOString());
    await scheduler.tick();
  };
  const sent = (type: string): Event[] => w.events().filter((e) => e.type === type);
  const reminders = () =>
    sent("pizza.reminder.triggered").map((e) => ({
      kind: e.data.kind,
      minutes: e.data.minutes,
      user_id: e.data.user_id,
      role: e.data.role,
    }));
  const state = async (id: string) =>
    json(await w.call("pena", "GET", `/api/pizza/orders/${id}`)).state;

  it("gives the last call once, 5 minutes before the close (#787 Q1), then closes at the time", async () => {
    const id = await anOrder();
    await at(54);
    expect(sent("pizza.order.closing")).toHaveLength(0);
    await at(55);
    await at(56);
    const closing = sent("pizza.order.closing");
    expect(closing).toHaveLength(1);
    expect(closing[0]?.data.closes_at).toBe(new Date(T0.getTime() + 3600_000).toISOString());
    expect((closing[0]?.data.order as { id: string }).id).toBe(id);
    expect(await state(id)).toBe("open");
    await at(60);
    expect(await state(id)).toBe("closed");
    const closed = sent("pizza.order.closed");
    expect(closed).toHaveLength(1);
    expect(closed[0]?.data.actor_user_id).toBeNull();
  });

  it("sends no last call for an order closed earlier, and cancels an empty one at the time", async () => {
    const id = await anOrder();
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`);
    const empty = json(await open(w, "mikko", (await seedOther()).id)).id as string;
    await at(55);
    expect(sent("pizza.order.closing").map((e) => (e.data.order as { id: string }).id)).toEqual([
      empty,
    ]);
    await at(60);
    expect(await state(empty)).toBe("cancelled");
  });

  async function seedOther() {
    const r = await w.call("menus", "POST", "/api/pizza/pizzerias", { name: "Demo Corner" });
    return json(r) as { id: string };
  }

  it("with auto-close off, reminds the holder at +30 and the holder and the crew at +60", async () => {
    w.settings.set("demo", { ...DEFAULT_SETTINGS, auto_close: false });
    const id = await anOrder();
    await at(60);
    expect(await state(id)).toBe("open");
    await at(90);
    expect(reminders()).toEqual([
      { kind: "open_past_target", minutes: 30, user_id: "u_pena", role: "holder" },
    ]);
    await at(120);
    expect(reminders().slice(1)).toEqual([
      { kind: "open_past_target", minutes: 60, user_id: "u_pena", role: "holder" },
      { kind: "open_past_target", minutes: 60, user_id: "u_crew", role: "crew" },
    ]);
    await at(121);
    expect(reminders()).toHaveLength(3);
  });

  it("reminds a closed order's holder, then the crew, and releases the holder at 2 h", async () => {
    const id = await anOrder();
    await at(10);
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`);
    await at(40);
    expect(reminders()).toEqual([
      { kind: "closed_not_placed", minutes: 30, user_id: "u_pena", role: "holder" },
    ]);
    await at(70);
    await at(130);
    const released = sent("pizza.order.released");
    expect(released).toHaveLength(1);
    expect(released[0]?.data.reason).toBe("timeout");
    expect(reminders().slice(1)).toEqual([
      { kind: "closed_not_placed", minutes: 60, user_id: "u_pena", role: "holder" },
      { kind: "closed_not_placed", minutes: 60, user_id: "u_crew", role: "crew" },
      { kind: "released", minutes: 120, user_id: "u_crew", role: "crew" },
    ]);
    expect(json(await w.call("crew", "GET", `/api/pizza/orders/${id}`)).holder).toBeNull();
  });

  it("gives the last call and closes again when a closed order is reopened with a new time", async () => {
    const id = await anOrder();
    await at(55);
    await at(60);
    expect(await state(id)).toBe("closed");
    w.setNow(new Date(T0.getTime() + 61 * 60_000).toISOString());
    expect((await w.call("pena", "POST", `/api/pizza/orders/${id}/reopen`)).statusCode).toBe(200);
    const closesAt = new Date(T0.getTime() + 80 * 60_000).toISOString();
    await w.call("pena", "PATCH", `/api/pizza/orders/${id}`, { closes_at: closesAt });
    await at(74);
    expect(sent("pizza.order.closing")).toHaveLength(1);
    await at(75);
    expect(sent("pizza.order.closing").map((e) => e.data.closes_at)).toEqual([
      new Date(T0.getTime() + 3600_000).toISOString(),
      closesAt,
    ]);
    expect(await state(id)).toBe("open");
    await at(80);
    expect(await state(id)).toBe("closed");
    expect(sent("pizza.order.closed")).toHaveLength(2);
    // The first close's rows stay as the record, sent once each.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pizza_due WHERE order_id = $1 AND step LIKE 'close@%' AND sent_at IS NOT NULL`,
      [id],
    );
    expect(rows[0]).toEqual({ n: 2 });
  });

  it("reminds and releases again after a later claim, counted from the claim", async () => {
    const id = await anOrder();
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`);
    for (const m of [30, 60, 120]) await at(m);
    expect(sent("pizza.order.released")).toHaveLength(1);
    expect(reminders()).toHaveLength(4);
    w.setNow(new Date(T0.getTime() + 125 * 60_000).toISOString());
    expect((await w.call("pena", "POST", `/api/pizza/orders/${id}/claim`)).statusCode).toBe(200);
    await at(154);
    expect(reminders()).toHaveLength(4);
    await at(155);
    await at(185);
    await at(245);
    expect(reminders().slice(4)).toEqual([
      { kind: "closed_not_placed", minutes: 30, user_id: "u_pena", role: "holder" },
      { kind: "closed_not_placed", minutes: 60, user_id: "u_pena", role: "holder" },
      { kind: "closed_not_placed", minutes: 60, user_id: "u_crew", role: "crew" },
      { kind: "released", minutes: 120, user_id: "u_crew", role: "crew" },
    ]);
    expect(sent("pizza.order.released")).toHaveLength(2);
    expect(json(await w.call("crew", "GET", `/api/pizza/orders/${id}`)).holder).toBeNull();
  });

  it("tells the crew when nobody holds a stalled order", async () => {
    const id = await anOrder();
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`);
    await w.call("pena", "POST", `/api/pizza/orders/${id}/release`);
    await at(30);
    expect(reminders()).toEqual([
      { kind: "closed_not_placed", minutes: 30, user_id: "u_crew", role: "crew" },
    ]);
  });

  it("skips a reminder more than 30 minutes late, and sends only the latest one due", async () => {
    const id = await anOrder();
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`);
    // The scheduler was down from +0 to +65: the +30 is stale, the +60 is news.
    await at(65);
    expect(reminders().map((r) => r.minutes)).toEqual([60, 60]);
    await at(66);
    expect(reminders()).toHaveLength(2);
  });

  it("asks whether it arrived 30 min past the estimate, then asks the crew", async () => {
    const id = await anOrder();
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, { estimate_minutes: 45 });
    await at(74);
    expect(reminders()).toEqual([]);
    await at(75);
    expect(reminders()).toEqual([
      { kind: "not_arrived", minutes: 30, user_id: "u_pena", role: "holder" },
    ]);
    await at(105);
    expect(reminders().slice(1)).toEqual([
      { kind: "not_arrived", minutes: 60, user_id: "u_crew", role: "crew" },
    ]);
  });

  it("asks 90 min after the call-in without an estimate", async () => {
    const id = await anOrder();
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`);
    await at(89);
    expect(reminders()).toEqual([]);
    await at(90);
    expect(reminders()).toEqual([
      { kind: "not_arrived", minutes: 90, user_id: "u_pena", role: "holder" },
    ]);
  });

  it("makes an arrived order done 2 h after arrival, by the timer", async () => {
    const id = await anOrder();
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`);
    await w.call("pena", "POST", `/api/pizza/orders/${id}/arrive`, { pickup: "Entrance table" });
    await at(119);
    expect(await state(id)).toBe("arrived");
    await at(120);
    expect(await state(id)).toBe("done");
    expect(sent("pizza.order.done")[0]?.data.reason).toBe("timer");
  });

  it("closes forgotten orders at the day's turn: never called in cancelled, called in done", async () => {
    w.settings.set("demo", { ...DEFAULT_SETTINGS, auto_close: false });
    const never = await anOrder();
    const called = json(await open(w, "mikko", (await seedOther()).id)).id as string;
    await w.call("mikko", "POST", `/api/pizza/orders/${called}/place`);
    // T0 is 18:00 in Helsinki on 29.10.; the day turns at 06:00 on 30.10., 12 h later.
    await at(719);
    expect(await state(never)).toBe("open");
    await at(720);
    expect(await state(never)).toBe("cancelled");
    expect(await state(called)).toBe("done");
    expect(sent("pizza.order.done").map((e) => e.data.reason)).toEqual(["timer"]);
    expect(sent("pizza.order.arrived")).toHaveLength(0);
  });

  it("leaves forgotten orders alone when that setting is off", async () => {
    w.settings.set("demo", { ...DEFAULT_SETTINGS, auto_close: false, close_forgotten: false });
    const never = await anOrder();
    await at(720);
    expect(await state(never)).toBe("open");
  });

  it("follows a changed setting for a step not yet sent", async () => {
    const id = await anOrder();
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`);
    await at(10);
    w.settings.set("demo", { ...DEFAULT_SETTINGS, remind_holder_minutes: 45 });
    await at(30);
    expect(reminders()).toEqual([]);
    await at(45);
    expect(reminders()).toEqual([
      { kind: "closed_not_placed", minutes: 45, user_id: "u_pena", role: "holder" },
    ]);
  });

  it("sends each step once with two replicas ticking at once, and after a restart", async () => {
    const id = await anOrder();
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`);
    w.setNow(new Date(T0.getTime() + 30 * 60_000).toISOString());
    const other = new Scheduler(w.deps);
    await Promise.all([scheduler.tick(), other.tick(), scheduler.tick(), other.tick()]);
    expect(reminders()).toHaveLength(1);
    // A restart is a new scheduler with nothing in memory: the rows remember what was sent.
    await new Scheduler(w.deps).tick();
    expect(reminders()).toHaveLength(1);
    const { rows } = await pool.query(
      `SELECT step, sent_at IS NOT NULL AS sent FROM pizza_due WHERE order_id = $1 ORDER BY step`,
      [id],
    );
    expect(rows).toContainEqual({ step: "closed_holder@2026-10-29T16:00:00.000Z", sent: true });
  });

  it("reports its lag in /health", async () => {
    let health = await scheduler.check()();
    expect(health.status).toBe("degraded");
    await anOrder();
    await at(55.5);
    health = await scheduler.check()();
    expect(health).toEqual({ status: "ok", detail: "lag 30 s" });
  });
});
