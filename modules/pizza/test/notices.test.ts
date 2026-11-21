/**
 * The notices each person in an order needs (#703): their share is ready, it changed, how to pay
 * changed, they were marked paid, one reminder when still unpaid, and the call-in and changes to
 * their pizza by someone else. Each goes once to the right people, never to the payer or anyone
 * outside the order, and no amount, IBAN or MobilePay number travels on the bus.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Event } from "@canccu/kit";
import { Scheduler } from "../src/scheduler.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import {
  DATABASE_URL,
  T0,
  TRUNCATE,
  freshDatabase,
  itemId,
  json,
  open,
  seedPizzerias,
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";

const PAY = { mobilepay: "040 000 0000", iban: "FI21 1234 5600 0007 85" };

let pool: pg.Pool;
let w: World;
let pz: string;
let id: string;
let items: Record<string, string>;
let scheduler: Scheduler;

beforeAll(async () => {
  if (DATABASE_URL) pool = await freshDatabase();
});
afterAll(async () => {
  if (DATABASE_URL) await pool.end();
});
beforeEach(async () => {
  if (!DATABASE_URL) return;
  await pool.query(TRUNCATE);
  w = await world(pool);
  w.settings.set("demo", { ...DEFAULT_SETTINGS, settle_to_payer: true });
  ({ pz } = await seedPizzerias(w));
  scheduler = new Scheduler(w.deps);
  id = json(await open(w, "pena", pz)).id as string;
  items = {};
  for (const [who, number] of [
    ["anni", "1"],
    ["mikko", "12"],
    ["pena", "3"],
  ] as const) {
    const r = await w.call(who, "POST", `/api/pizza/orders/${id}/items`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, number),
    });
    items[who] = json(r).id as string;
  }
});

const at = async (minutes: number) => {
  w.setNow(new Date(T0.getTime() + minutes * 60_000).toISOString());
  await scheduler.tick();
};
const atIso = async (iso: string) => {
  w.setNow(iso);
  await scheduler.tick();
};
const sent = (type: string): Event[] => w.events().filter((e) => e.type === type);
const place = () => w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
const money = (body: unknown, who = "pena") =>
  w.call(who, "PATCH", `/api/pizza/orders/${id}/money`, body);
const tick = (user: string, paid = true) =>
  w.call("pena", "PUT", `/api/pizza/orders/${id}/paid/${user}`, { paid });
const payDetails = (who: string, body: unknown) =>
  w.call(who, "PUT", "/api/pizza/me/pay-details", body);

/** Money, phone numbers and accounts never travel on the bus (contracts/pizza.md, Events). */
function noMoneyOnTheBus(): void {
  const bus = JSON.stringify(w.events());
  expect(bus).not.toMatch(/_cents|"(amount|mobilepay|iban|pay_to)[a-z_]*":|FI21|040 000|040 111/i);
}

/** Called in at T0, total in, settling to the payer, Pena's details given. */
async function settledToPena(): Promise<void> {
  await place();
  await payDetails("pena", PAY);
  await money({ total_cents: 2800, settle_to: "payer" });
}

describe.skipIf(!DATABASE_URL)("your share is ready", () => {
  it("tells each person but the payer once, 5 min after the last money change", async () => {
    await place();
    await money({ total_cents: 2800 });
    await at(3);
    await money({ settle_to: "payer" });
    await at(7);
    expect(sent("pizza.share.ready")).toHaveLength(0);
    await at(8);
    await at(30);
    const ready = sent("pizza.share.ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]?.data).toMatchObject({
      user_ids: ["u_anni", "u_mikko"],
      settle_to: "payer",
      payer: { user_id: "u_pena", name: "Pena" },
      order: { id, seq: 1 },
    });
    noMoneyOnTheBus();
  });

  it("says the organiser when the order settles to the organiser", async () => {
    await place();
    await money({ total_cents: 2800 });
    await at(5);
    const [ready] = sent("pizza.share.ready");
    expect(ready?.data).toMatchObject({ user_ids: ["u_anni", "u_mikko"], settle_to: "organiser" });
  });

  it("waits for the total: prices alone are an estimate", async () => {
    await place();
    await w.call("pena", "PUT", `/api/pizza/items/${items.anni}/price`, { price_cents: 900 });
    await at(30);
    expect(sent("pizza.share.ready")).toHaveLength(0);
  });

  it("leaves out whoever the payer already marked paid", async () => {
    await place();
    await money({ total_cents: 2800, settle_to: "payer" });
    await tick("u_anni");
    await at(5);
    expect(sent("pizza.share.ready")[0]?.data.user_ids).toEqual(["u_mikko"]);
  });

  it("is never sent for a cancelled order", async () => {
    await place();
    await money({ total_cents: 2800 });
    await w.call("crew", "POST", `/api/pizza/orders/${id}/cancel`, { reason: "wrong pizzeria" });
    await at(10);
    expect(sent("pizza.share.ready")).toHaveLength(0);
  });
});

