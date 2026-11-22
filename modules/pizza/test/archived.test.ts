/**
 * An archived event (contracts/pizza.md, Errors): food is read-only, every write answers 409
 * `event_archived`, and deleting one's own data still works.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DATABASE_URL, TRUNCATE, errorOf, freshDatabase, json, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { png } from "./images.js";

let pool: pg.Pool;
let w: World;
const host = "archived.test";

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
});

describe.skipIf(!DATABASE_URL)("an archived event", () => {
  it.each([
    ["menus", "POST", "/api/pizza/pizzerias", { name: "Demo Pizzeria" }],
    ["opener", "POST", "/api/pizza/orders", { pizzeria_id: "pz_x" }],
    ["pena", "PUT", "/api/pizza/me/pay-details", { mobilepay: "040 000 0000", iban: null }],
    ["integrator", "PUT", "/api/pizza/reader/key", { api_key: "sk-ant-demo-0000000000000000wxyz" }],
  ])("answers %s's %s %s with 409 event_archived", async (who, method, url, body) => {
    const r = await w.call(who, method as "POST" | "PUT", url, body, { host });
    expect(r.statusCode).toBe(409);
    expect(errorOf(r).code).toBe("event_archived");
  });

  it("refuses a menu photo's read with 409 event_archived", async () => {
    const r = await w.call("menus", "POST", "/api/pizza/menu/read", undefined, {
      host,
      raw: await png(),
      contentType: "image/png",
    });
    expect(r.statusCode).toBe(409);
    expect(errorOf(r).code).toBe("event_archived");
  });

  it("still reads, and still deletes a person's own data (204)", async () => {
    expect(
      json(await w.call("pena", "GET", "/api/pizza/pizzerias", undefined, { host })).pizzerias,
    ).toEqual([]);
    expect((await w.call("pena", "DELETE", "/api/pizza/me", undefined, { host })).statusCode).toBe(
      204,
    );
  });
});
