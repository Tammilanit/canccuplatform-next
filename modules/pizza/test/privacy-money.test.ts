/**
 * The money data under the privacy rules (contracts/pizza.md, Data and privacy): Paid marks, "Pay
 * me with", receipt photos and the reader's key in the export, the delete, the 12-month retention
 * and a deleted event.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { handlePlatformEvent, handleTenantEvent } from "../src/consumer.js";
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

let pool: pg.Pool;
let w: World;
let id: string;
let receipt: string;
const PAY = { mobilepay: "040 000 0000", iban: "FI21 1234 5600 0007 85" };

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
  w.settings.set("demo", { ...DEFAULT_SETTINGS, settle_to_payer: true, ai_reader: true });
  const { pz } = await seedPizzerias(w);
  id = json(await open(w, "pena", pz)).id as string;
  for (const who of ["anni", "mikko"]) {
    await w.call(who, "POST", `/api/pizza/orders/${id}/items`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, "1"),
    });
  }
  await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
  await w.call("pena", "PUT", "/api/pizza/me/pay-details", PAY);
  await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, {
    total_cents: 1700,
    settle_to: "payer",
  });
  await w.call("pena", "PUT", `/api/pizza/orders/${id}/paid/u_anni`, { paid: true });
  await w.call("pena", "PUT", `/api/pizza/orders/${id}/paid/u_mikko`, { paid: true });
  receipt = json(
    await w.call("pena", "POST", `/api/pizza/orders/${id}/receipts`, undefined, {
      raw: await png(),
      contentType: "image/png",
    }),
  ).id as string;
  receiptName = (
    (await pool.query("SELECT file FROM pizza_receipts WHERE id = $1", [receipt])).rows[0] as {
      file: string;
    }
  ).file;
  await w.call("integrator", "PUT", "/api/pizza/reader/key", {
    api_key: "sk-ant-demo-0000000000000000wxyz",
  });
});

const count = async (table: string, where = "true", values: unknown[] = []) =>
  (
    (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, values))
      .rows[0] as {
      n: number;
    }
  ).n;
// The server keeps the photo it re-encoded (a PNG becomes a JPEG), so the file's name comes from its row.
let receiptName = "";
const receiptFile = () => join(w.filesRoot, "demo", "pizza", "receipts", receiptName);
const event = (type: string, data: Record<string, unknown>, tenant?: string): Event => ({
  id: `e_${type}_${Math.random()}`,
  type,
  version: 1,
  time: w.now.toISOString(),
  source: "tenants",
  ...(tenant === undefined ? {} : { tenant }),
  data,
});

describe.skipIf(!DATABASE_URL)("the money data and privacy", () => {
  it("is set up: two Paid marks, the payer's details, a receipt on disk and the reader's key", async () => {
    expect(await count("pizza_paid")).toBe(2);
    expect(await count("pizza_pay_details")).toBe(1);
    expect(await count("pizza_receipts")).toBe(1);
    expect(existsSync(receiptFile())).toBe(true);
    expect(await count("pizza_reader_keys")).toBe(1);
  });

  it("exports a person's Paid marks and the reader the event sends photos to", async () => {
    const r = json(await w.call("anni", "GET", "/api/pizza/me/export"));
    expect(r.paid_marks).toEqual([{ order_id: id, at: w.now.toISOString() }]);
    expect(r.reader).toMatchObject({ provider: "Anthropic" });
    await w.call("integrator", "DELETE", "/api/pizza/reader/key");
    expect(json(await w.call("anni", "GET", "/api/pizza/me/export")).reader).toBeNull();
  });

  it("deletes the caller's Paid marks with DELETE /me, and nobody else's", async () => {
    expect((await w.call("anni", "DELETE", "/api/pizza/me")).statusCode).toBe(204);
    expect(await count("pizza_paid", "user_id = $1", ["u_anni"])).toBe(0);
    expect(await count("pizza_paid", "user_id = $1", ["u_mikko"])).toBe(1);
    expect(json(await w.call("anni", "GET", "/api/pizza/me/export")).paid_marks).toEqual([]);
  });

  it("deletes every Paid mark, every 'Pay me with' and every receipt at retention", async () => {
    await withTenant("demo", () =>
      handleTenantEvent(
        w.deps,
        event("tenants.retention.reached", { data_class: "personal" }, "demo"),
      ),
    );
    expect(await count("pizza_paid")).toBe(0);
    expect(await count("pizza_pay_details")).toBe(0);
    expect(await count("pizza_receipts")).toBe(0);
    expect(existsSync(receiptFile())).toBe(false);
    // The key is the event's, not a person's: it stays, without who set it.
    expect(await count("pizza_reader_keys", "set_by_user_id IS NULL")).toBe(1);
  });

  it("deletes a deleted event's receipt files and the reader's key", async () => {
    await handlePlatformEvent(w.deps, event("tenants.tenant.deleted", { tenant_id: "demo" }));
    expect(existsSync(receiptFile())).toBe(false);
    expect(existsSync(join(w.filesRoot, "demo", "pizza", "receipts"))).toBe(false);
    for (const table of ["pizza_reader_keys", "pizza_paid", "pizza_pay_details", "pizza_receipts"])
      expect(await count(table)).toBe(0);
  });
});
