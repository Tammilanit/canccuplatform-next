/**
 * The holder's pages (mockups 07–09) on the server: the checklist from prepare to hand-out, each
 * form the API's own step; who else sees what; Finnish; sign-in.
 */
import { pageProblems } from "@canccu/ui";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  DATABASE_URL,
  freshDatabase,
  itemId,
  json,
  open,
  seedPizzerias,
  world,
} from "./helpers.js";
import { form, view } from "./forms.js";
import type { World } from "./helpers.js";

let pool: pg.Pool;
let w: World;
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
    "TRUNCATE pizza_receipts, pizza_paid, pizza_pay_details, pizza_reader_keys, pizza_reads, pizza_due, pizza_crew, pizza_pizzerias, pizza_menu_entries, pizza_orders, pizza_items, pizza_order_log, pizza_idempotency, pizza_outbox, pizza_outbox_tenants, pizza_tenants",
  );
  w = await world(pool);
  const { pz } = await seedPizzerias(w);
  const margherita = await itemId(w, pz, "1");
  const kebab = await itemId(w, pz, "12");
  id = json(await open(w, "pena", pz)).id as string;
  const add = (who: string, item: string, note?: string) =>
    w.call(who, "POST", `/api/pizza/orders/${id}/items`, {
      kind: "menu",
      menu_item_id: item,
      ...(note === undefined ? {} : { note }),
    });
  await add("anni", kebab, "no onion");
  await add("anni", kebab, "no onion");
  await add("mikko", margherita);
});

const order = async () => json(await w.call("pena", "GET", `/api/pizza/orders/${id}`));
const location = (r: { headers: Record<string, unknown> }) => String(r.headers.location);

