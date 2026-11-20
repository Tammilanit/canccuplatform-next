/**
 * The organiser's money pages (#644; mockups 12, 17 C, 11 D and Integrations) on the server: the
 * daily record and one order's money, the export with the orders left out named, settling up and
 * the AI reader in Food settings, the provider key in Integrations and reading a menu photo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import {
  DATABASE_URL,
  TRUNCATE,
  freshDatabase,
  itemId,
  json,
  open,
  seedPizzerias,
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";
import { form, upload, view } from "./forms.js";
import { png } from "./images.js";

let pool: pg.Pool;
let w: World;
let pz: string;
let grill: string;
let one: string;
let two: string;
const KEY = "sk-ant-demo-key-0000wxyz";

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
  ({ pz, grill } = await seedPizzerias(w));
  one = json(await open(w, "pena", pz)).id as string;
  for (const [who, number] of [
    ["anni", "12"],
    ["mikko", "1"],
  ] as const) {
    await w.call(who, "POST", `/api/pizza/orders/${one}/items`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, number),
    });
  }
  await w.call("pena", "POST", `/api/pizza/orders/${one}/place`, {});
  await w.call("pena", "PATCH", `/api/pizza/orders/${one}/money`, { total_cents: 2000, settle_to: "payer" });
  await w.call("pena", "PUT", `/api/pizza/orders/${one}/paid/u_anni`, { paid: true });
  two = json(await open(w, "tero", grill)).id as string;
  await w.call("tero", "POST", `/api/pizza/orders/${two}/items`, { kind: "text", text: "Burger" });
  await w.call("tero", "POST", `/api/pizza/orders/${two}/place`, {});
});

describe.skipIf(!DATABASE_URL)("the daily record and the export (mockup 12)", () => {
  it("lists the day's orders with total, split, payer, settle to and flags", async () => {
    const r = await view(w, "treasurer", "/crew/record");
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Record");
    expect(r.body).toContain("Whole event");
    expect(r.body).toContain("Order 1 · Demo Pizzeria");
    expect(r.body).toContain("€20.00 · exact amounts");
    expect(r.body).toContain("Paid by Pena · paid to them");
    expect(r.body).toContain("Order 1 · Demo Grill");
    expect(r.body).toContain("No total yet");
    expect(r.body).toContain("total missing");
    expect(r.body).toContain("Export for the payment system");
  });

  it("shows one order's money: each person, the sum, who is paid and the marks", async () => {
    const r = await view(w, "treasurer", `/crew/record/${one}`);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Pena paid the pizzeria");
    expect(r.body).toContain("€20.00 · total typed in");
    expect(r.body).toContain("Anni");
    expect(r.body).toContain("€10.75");
    expect(r.body).toContain("Sum €20.00 = the order");
    expect(r.body).toContain("Settles to Pena directly");
    expect(r.body).toContain("1 of 2 marked paid");
  });

  it("names the orders the export leaves out, previews it, and links the file", async () => {
    const r = await view(w, "treasurer", "/crew/export?day=2026-10-29");
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("1 orders · 2 rows");
    expect(r.body).toContain("Order 1 is left out");
    expect(r.body).toContain("It has no total yet.");
    expect(r.body).toContain("Anni");
    expect(r.body).toContain("10.75");
    expect(r.body).toContain('href="/api/pizza/export.csv?day=2026-10-29"');
  });

  it("is for pizza.record.read only", async () => {
    expect((await view(w, "crew", "/crew/record")).statusCode).toBe(403);
    expect((await view(w, "pena", "/crew/export")).statusCode).toBe(403);
  });
});

describe.skipIf(!DATABASE_URL)("settling up and the AI reader in Food settings (mockup 17 C)", () => {
  it("lets holders take payment, and hides the reader without a key", async () => {
    let page = (await view(w, "organiser", "/crew/settings")).body;
    expect(page).toContain("Let holders take payment");
    expect(page).not.toContain("Read receipts and menus");
    await w.call("organiser", "PUT", "/api/pizza/reader/key", { api_key: KEY });
    page = (await view(w, "organiser", "/crew/settings")).body;
    expect(page).toContain("Read receipts and menus");
    expect(page).toContain("Anthropic, Claude Haiku 5.5");
    await form(w, "organiser", "/crew/settings", {
      settings_version: "1",
      settle_to_payer: "on",
      ai_reader: "on",
      ai_reader_daily_reads: "40",
    });
    expect(w.adminSettings.writes.at(-1)?.values).toMatchObject({
      settle_to_payer: true,
      ai_reader: true,
      ai_reader_daily_reads: 40,
    });
  });
});

describe.skipIf(!DATABASE_URL)("Admin → Integrations", () => {
  it("sets, shows by its last four, and revokes the reader's key; never shows it", async () => {
    let page = await view(w, "integrator", "/integrations");
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("No key is set");
    expect(page.body).toContain('type="password"');
    await form(w, "integrator", "/integrations/key", { api_key: KEY });
    page = await view(w, "integrator", "/integrations");
    expect(page.body).toContain("Key ending wxyz");
    expect(page.body).toContain("Set by Integrator");
    expect(page.body).not.toContain(KEY);
    await form(w, "integrator", "/integrations/revoke");
    expect((await view(w, "integrator", "/integrations")).body).toContain("No key is set");
  });

  it("is for admin.integrations.write only", async () => {
    expect((await view(w, "crew", "/integrations")).statusCode).toBe(403);
  });
});

describe.skipIf(!DATABASE_URL)("reading a menu photo (mockup 11 D)", () => {
  it("is offered only with the reader on, says where the photo goes, and gives the import a CSV", async () => {
    expect((await view(w, "organiser", `/crew/pizzerias/${pz}`)).body).not.toContain("Read a photo");
    w.settings.set("demo", { ...DEFAULT_SETTINGS, ai_reader: true });
    await w.call("organiser", "PUT", "/api/pizza/reader/key", { api_key: KEY });
    expect((await view(w, "organiser", `/crew/pizzerias/${pz}`)).body).toContain("Read a photo");
    const read = await view(w, "organiser", `/crew/pizzerias/${pz}/read`);
    expect(read.body).toContain("The photo goes to Anthropic to be read.");
    const r = await upload(w, "organiser", `/crew/pizzerias/${pz}/read`, [
      { name: "page1.png", type: "image/png", bytes: await png() },
      { name: "page2.png", type: "image/png", bytes: await png() },
    ]);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Read 6 items · check them first");
    expect(r.body).toContain("unsure: check it");
    expect(r.body).toContain("Use as import");
    expect(r.body).toContain('action="/pizza/crew/pizzerias/import"');
    expect(r.body.match(/pizzeria,kind,number/g)?.length).toBe(1);
  });
});