describe.skipIf(!DATABASE_URL)("your share changed", () => {
  it("tells those whose amount moved, once the share was sent, never the payer", async () => {
    await settledToPena();
    expect(sent("pizza.share.changed")).toHaveLength(0);
    await at(5);
    await money({ total_cents: 3100 });
    const [changed, ...more] = sent("pizza.share.changed");
    expect(more).toHaveLength(0);
    expect(changed?.data).toMatchObject({
      reason: "amount",
      user_ids: ["u_anni", "u_mikko"],
      actor_user_id: "u_pena",
      order: { id },
    });
    // Under an exact split a price moves everyone's amount: the extras are shared per pizza.
    await money({ split: "exact" });
    const before = sent("pizza.share.changed").length;
    await w.call("pena", "PUT", `/api/pizza/items/${items.anni}/price`, { price_cents: 700 });
    const after = sent("pizza.share.changed").slice(before);
    expect(after.map((e) => e.data.user_ids)).toEqual([["u_anni", "u_mikko"]]);
    noMoneyOnTheBus();
  });

  it("tells those not marked paid when the payer's details change", async () => {
    await settledToPena();
    await at(5);
    await tick("u_anni");
    await payDetails("pena", { mobilepay: "040 111 1111", iban: PAY.iban });
    const changed = sent("pizza.share.changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]?.data).toMatchObject({ reason: "pay_to", user_ids: ["u_mikko"] });
    // The same details again change nothing, and someone else's details are no news here.
    await payDetails("pena", { mobilepay: "040 111 1111", iban: PAY.iban });
    await payDetails("anni", PAY);
    expect(sent("pizza.share.changed")).toHaveLength(1);
    noMoneyOnTheBus();
  });

  it("says nothing about the details before the share was sent", async () => {
    await place();
    await money({ total_cents: 2800, settle_to: "payer" });
    await payDetails("pena", PAY);
    expect(sent("pizza.share.changed")).toHaveLength(0);
  });

  it("tells those not marked paid when whom they pay changes", async () => {
    await place();
    await money({ total_cents: 2800 });
    await at(5);
    await money({ settle_to: "payer" });
    const [changed] = sent("pizza.share.changed");
    expect(changed?.data).toMatchObject({
      reason: "pay_to",
      settle_to: "payer",
      user_ids: ["u_anni", "u_mikko"],
      payer: { name: "Pena" },
    });
  });
});

describe.skipIf(!DATABASE_URL)("marked paid", () => {
  it("confirms to that person alone, once per tick", async () => {
    await settledToPena();
    await tick("u_anni");
    await tick("u_anni");
    await tick("u_anni", false);
    const paid = sent("pizza.share.paid");
    expect(paid).toHaveLength(1);
    expect(paid[0]?.data).toMatchObject({
      user_id: "u_anni",
      payer: { name: "Pena" },
      order: { id },
    });
    noMoneyOnTheBus();
  });
});

describe.skipIf(!DATABASE_URL)("the payment reminder", () => {
  // Event day 2026-10-29 turns at 06:00 local (04:00Z); the reminder comes at noon after it.
  const NOON = "2026-10-30T10:00:00.000Z";

  it("reminds each person still unpaid and sums up for the payer, once", async () => {
    await settledToPena();
    await at(5);
    await tick("u_anni");
    await atIso("2026-10-30T04:00:00.000Z");
    await atIso("2026-10-30T09:59:00.000Z");
    expect(sent("pizza.reminder.triggered").filter((e) => e.data.kind === "not_paid")).toHaveLength(
      0,
    );
    await atIso(NOON);
    await atIso("2026-10-30T12:00:00.000Z");
    await atIso("2026-10-31T12:00:00.000Z");
    const reminders = sent("pizza.reminder.triggered").map((e) => ({
      kind: e.data.kind,
      user_id: e.data.user_id,
      role: e.data.role,
      count: e.data.count,
    }));
    expect(reminders).toEqual([
      { kind: "not_paid", user_id: "u_mikko", role: "member", count: 1 },
      { kind: "not_paid", user_id: "u_pena", role: "payer", count: 1 },
    ]);
    noMoneyOnTheBus();
  });

  it("waits 6 hours after a share sent late", async () => {
    await place();
    await payDetails("pena", PAY);
    await atIso("2026-10-30T09:00:00.000Z");
    await money({ total_cents: 2800, settle_to: "payer" }, "crew");
    await atIso("2026-10-30T09:05:00.000Z");
    expect(sent("pizza.share.ready")).toHaveLength(1);
    await atIso(NOON);
    expect(sent("pizza.reminder.triggered")).toHaveLength(0);
    await atIso("2026-10-30T15:05:00.000Z");
    expect(sent("pizza.reminder.triggered").map((e) => e.data.user_id)).toEqual([
      "u_anni",
      "u_mikko",
      "u_pena",
    ]);
  });

  it("sends nothing when everyone is marked paid, or when the order settles to the organiser", async () => {
    await settledToPena();
    await at(5);
    await tick("u_anni");
    await tick("u_mikko");
    await atIso(NOON);
    expect(sent("pizza.reminder.triggered")).toHaveLength(0);
    await money({ settle_to: "organiser" });
    await pool.query("DELETE FROM pizza_due");
    await atIso("2026-10-30T10:01:00.000Z");
    expect(sent("pizza.reminder.triggered")).toHaveLength(0);
  });
});

describe.skipIf(!DATABASE_URL)("the order's own steps", () => {
  it("names the people in it when it is called in", async () => {
    await place();
    const [placed] = sent("pizza.order.placed");
    expect(placed?.data.user_ids).toEqual(["u_anni", "u_mikko", "u_pena"]);
  });

  it("says whether someone else changed or removed a person's pizza", async () => {
    await w.call("pena", "PUT", `/api/pizza/items/${items.anni}`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, "12"),
    });
    await w.call("pena", "DELETE", `/api/pizza/items/${items.mikko}`);
    await w.call("pena", "DELETE", `/api/pizza/items/${items.pena}`);
    const [changed] = sent("pizza.item.changed");
    expect(changed?.data).toMatchObject({ user_id: "u_anni", order_seq: 1, by_owner: false });
    const removed = sent("pizza.item.removed").map((e) => [e.data.user_id, e.data.by_owner]);
    expect(removed).toEqual([
      ["u_mikko", false],
      ["u_pena", true],
    ]);
  });
});
