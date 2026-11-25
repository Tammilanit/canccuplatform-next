/**
 * A receipt's group line on the check page (#789 item 9): "4 × pizza" keeps the menu prices, its
 * difference shows with the extras, a count unlike the order's pizzas is checked first, and a
 * confirm sets the total with the difference shared per pizza.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import type { ReceiptLine } from "../src/reader.js";
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
let id: string;

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
  const { pz } = await seedPizzerias(w);
  id = json(await open(w, "pena", pz)).id as string;
  // Kebab 9.50 ×2, Margherita 8.00, Pepperoni 9.00: 36.00 at the menu's prices.
  for (const [who, number] of [
    ["anni", "12"],
    ["anni", "12"],
    ["mikko", "1"],
    ["pena", "3"],
  ] as const) {
    await w.call(who, "POST", `/api/pizza/orders/${id}/items`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, number),
    });
  }
  await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
  w.settings.set("demo", { ...DEFAULT_SETTINGS, ai_reader: true });
  await w.call("integrator", "PUT", "/api/pizza/reader/key", {
    api_key: "sk-ant-demo-key-0000wxyz",
  });
});

const location = (r: { headers: Record<string, unknown> }) => String(r.headers.location);
const group = (o: Partial<ReceiptLine>): ReceiptLine => ({
  text: "4 x pizza 40.00",
  number: null,
  name: "pizza",
  quantity: 4,
  amount_cents: 4000,
  kind: "item",
  group: true,
  unit_cents: null,
  ...o,
});
const read = async (lines: ReceiptLine[], total: number) => {
  w.reader.receipt = { total_cents: total, lines };
  const r = await upload(w, "pena", `/hold/${id}/money/scan`, [
    { name: "receipt.png", type: "image/png", bytes: await png() },
  ]);
  return {
    receipt: new URL(location(r), "http://x").searchParams.get("receipt") ?? "",
    page: (await view(w, "pena", location(r).replace("/pizza", ""))).body,
  };
};

describe.skipIf(!DATABASE_URL)("a receipt's group line on the check page (#789 item 9)", () => {
  it("keeps the menu prices, shows the difference with the extras and adds up", async () => {
    const { page } = await read([group({})], 4000);
    expect(page).toContain("On “4 x pizza 40.00” · €9.50 as the menu");
    expect(page).toContain("4 x pizza 40.00 · beyond the menu prices");
    expect(page).toContain("€4.00");
    expect(page).toContain("Adds up to €40.00 ✓");
    expect(page).not.toContain("Matches no pizza");
  });

  it("sets each pizza to the line's unit price", async () => {
    const { page } = await read(
      [group({ text: "4 x pizza à 10,00 40,00", unit_cents: 1000 })],
      4000,
    );
    expect(page).toContain("On “4 x pizza à 10,00 40,00” · €10.00 each");
    expect(page).toContain("Adds up to €40.00 ✓");
  });

  it("checks first a count unlike the order's pizzas", async () => {
    const { page } = await read(
      [group({ text: "5 x pizza 50.00", quantity: 5, amount_cents: 5000 })],
      5000,
    );
    const first = page.slice(page.indexOf("Check these first"));
    expect(first).toContain("5 x pizza 50.00");
    expect(first).toContain("Counts 5 pizzas; the order has 4 for it");
  });

  it("a confirm sets the total and keeps the menu prices; the difference is shared", async () => {
    const { receipt } = await read([group({})], 4000);
    const items = json(await w.call("pena", "GET", `/api/pizza/orders/${id}/money`)).prices as {
      item_id: string;
      price_cents: number;
    }[];
    const fields: Record<string, string> = { receipt_id: receipt, total: "40.00" };
    for (const i of items) fields[`price_${i.item_id}`] = (i.price_cents / 100).toFixed(2);
    await form(w, "pena", `/hold/${id}/money/check`, fields);
    const m = json(await w.call("pena", "GET", `/api/pizza/orders/${id}/money`));
    expect(m).toMatchObject({ total_cents: 4000, split_effective: "exact", extras_cents: 400 });
  });
});
