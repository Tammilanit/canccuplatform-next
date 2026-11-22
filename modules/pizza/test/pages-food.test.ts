/**
 * The attendee's Food page (mockups 02, 03, 06 and 16): the open orders in every state, guests,
 * people not in the event, ordering off, starting an order and the screen's QR landing (L6).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEFAULT_SETTINGS } from "../src/settings.js";
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
let pz: string;
let grill: string;

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
  ({ pz, grill } = await seedPizzerias(w));
});

const location = (r: { headers: Record<string, unknown> }) => String(r.headers.location);
const addKebab = async (who: string, order: string) =>
  w.call(who, "POST", `/api/pizza/orders/${order}/items`, {
    kind: "menu",
    menu_item_id: await itemId(w, pz, "12"),
  });

describe.skipIf(!DATABASE_URL)("the Food page", () => {
  it("lists the open orders with their close time, counts, holder and your own stake", async () => {
    const first = json(await open(w, "pena", pz)).id as string;
    await addKebab("anni", first);
    await addKebab("mikko", first);
    json(await open(w, "tero", grill));
    const r = await view(w, "anni", "/");
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Open orders");
    expect(r.body).toContain("Order 1 · Demo Pizzeria");
    expect(r.body).toContain("Order 2 · Demo Grill");
    expect(r.body).toContain("Closes 19:00");
    expect(r.body).toContain("2 pizzas · 2 people");
    expect(r.body).toContain("Held by Pena");
    expect(r.body).toContain("You have 1 pizza here");
    expect(r.body).toContain(`href="/pizza/orders/${first}"`);
    expect(r.body).toContain('href="/pizza/start"');
    // Live: the page follows every order of the event.
    expect(r.body).toContain('data-live="/api/pizza/stream"');
  });

  it("keeps today's earlier orders under Earlier today, with how they ended", async () => {
    const id = json(await open(w, "pena", pz)).id as string;
    await addKebab("anni", id);
    for (const step of ["close", "place", "arrive", "hand-out"])
      await w.call("pena", "POST", `/api/pizza/orders/${id}/${step}`, {});
    const r = await view(w, "anni", "/");
    expect(r.body).toContain("No order is open");
    expect(r.body).toContain("Earlier today");
    expect(r.body).toContain("Order 1 · Demo Pizzeria");
    expect(r.body).toContain("Done");
  });

  it("sits in the hub's frame: the event's header back to the front door, and the hub's bar (amendment 5)", async () => {
    await open(w, "pena", pz);
    const r = await view(w, "anni", "/");
    expect(r.body).toMatch(/<a class="pizza-frame__event" href="\/"/);
    const bar = r.body.slice(r.body.indexOf('<nav class="pizza-hubbar"'));
    expect(bar).toMatch(/href="\/"[^>]*>[\s\S]*?Now/);
    expect(bar).toMatch(/href="\/pizza\/"[^>]*aria-current="page"/);
    expect(bar).toContain("More");
  });

  it("lays the open orders out as a grid of cards with the start next to their heading, never a generic split (A2)", async () => {
    await open(w, "pena", pz);
    const r = await view(w, "anni", "/");
    expect(r.body).not.toContain("pizza-split");
    const head = r.body.slice(r.body.indexOf('class="pizza-heading"'));
    expect(head.indexOf("Open orders")).toBeLessThan(head.indexOf("Start another order"));
    expect(head.indexOf("Start another order")).toBeLessThan(
      head.indexOf("Order 1 · Demo Pizzeria"),
    );
    expect(r.body).toContain('class="canccu-grid pizza-orders"');
    const css = await w.app.inject({ url: "/static/wide.css", headers: { host: "demo.test" } });
    expect(css.statusCode).toBe(200);
    expect(css.body).not.toContain("pizza-split");
  });
  it("offers one clear action when nothing is open", async () => {
    const r = await view(w, "anni", "/");
    expect(r.body).toContain("No order is open");
    expect(r.body).toContain("Start an order");
  });

  it("shows a guest what the screen shows, no names, and the way to sign in", async () => {
    const id = json(await open(w, "pena", pz)).id as string;
    await addKebab("anni", id);
    const r = await view(w, null, "/");
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Order 1 · Demo Pizzeria");
    expect(r.body).toContain("1 pizzas · 1 people");
    expect(r.body).not.toContain("Pena");
    // A guest is not told who holds it, so never that nobody does.
    expect(r.body).not.toContain("Nobody holds it");
    expect(r.body).toContain("Order with your Discord account");
    expect(r.body).toContain('href="/admin/sign-in?next=%2Fpizza%2F"');
    expect(r.body).not.toContain('href="/pizza/start"');
  });

  it("shows a guest only the way to sign in where the info pages need sign-in", async () => {
    const r = await view(w, null, "/", "closed.test");
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Order with your Discord account");
    expect(r.body).not.toContain("Open orders");
    // The stream refuses this guest too: no live page that shows "Reconnecting…" for ever.
    expect(r.body).not.toContain("data-live");
  });

  it("asks someone signed in but not in the event to join it", async () => {
    const r = await view(w, "outsider", "/");
    expect(r.body).toContain("Join the event to order");
    expect(r.body).toContain('href="/notify/join"');
    expect(r.body).not.toContain('href="/pizza/start"');
  });

  it("says ordering is closed, with the organiser's note, and offers no start", async () => {
    w.settings.set("demo", {
      ...DEFAULT_SETTINGS,
      ordering_open: false,
      ordering_note: "Breakfast orders open at 09:00",
    });
    const r = await view(w, "anni", "/");
    expect(r.body).toContain("Ordering is closed");
    expect(r.body).toContain("Breakfast orders open at 09:00");
    expect(r.body).not.toContain('href="/pizza/start"');
  });

  it("offers no start to a member when only the crew starts orders", async () => {
    w.settings.set("demo", { ...DEFAULT_SETTINGS, open_by: "crew" });
    expect((await view(w, "anni", "/")).body).not.toContain('href="/pizza/start"');
    expect((await view(w, "opener", "/")).body).toContain('href="/pizza/start"');
  });

  it("marks an order left from an earlier day, with a way to cancel it", async () => {
    const id = json(await open(w, "pena", pz)).id as string;
    w.advance(24 * 60);
    const r = await view(w, "anni", "/");
    expect(r.body).toContain("is still open from an earlier day");
    const c = await form(w, "anni", `/orders/${id}/step/cancel`);
    expect(c.statusCode).toBe(303);
    expect(location(c)).toBe("/pizza/");
    expect(json(await w.call("anni", "GET", `/api/pizza/orders/${id}`)).state).toBe("cancelled");
  });

  it("speaks Finnish when the event does", async () => {
    w.languages.set("demo", "fi");
    json(await open(w, "pena", pz));
    const r = await view(w, "anni", "/");
    expect(r.body).toContain('lang="fi"');
    expect(r.body).toContain("Avoimet tilaukset");
    expect(r.body).toContain("Tilaus 1 · Demo Pizzeria");
  });
});

describe.skipIf(!DATABASE_URL)("starting an order", () => {
  it("lists the pizzerias, offering to join one that already has an open order", async () => {
    const id = json(await open(w, "pena", pz)).id as string;
    const r = await view(w, "anni", "/start");
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Order 1 is open · join it instead?");
    expect(r.body).toContain(`href="/pizza/orders/${id}/add"`);
    expect(r.body).toContain("Demo Grill");
    expect(r.body).toContain("Takeaway: someone fetches it");
    expect(r.body).toContain(`value="${grill}"`);
  });

  it("opens the order, makes the opener its holder and says what comes next", async () => {
    const r = await form(w, "anni", "/start", {
      pizzeria_id: pz,
      closes: "19:30",
      note: "Delivery takes about 40 min",
    });
    expect(r.statusCode).toBe(303);
    const id = /\/pizza\/orders\/(po_[A-Za-z0-9_-]+)\?opened=1$/.exec(location(r))?.[1];
    expect(id).toBeDefined();
    const o = json(await w.call("anni", "GET", `/api/pizza/orders/${id}`));
    expect(o.you_hold).toBe(true);
    expect(o.closes_at).toBe("2026-10-29T17:30:00.000Z");
    expect(o.note).toBe("Delivery takes about 40 min");
    const page = await view(w, "anni", `/orders/${id}?opened=1`);
    expect(page.body).toContain("Order 1 is open");
    expect(page.body).toContain(`href="/pizza/orders/${id}/add"`);
    expect(page.body).toContain(`href="/pizza/hold/${id}"`);
  });

  it("answers a refusal on the start page, in words", async () => {
    await open(w, "pena", pz);
    const r = await form(w, "pena", "/start", { pizzeria_id: grill, closes: "19:30" });
    expect(r.statusCode).toBe(303);
    expect(location(r)).toMatch(/^\/pizza\/start\?error=/);
  });

  it("is closed to someone who may not start an order", async () => {
    w.settings.set("demo", { ...DEFAULT_SETTINGS, ordering_open: false });
    const r = await view(w, "anni", "/start");
    expect(r.statusCode).toBe(303);
    expect(location(r)).toBe("/pizza/");
  });
});

describe.skipIf(!DATABASE_URL)("the screen's QR (L6)", () => {
  it("lands on the menu of the only open order", async () => {
    const id = json(await open(w, "pena", pz)).id as string;
    const r = await view(w, "anni", "/go");
    expect(r.statusCode).toBe(303);
    expect(location(r)).toBe(`/pizza/orders/${id}/add`);
  });

  it("lands on the list when several are open, or none", async () => {
    expect(location(await view(w, "anni", "/go"))).toBe("/pizza/");
    await open(w, "pena", pz);
    await open(w, "tero", grill);
    expect(location(await view(w, "anni", "/go"))).toBe("/pizza/");
  });

  it("lands a guest on the list, where signing in is offered", async () => {
    await open(w, "pena", pz);
    expect(location(await view(w, null, "/go"))).toBe("/pizza/");
  });
});
