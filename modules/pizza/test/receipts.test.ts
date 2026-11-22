/**
 * Receipts (#644; contracts/pizza.md, Receipts): several photos per order, JPEG, PNG or WebP up to
 * 10 MB, their location stripped, kept per event in the files volume, seen only by the holder, the
 * crew and the organiser, and deleted at the 12-month anonymisation.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { withTenant } from "@canccu/kit";
import { handleTenantEvent } from "../src/consumer.js";
import {
  DATABASE_URL,
  TRUNCATE,
  errorOf,
  freshDatabase,
  itemId,
  json,
  open,
  seedPizzerias,
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";
import { photoWithLocation, png, webp } from "./images.js";

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
  await pool.query(TRUNCATE);
  w = await world(pool);
  ({ pz } = await seedPizzerias(w));
  id = json(await open(w, "pena", pz)).id as string;
  await w.call("anni", "POST", `/api/pizza/orders/${id}/items`, {
    kind: "menu",
    menu_item_id: await itemId(w, pz, "1"),
  });
});

const upload = (who: string, body: Buffer, type = "image/jpeg", order = id) =>
  w.call(who, "POST", `/api/pizza/orders/${order}/receipts`, undefined, {
    raw: body,
    contentType: type,
  });
const place = () => w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});

describe.skipIf(!DATABASE_URL)("receipts", () => {
  it("keeps a photo of a called-in order without its location, in the event's own files", async () => {
    await place();
    const res = await upload("pena", await photoWithLocation());
    expect(res.statusCode).toBe(201);
    const r = json(res);
    expect(r).toMatchObject({ order_id: id, type: "image/jpeg", added_by: { name: "Pena" } });
    const file = join(w.filesRoot, "demo", "pizza", "receipts", `${r.id as string}.jpg`);
    expect(existsSync(file)).toBe(true);
    const meta = await sharp(readFileSync(file)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(1200);
  });

  it("takes PNG and WebP, several per order", async () => {
    await place();
    expect((await upload("pena", await png(), "image/png")).statusCode).toBe(201);
    expect((await upload("pena", await webp(), "image/webp")).statusCode).toBe(201);
    const list = json(await w.call("pena", "GET", `/api/pizza/orders/${id}/receipts`));
    expect((list.receipts as unknown[]).length).toBe(2);
  });

  it("refuses what is not a JPEG, PNG or WebP, or says it is one and is not", async () => {
    await place();
    const gif = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#000" } })
      .gif()
      .toBuffer();
    expect(errorOf(await upload("pena", gif, "image/gif")).code).toBe("unsupported_media_type");
    expect(errorOf(await upload("pena", Buffer.from("not a picture"))).code).toBe("image_invalid");
  });

  it("refuses a photo over 10 MB", async () => {
    await place();
    const res = await upload("pena", Buffer.alloc(10 * 1024 * 1024 + 1, 1));
    expect(res.statusCode).toBe(413);
    expect(errorOf(res).code).toBe("file_too_large");
  });

  it("keeps at most 10 receipts per order (409 too_many_receipts)", async () => {
    await place();
    const photo = await png();
    for (let i = 0; i < 10; i++) expect((await upload("pena", photo, "image/png")).statusCode).toBe(201);
    const res = await upload("pena", photo, "image/png");
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).code).toBe("too_many_receipts");
    const list = json(await w.call("pena", "GET", `/api/pizza/orders/${id}/receipts`));
    expect((list.receipts as unknown[]).length).toBe(10);
  });

  it("is for the money of a called-in order only", async () => {
    expect(errorOf(await upload("pena", await png(), "image/png")).code).toBe("not_placed");
  });

  it("is added by the holder and the crew, not by a member or the treasurer", async () => {
    await place();
    expect((await upload("crew", await png(), "image/png")).statusCode).toBe(201);
    expect(errorOf(await upload("anni", await png(), "image/png")).code).toBe("not_holder");
    expect(errorOf(await upload("treasurer", await png(), "image/png")).code).toBe("not_holder");
  });

  it("is seen by the holder, the crew and the organiser only (a receipt can show card digits)", async () => {
    await place();
    const r = json(await upload("pena", await png(), "image/png"));
    const photo = (who: string) =>
      w.call(who, "GET", `/api/pizza/receipts/${r.id as string}/photo`);
    for (const who of ["pena", "crew", "treasurer"]) {
      const res = await photo(who);
      expect(res.statusCode, who).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(res.headers["cache-control"]).toContain("no-store");
    }
    for (const who of ["anni", "mikko"])
      expect(errorOf(await photo(who)).code, who).toBe("not_holder");
    expect((await photo("outsider")).statusCode).toBe(403);
    expect(
      (await w.call(null, "GET", `/api/pizza/receipts/${r.id as string}/photo`)).statusCode,
    ).toBe(401);
    expect(errorOf(await w.call("anni", "GET", `/api/pizza/orders/${id}/receipts`)).code).toBe(
      "not_holder",
    );
  });

  it("is never another event's: the id does not reach across", async () => {
    await place();
    const r = json(await upload("pena", await png(), "image/png"));
    const res = await w.call(
      "crew",
      "GET",
      `/api/pizza/receipts/${r.id as string}/photo`,
      undefined,
      {
        host: "two.test",
      },
    );
    expect(res.statusCode).toBe(404);
  });

  it("says how many receipts the order has in its money", async () => {
    await place();
    await upload("pena", await png(), "image/png");
    expect(json(await w.call("pena", "GET", `/api/pizza/orders/${id}/money`))).toMatchObject({
      receipts: [{ type: "image/png" }],
    });
  });

  it("is deleted, file and row, at the 12-month anonymisation", async () => {
    await place();
    const r = json(await upload("pena", await png(), "image/png"));
    const file = join(w.filesRoot, "demo", "pizza", "receipts", `${r.id as string}.png`);
    expect(existsSync(file)).toBe(true);
    await withTenant("demo", () =>
      handleTenantEvent(w.deps, {
        id: "e1",
        type: "tenants.retention.reached",
        version: 1,
        time: w.now.toISOString(),
        source: "tenants",
        tenant: "demo",
        data: { data_class: "personal" },
      }),
    );
    expect(existsSync(file)).toBe(false);
    const list = json(await w.call("crew", "GET", `/api/pizza/orders/${id}/receipts`));
    expect(list.receipts).toEqual([]);
  });
});
