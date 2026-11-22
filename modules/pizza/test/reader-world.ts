/**
 * The reader tests' world (reader.test.ts, reader-menu.test.ts): an order at the demo pizzeria with
 * Anni's two Margheritas and Mikko's Kebab, called in, the AI reader on, and the fake reader's
 * receipt pricing them unlike the menu, with a line for no pizza and a delivery.
 */
import { afterAll, beforeAll, beforeEach } from "vitest";
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
import { png } from "./images.js";

export const KEY = "sk-ant-demo-0000000000000000wxyz";

export interface ReaderWorld {
  pool: pg.Pool;
  w: World;
  pz: string;
  id: string;
  items: { anni: string; anni2: string; mikko: string };
}

/** Registers the file's hooks; the world is set up afresh before each test. */
export function useReaderWorld(): ReaderWorld {
  const r = {} as ReaderWorld;
  beforeAll(async () => {
    if (DATABASE_URL) r.pool = await freshDatabase();
  });
  afterAll(async () => {
    if (DATABASE_URL) await r.pool.end();
  });
  beforeEach(async () => {
    if (!DATABASE_URL) return;
    await r.pool.query(TRUNCATE);
    const w = await world(r.pool);
    r.w = w;
    w.settings.set("demo", { ...DEFAULT_SETTINGS, ai_reader: true });
    const { pz } = await seedPizzerias(w);
    r.pz = pz;
    const id = json(await open(w, "pena", pz)).id as string;
    r.id = id;
    const add = async (who: string, number: string) =>
      json(
        await w.call(who, "POST", `/api/pizza/orders/${id}/items`, {
          kind: "menu",
          menu_item_id: await itemId(w, pz, number),
        }),
      ).id as string;
    r.items = {
      anni: await add("anni", "1"),
      anni2: await add("anni", "1"),
      mikko: await add("mikko", "12"),
    };
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
    // Two Margheritas at 8.50 (the menu says 8.00), a Kebab at 9.50, delivery, and a line for no pizza.
    w.reader.receipt = {
      total_cents: 3200,
      lines: [
        {
          text: "2 x 1 Margherita 17.00",
          number: "1",
          name: "Margherita",
          quantity: 2,
          amount_cents: 1700,
          kind: "item",
        },
        {
          text: "1 x 12 Kebab 9.50",
          number: "12",
          name: "Kebab",
          quantity: 1,
          amount_cents: 950,
          kind: "item",
        },
        {
          text: "Garlic bread 2.50",
          number: null,
          name: "Garlic bread",
          quantity: 1,
          amount_cents: 250,
          kind: "item",
        },
        {
          text: "Delivery 3.00",
          number: null,
          name: "Delivery",
          quantity: 1,
          amount_cents: 300,
          kind: "extra",
        },
      ],
    };
  });
  return r;
}

/** The calls the tests make, on the world as it is when they run. */
export function readerCalls(r: ReaderWorld) {
  const setKey = (who = "integrator", key = KEY) =>
    r.w.call(who, "PUT", "/api/pizza/reader/key", { api_key: key });
  const keyStatus = (who = "integrator") => r.w.call(who, "GET", "/api/pizza/reader/key");
  const addReceipt = async (photo?: Buffer) =>
    json(
      await r.w.call("pena", "POST", `/api/pizza/orders/${r.id}/receipts`, undefined, {
        raw: photo ?? (await png()),
        contentType: photo === undefined ? "image/png" : "image/jpeg",
      }),
    ).id as string;
  const read = (receipt: string, who = "pena") =>
    r.w.call(who, "POST", `/api/pizza/receipts/${receipt}/read`, {});
  const money = () => r.w.call("pena", "GET", `/api/pizza/orders/${r.id}/money`);
  return { setKey, keyStatus, addReceipt, read, money };
}