describe.skipIf(!DATABASE_URL)("the holder's pages", () => {
  it("walk the checklist from close to Everyone got theirs", async () => {
    let r = await view(w, "pena", `/hold/${id}`);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Your order 1");
    expect(r.body).toContain("Close the order now");
    expect(r.body).toContain('href="tel:+0000000000"');
    expect(r.body).toContain("https://pizzeria.example");
    expect(r.body).toContain('aria-current="step"');

    r = await form(w, "pena", `/hold/${id}/step/close`);
    expect(location(r)).toBe(`/pizza/hold/${id}/call`);
    expect((await order()).state).toBe("closed");

    r = await view(w, "pena", `/hold/${id}/call`);
    expect(r.body).toContain("2 ×");
    expect(r.body).toContain("#12 Kebab");
    expect(r.body).toContain("no onion");
    expect(r.body).toContain("Copy as text");

    r = await view(w, "pena", `/hold/${id}/called-in`);
    expect(r.body).toContain("Me (Pena)");
    expect(r.body).toContain("Anni");
    r = await form(w, "pena", `/hold/${id}/called-in`, {
      estimate_minutes: "45",
      payer_user_id: "u_anni",
    });
    expect(location(r)).toBe(`/pizza/hold/${id}`);
    const placed = await order();
    expect(placed.state).toBe("placed");
    expect(placed.estimate_at).toBe(new Date(w.now.getTime() + 45 * 60_000).toISOString());
    expect((placed.payer as { name: string }).name).toBe("Anni");

    r = await form(w, "pena", `/hold/${id}/here`, { pickup: "Entrance table" });
    expect(location(r)).toBe(`/pizza/hold/${id}/hand-out`);
    expect((await order()).pickup).toBe("Entrance table");

    r = await view(w, "pena", `/hold/${id}/hand-out`);
    expect(r.body).toContain("0 of 2 collected");
    expect(r.body).toContain("Nudge the 2 not collected");
    expect(r.body).toContain("Everyone got theirs");

    await form(w, "pena", `/hold/${id}/tick`, { user_id: "u_anni", handed_out: "yes" });
    r = await view(w, "pena", `/hold/${id}/hand-out`);
    expect(r.body).toContain("1 of 2 collected");
    expect(r.body).toContain("Nudge the 1 not collected");

    await form(w, "pena", `/hold/${id}/nudge`);
    const nudged = w.events().filter((e) => e.type === "pizza.reminder.triggered");
    expect(nudged.map((e) => e.data.user_id)).toEqual(["u_mikko"]);
    expect((await view(w, "pena", `/hold/${id}/hand-out`)).body).toContain("Nudged at 18:00");

    r = await form(w, "pena", `/hold/${id}/hand-out`);
    expect(location(r)).toBe(`/pizza/hold/${id}/hand-out`);
    const done = await order();
    expect(done.state).toBe("done");
    expect(done.done_reason).toBe("handed_out");
    expect((await view(w, "pena", `/hold/${id}`)).body).toContain("Order 1 is done");
  });

  it("shows a member whose order it is, and lets them take over a released one", async () => {
    let r = await view(w, "anni", `/hold/${id}`);
    expect(r.body).toContain("Pena holds this order");
    // #782 B0: the holder chip says what it means.
    expect(pageProblems(r.body)).toEqual([]);
    expect(r.body).toContain("A member holds this order");
    expect(r.body).not.toContain("Close the order now");
    expect(r.body).not.toContain("tel:");
    await w.call("pena", "POST", `/api/pizza/orders/${id}/release`);
    r = await view(w, "anni", `/hold/${id}`);
    expect(r.body).toContain("Nobody holds it");
    expect(pageProblems(r.body)).toEqual([]);
    expect(r.body).toContain("Take over the order");
    r = await form(w, "anni", `/hold/${id}/step/claim`);
    expect(location(r)).toBe(`/pizza/hold/${id}`);
    expect(((await order()).holder as { name: string }).name).toBe("Anni");
    expect((await view(w, "anni", `/hold/${id}`)).body).toContain("Your order 1");
  });

  it("cancels with the holder's words, and undoes a call-in", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`);
    const r = await form(w, "pena", `/hold/${id}/step/undo`);
    expect(location(r)).toBe(`/pizza/hold/${id}`);
    expect((await order()).state).toBe("closed");
    expect((await view(w, "pena", `/hold/${id}/cancel`)).body).toContain("The 2 people in it");
    await form(w, "pena", `/hold/${id}/step/cancel`, { reason: "The pizzeria is closed" });
    const o = await order();
    expect(o.state).toBe("cancelled");
    expect(o.cancel_reason).toBe("The pizzeria is closed");
  });

  it("says why a step was refused, on the page it came from", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`);
    await w.call("pena", "POST", `/api/pizza/orders/${id}/arrive`);
    const r = await form(w, "pena", `/hold/${id}/nudge`);
    expect(location(r)).toBe(`/pizza/hold/${id}/hand-out`);
    const again = await form(w, "pena", `/hold/${id}/nudge`);
    expect(location(again)).toMatch(new RegExp(`^/pizza/hold/${id}/hand-out\\?error=`));
    const page = await view(w, "pena", location(again).replace("/pizza", ""));
    expect(page.body).toContain("nudged already");
  });

  it("edits the close time on the event's clock", async () => {
    await form(w, "pena", `/hold/${id}/edit`, { closes: "19:30", note: "Order by 19:30" });
    const o = await order();
    // T0 is 18:00 in Helsinki (UTC+2 on 29.10.).
    expect(o.closes_at).toBe("2026-10-29T17:30:00.000Z");
    expect(o.note).toBe("Order by 19:30");
  });

  it("keeps a passed close time when only the note is edited", async () => {
    await form(w, "pena", `/hold/${id}/step/close`);
    const before = (await order()).closes_at;
    // Past the close time (19:00 in Helsinki), which would now read as tomorrow's 19:00.
    w.setNow("2026-10-29T17:10:00.000Z");
    const page = await view(w, "pena", `/hold/${id}`);
    const value = (name: string) =>
      new RegExp(`name="${name}"\\s+value="([^"]*)"`).exec(page.body)?.[1] ?? "";
    expect(value("closes")).toBe("19:00");
    expect(value("closes_was")).toBe("19:00");
    const r = await form(w, "pena", `/hold/${id}/edit`, {
      closes: value("closes"),
      closes_was: value("closes_was"),
      note: "Pickup at the door",
    });
    expect(location(r)).toBe(`/pizza/hold/${id}`);
    const o = await order();
    expect(o.note).toBe("Pickup at the door");
    expect(o.closes_at).toBe(before);
  });

  it("speaks Finnish when the event does", async () => {
    w.languages.set("demo", "fi");
    const r = await view(w, "pena", `/hold/${id}`);
    expect(r.body).toContain('<html lang="fi">');
    expect(r.body).toContain("Tilauksesi 1");
    expect(r.body).toContain("Sulje tilaus nyt");
  });

  it("sends the signed out to sign in, and back", async () => {
    const r = await view(w, null, `/hold/${id}`);
    expect(r.statusCode).toBe(303);
    expect(location(r)).toBe(`/admin/sign-in?next=${encodeURIComponent(`/pizza/hold/${id}`)}`);
  });
});
