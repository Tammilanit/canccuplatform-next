/**
 * The pages' live stream (`GET /api/pizza/stream`, D13): server-sent events from the event's own
 * `pizza.order.*` and `pizza.item.*`, read off the bus as the module reads it in production, with
 * nothing of who ordered what; one order's page follows that order only; a guest follows the
 * info-page mode; a hang-up leaves nothing behind.
 */
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { Bus } from "@canccu/kit";
import type { TenantSubscription } from "@canccu/kit";
import {
  DATABASE_URL,
  freshDatabase,
  itemId,
  json,
  open,
  seedPizzerias,
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";

let pool: pg.Pool;
let w: World;
let pz: string;
let port: number;
let sub: TenantSubscription;

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
  await seedPizzerias(w, "two.test");
  // As main.ts wires it: every container reads the event streams and hands pizza's to its pages.
  sub = new Bus(w.store, "pizza").subscribeTenants(
    ["pizza"],
    (e) => {
      w.deps.live.handle(e);
    },
    {
      blockMs: 20,
      rescanMs: 0,
    },
  );
  await w.app.listen({ host: "127.0.0.1", port: 0 });
  port = (w.app.server.address() as AddressInfo).port;
});
afterEach(async () => {
  if (!DATABASE_URL) return;
  await sub.close();
  await w.app.close();
});

interface Follow {
  status: number;
  text: () => string;
  until: (needle: string) => Promise<void>;
  close: () => void;
}

/** Opens the stream as a browser's EventSource does and keeps what it has read. */
function follow(
  who: string | null,
  path = "/api/pizza/stream",
  host = "demo.test",
): Promise<Follow> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        headers: {
          host,
          accept: "text/event-stream",
          ...(who === null ? {} : { cookie: `canccu_session=${who}` }),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (text += c));
        resolve({
          status: res.statusCode ?? 0,
          text: () => text,
          until: async (needle) => {
            for (let i = 0; i < 200 && !text.includes(needle); i++)
              await new Promise((r) => setTimeout(r, 10));
            if (!text.includes(needle)) throw new Error(`no "${needle}" in: ${text}`);
          },
          close: () => req.destroy(),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe.skipIf(!DATABASE_URL)("the live stream", () => {
  it("says ready, then each change of the event's orders, and nothing of another event", async () => {
    const f = await follow("anni");
    expect(f.status).toBe(200);
    await f.until("event: ready");
    const id = json(await open(w, "pena", pz)).id as string;
    await f.until("pizza.order.opened");
    expect(f.text()).toContain(`"order_id":"${id}"`);
    expect(f.text()).toContain(`"state":"open"`);
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`, {});
    await f.until("pizza.order.closed");
    const before = f.text();
    const two = await w.call("pena", "GET", "/api/pizza/pizzerias", undefined, {
      host: "two.test",
    });
    const other = (json(two).pizzerias as { id: string }[])[0]?.id ?? "";
    const elsewhere = await w.call(
      "tero",
      "POST",
      "/api/pizza/orders",
      { pizzeria_id: other, closes_at: new Date(w.now.getTime() + 3600_000).toISOString() },
      { host: "two.test" },
    );
    expect(elsewhere.statusCode).toBe(201);
    await new Promise((r) => setTimeout(r, 200));
    expect(f.text().slice(before.length)).not.toContain("pizza.order.opened");
    f.close();
  });

  it("follows one order on that order's page", async () => {
    const first = json(await open(w, "pena", pz)).id as string;
    const f = await follow("anni", `/api/pizza/stream?order=${first}`);
    await f.until("event: ready");
    const grill = (
      json(await w.call("anni", "GET", "/api/pizza/pizzerias")).pizzerias as {
        id: string;
        name: string;
      }[]
    ).find((p) => p.name === "Demo Grill")?.id as string;
    await open(w, "tero", grill);
    await w.call("pena", "POST", `/api/pizza/orders/${first}/close`, {});
    await f.until("pizza.order.closed");
    expect(f.text()).not.toContain("pizza.order.opened");
    f.close();
  });

  it("carries the order and its revision for a pizza, never whose it is", async () => {
    const id = json(await open(w, "pena", pz)).id as string;
    const f = await follow("mikko");
    await f.until("event: ready");
    await w.call("anni", "POST", `/api/pizza/orders/${id}/items`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, "12"),
      note: "no onion",
    });
    await f.until("pizza.item.added");
    expect(f.text()).not.toMatch(/anni|no onion|Kebab/i);
    f.close();
  });

  it("lets a guest follow where the info pages are public, and refuses one where they are not", async () => {
    const f = await follow(null);
    expect(f.status).toBe(200);
    f.close();
    const closed = await follow(null, "/api/pizza/stream", "closed.test");
    expect(closed.status).toBe(403);
    closed.close();
  });

  it("forgets a stream whose page hung up", async () => {
    const f = await follow("anni");
    await f.until("event: ready");
    expect(w.deps.live.size()).toBe(1);
    f.close();
    for (let i = 0; i < 100 && w.deps.live.size() > 0; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(w.deps.live.size()).toBe(0);
  });
});
