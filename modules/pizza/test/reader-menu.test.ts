/**
 * The AI reader on a menu photo, and what the privacy delete leaves of a confirmed read (#644; the
 * plan, The optional AI reader).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DATABASE_URL, errorOf, json } from "./helpers.js";
import type { World } from "./helpers.js";
import { png } from "./images.js";
import { readerCalls, useReaderWorld } from "./reader-world.js";
import type { ReaderWorld } from "./reader-world.js";

let pool: pg.Pool;
let w: World;
let pz: string;
let id: string;
let items: ReaderWorld["items"];
const r = useReaderWorld();
const { setKey, keyStatus, addReceipt, read, money } = readerCalls(r);
beforeEach(() => {
  ({ pool, w, pz, id, items } = r);
});

describe.skipIf(!DATABASE_URL)("reading a menu photo", () => {
  it("gives a menu CSV for the import's preview, and keeps no photo", async () => {
    await setKey();
    const res = await w.call("menus", "POST", `/api/pizza/menu/read?pizzeria_id=${pz}`, undefined, {
      raw: await png(),
      contentType: "image/png",
    });
    expect(res.statusCode).toBe(200);
    const r = json(res);
    expect(r).toMatchObject({ items: 3, unsure: ["12"] });
    const csv = r.csv as string;
    expect(csv.split("\n")[0]).toBe("pizzeria,kind,number,name,description,price");
    expect(csv).toContain('Demo Pizzeria,item,4,Margherita,"tomato, mozzarella",8.00');
    const preview = await w.call("menus", "POST", "/api/pizza/menu/import/preview", undefined, {
      raw: csv,
      contentType: "text/csv",
    });
    expect(preview.statusCode).toBe(200);
    expect(json(preview)).toMatchObject({
      pizzerias: [expect.objectContaining({ status: "matched" })],
    });
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM pizza_receipts");
    expect(rows[0]).toEqual({ n: 0 });
  });

  it("needs pizza.menu.write", async () => {
    await setKey();
    const res = await w.call("pena", "POST", `/api/pizza/menu/read?pizzeria_id=${pz}`, undefined, {
      raw: await png(),
      contentType: "image/png",
    });
    expect(errorOf(res).code).toBe("missing_right");
  });
});

describe.skipIf(!DATABASE_URL)("the privacy delete and a confirmed read", () => {
  it("leaves no user id or name in the money view, the receipts or the key status", async () => {
    await setKey();
    const receipt = await addReceipt();
    expect((await read(receipt)).statusCode).toBe(200);
    // Anni's pizza is in the stored read; Pena, the holder, confirms the total.
    expect(
      (
        await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, {
          total_cents: 3200,
          receipt_id: receipt,
        })
      ).statusCode,
    ).toBe(200);
    expect((await money()).body).toContain("Anni");
    const found = await pool.query<{ user_id: string }>(
      "SELECT user_id FROM pizza_items WHERE id = $1",
      [items.anni],
    );
    const anniId = found.rows[0]?.user_id ?? "";
    expect(anniId).not.toBe("");
    const mikkoId = (
      await pool.query<{ user_id: string }>("SELECT user_id FROM pizza_items WHERE id = $1", [
        items.mikko,
      ])
    ).rows[0]?.user_id as string;
    await w.call("anni", "DELETE", "/api/pizza/me");
    await w.call("pena", "DELETE", "/api/pizza/me");
    await w.call("integrator", "DELETE", "/api/pizza/me");
    await w.call("mikko", "DELETE", "/api/pizza/me");
    const shown = [
      (await w.call("organiser", "GET", `/api/pizza/orders/${id}/money`)).body,
      (await w.call("organiser", "GET", `/api/pizza/orders/${id}/receipts`)).body,
      (await keyStatus()).body,
    ].join("\n");
    expect(shown).not.toContain(anniId);
    expect(shown).not.toContain("Anni");
    expect(shown).not.toContain("Integrator");
    expect(shown).not.toContain("Pena");
    expect(shown).not.toContain("Mikko");
    const stored = await pool.query(
      "SELECT read::text AS r, total_set_by_name AS n FROM pizza_receipts, pizza_orders WHERE pizza_orders.id = pizza_receipts.order_id",
    );
    const rows = JSON.stringify(stored.rows);
    expect(rows).not.toContain(anniId);
    expect(rows).not.toContain("Anni");
    expect(rows).not.toContain("Mikko");
    expect(rows).not.toContain(mikkoId);
  });

  it("does not store a person deleted while the provider was still reading", async () => {
    await setKey();
    const receipt = await addReceipt();
    const anniId = (
      await pool.query<{ user_id: string }>("SELECT user_id FROM pizza_items WHERE id = $1", [
        items.anni,
      ])
    ).rows[0]?.user_id as string;
    let release!: () => void;
    w.reader.hold = new Promise<void>((r) => (release = r));
    const reading = read(receipt);
    // Wait until the module has handed the photo to the provider, then delete Anni.
    for (let i = 0; i < 200 && w.reader.sent.length === 0; i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(w.reader.sent).toHaveLength(1);
    await w.call("anni", "DELETE", "/api/pizza/me");
    release();
    expect((await reading).statusCode).toBe(200);
    const stored = await pool.query("SELECT read::text AS r FROM pizza_receipts");
    expect(JSON.stringify(stored.rows)).not.toContain(anniId);
    expect(JSON.stringify(stored.rows)).not.toContain("Anni");
    expect(
      (await w.call("organiser", "GET", `/api/pizza/orders/${id}/receipts`)).body,
    ).not.toContain("Anni");
  });

  it("scrubs a stored answer that names the setter, who is neither the payer nor has a pizza", async () => {
    const set = await w.call("organiser", "PATCH", `/api/pizza/orders/${id}/money`, {
      total_cents: 3200,
    });
    expect(set.statusCode).toBe(200);
    // Pena's own write is answered with a view that names the setter, and is stored under Pena.
    const price = await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, {
      prices: [{ item_id: items.anni, price_cents: 850 }],
    });
    expect(price.statusCode).toBe(200);
    expect(json(price).total_set_by).toMatchObject({ name: "Organiser" });
    const before = await pool.query("SELECT body::text AS b FROM pizza_idempotency");
    expect(JSON.stringify(before.rows)).toContain("Organiser");
    await w.call("organiser", "DELETE", "/api/pizza/me");
    const after = await pool.query("SELECT body::text AS b FROM pizza_idempotency");
    expect(JSON.stringify(after.rows)).not.toContain("Organiser");
    expect((await money()).body).not.toContain("Organiser");
  });
});
