/**
 * The crew's pages (mockups 10, 11 A–C, 17 A and B) on the server: the day's orders with what
 * needs the crew, stepping in with a reason, the history; pizzerias and the menu CSV's preview,
 * apply and download; Food settings through admin's settings API; who may open which.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { SPEC_MENU } from "./fixtures.js";
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
    "TRUNCATE pizza_due, pizza_crew, pizza_pizzerias, pizza_menu_entries, pizza_orders, pizza_items, pizza_order_log, pizza_idempotency, pizza_outbox, pizza_outbox_tenants, pizza_tenants",
  );
  w = await world(pool);
  ({ pz } = await seedPizzerias(w));
  id = json(await open(w, "pena", pz)).id as string;
  await w.call("anni", "POST", `/api/pizza/orders/${id}/items`, {
    kind: "menu",
    menu_item_id: await itemId(w, pz, "1"),
    comment: "one is for a friend",
  });
});

const location = (r: { headers: Record<string, unknown> }) => String(r.headers.location);
const order = async () => json(await w.call("crew", "GET", `/api/pizza/orders/${id}`));

describe.skipIf(!DATABASE_URL)("the crew's Food page", () => {
  it("lists the day's orders with what needs the crew, on the desk and on a phone", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`);
    await w.call("pena", "POST", `/api/pizza/orders/${id}/release`);
    const r = await view(w, "crew", "/crew");
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Demo Pizzeria");
    expect(r.body).toContain("Closed · Nobody holds it");
    expect(r.body).toContain("Needs you · 1");
    expect(r.body).toContain("pizza-desk");
    expect(r.body).toContain("pizza-phone");
    expect(r.body).toContain(`href="/pizza/crew/orders/${id}"`);
    expect(r.body).toContain('aria-current="page"');
  });

  it("shows one order's people with their comments, and its history", async () => {
    const r = await view(w, "crew", `/crew/orders/${id}`);
    expect(r.body).toContain("Order 1 · Demo Pizzeria");
    expect(r.body).toContain("Anni");
    expect(r.body).toContain("comment: one is for a friend");
    expect(r.body).toContain("Opened by Pena");
    expect(r.body).toContain("Pizza added by Anni");
    expect(r.body).toContain("Take over");
  });

  it("steps in with a reason that reaches the audit log, marking arrived included", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`);
    const r = await form(w, "crew", `/crew/orders/${id}`, {
      step: "arrive",
      reason: "The delivery asked at the door",
      pickup: "Info desk",
    });
    expect(location(r)).toBe(`/pizza/crew/orders/${id}`);
    const o = await order();
    expect(o.state).toBe("arrived");
    expect(o.pickup).toBe("Info desk");
    expect(w.audit.at(-1)).toMatchObject({
      action: "pizza.order.arrived",
      reason: "The delivery asked at the door",
    });
    expect((await view(w, "crew", `/crew/orders/${id}`)).body).toContain(
      "Here, said Crew · Info desk",
    );
  });

  it("cancels a called-in order with the crew's words", async () => {
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`);
    await form(w, "crew", `/crew/orders/${id}`, { step: "cancel", reason: "Wrong pizzeria" });
    const o = await order();
    expect(o.state).toBe("cancelled");
    expect(o.cancel_reason).toBe("Wrong pizzeria");
  });

  it("is the crew's: a member gets a refusal, a menu writer the menus", async () => {
    expect((await view(w, "anni", "/crew")).statusCode).toBe(403);
    expect((await view(w, "anni", `/crew/orders/${id}`)).statusCode).toBe(403);
    const r = await view(w, "menus", "/crew");
    expect(location(r)).toBe("/pizza/crew/pizzerias");
  });
});

describe.skipIf(!DATABASE_URL)("pizzerias and menus", () => {
  it("lists the pizzerias with their menus' size and web page", async () => {
    const r = await view(w, "menus", "/crew/pizzerias");
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Demo Pizzeria");
    expect(r.body).toContain("Delivers · 4 items · no prices");
    expect(r.body).toContain("pizzeria.example ↗");
    expect(r.body).toContain("Demo Grill");
    expect(r.body).toContain("Takeaway · 1 item · prices");
    expect(r.body).toContain("No web page yet");
  });

  it("previews a menu CSV item by item, applies it, and downloads it", async () => {
    const csv = SPEC_MENU.replace("Demo Trattoria,+000", "Demo Pizzeria,+000")
      .replaceAll("Demo Trattoria,,", "Demo Pizzeria,,")
      .replace("item,4,Margherita", "item,1,Margherita");
    const r = await form(w, "menus", "/crew/pizzerias/import", { csv });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("12 Kebab");
    expect(r.body).toContain("new description");
    expect(r.body).toContain("7 Funghi");
    expect(r.body).toContain("Demo Pizzeria · new · € 8.50");
    expect(r.body).toContain("20 Kinkku");
    expect(r.body).toContain("not in the file: hidden, old orders keep it");
    expect(r.body).toContain("Demo Corner Grill · a new pizzeria with 1 items");
    expect(r.body).toContain("Row 7");
    expect(r.body).not.toMatch(/<button[^>]*disabled[^>]*>\s*Apply/);

    const applied = await form(w, "menus", "/crew/pizzerias/import/apply", { csv });
    expect(location(applied)).toBe("/pizza/crew/pizzerias");
    const list = await view(w, "menus", "/crew/pizzerias");
    expect(list.body).toContain("Demo Corner Grill");

    const file = await view(w, "menus", `/crew/pizzerias/menu.csv?pizzeria_id=${pz}`);
    expect(file.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(file.body.split("\n")[0]).toBe(
      "pizzeria,phone,website,service,kind,number,name,description,price",
    );
    expect(file.body).toContain("Demo Pizzeria");
  });

  it("stops at the preview on an error, by row, with Apply off", async () => {
    const r = await form(w, "menus", "/crew/pizzerias/import", {
      csv: "pizzeria,name,price\nDemo Pizzeria,Margherita,abc\n",
    });
    expect(r.body).toContain("Errors: fix these");
    expect(r.body).toContain("Row 2");
    expect(r.body).toMatch(/<button[^>]*disabled[^>]*>\s*Apply/);
  });

  it("edits a pizzeria's phone, web page and service, and hides it", async () => {
    await form(w, "menus", `/crew/pizzerias/${pz}`, {
      do: "save",
      name: "Demo Pizzeria",
      phone: "+000 111",
      website: "https://new.example",
      service: "takeaway",
    });
    const p = json(await w.call("menus", "GET", `/api/pizza/pizzerias/${pz}`));
    expect(p).toMatchObject({
      phone: "+000 111",
      website: "https://new.example",
      service: "takeaway",
    });
    const r = await form(w, "menus", `/crew/pizzerias/${pz}`, { do: "hide" });
    expect(location(r)).toBe("/pizza/crew/pizzerias");
    expect((await view(w, "menus", "/crew/pizzerias")).body).not.toContain(">Demo Pizzeria<");
  });

  it("is the menu writers'", async () => {
    expect((await view(w, "crew", "/crew/pizzerias")).statusCode).toBe(403);
  });
});

describe.skipIf(!DATABASE_URL)("Food settings", () => {
  it("shows the event's settings, with the legacy defaults", async () => {
    const r = await view(w, "organiser", "/crew/settings");
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Last call before the close");
    expect(r.body).toContain('name="last_call_minutes"');
    expect(r.body).toMatch(/name="release_after_minutes"[^>]*value="120"/);
    expect(r.body).toContain("2 h");
  });

  it("saves through admin's settings API, keeping what the page does not show", async () => {
    w.adminSettings.values = { settle_to_payer: true, max_open_orders: 3 };
    const r = await form(w, "organiser", "/crew/settings", {
      settings_version: "1",
      ordering_open: "off",
      open_by: "crew",
      max_open_orders: "4",
      max_items_per_person: "5",
      last_call_minutes: "15",
      remind_holder_minutes: "45",
      remind_crew_minutes: "90",
      release_after_minutes: "180",
      arrival_check_minutes: "30",
      arrival_check_no_estimate_minutes: "90",
      done_after_arrival_minutes: "120",
      auto_close: "off",
      close_forgotten: "on",
    });
    expect(location(r)).toBe("/pizza/crew/settings");
    expect(w.adminSettings.writes.at(-1)).toEqual({
      host: "demo.test",
      values: {
        ...DEFAULT_SETTINGS,
        settle_to_payer: true,
        ordering_open: false,
        open_by: "crew",
        max_open_orders: 4,
        last_call_minutes: 15,
        remind_holder_minutes: 45,
        remind_crew_minutes: 90,
        release_after_minutes: 180,
        auto_close: false,
      },
    });
  });

  it("says when someone saved meanwhile", async () => {
    const r = await form(w, "organiser", "/crew/settings", { settings_version: "0" });
    expect(location(r)).toMatch(/^\/pizza\/crew\/settings\?error=Someone/);
    expect(w.adminSettings.writes).toHaveLength(0);
  });

  it("is for whoever may write the event's settings", async () => {
    expect((await view(w, "crew", "/crew/settings")).statusCode).toBe(403);
  });
});
