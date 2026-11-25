/**
 * The optional AI reader (#644; the plan, The optional AI reader): off unless the event turns it on
 * and an admin has set the provider's key (write-only, sealed, audited); a read only suggests, and
 * nothing changes an order until a person confirms; a daily cap; the fake reader, never a provider.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { DATABASE_URL, errorOf, json } from "./helpers.js";
import type { World } from "./helpers.js";
import { photoWithLocation } from "./images.js";
import { KEY, readerCalls, useReaderWorld } from "./reader-world.js";
import type { ReaderWorld } from "./reader-world.js";

let pool: pg.Pool;
let w: World;
let id: string;
let items: ReaderWorld["items"];
const r = useReaderWorld();
const { setKey, keyStatus, addReceipt, read, money } = readerCalls(r);
beforeEach(() => {
  ({ pool, w, id, items } = r);
});

describe.skipIf(!DATABASE_URL)("the reader's key in Admin → Integrations", () => {
  it("is set, shown only by its last four, never returned, sealed at rest and audited without it", async () => {
    expect(json(await keyStatus())).toMatchObject({ provider: "Anthropic", set: false });
    const res = await setKey();
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ set: true, last4: "wxyz", set_by: { name: "Integrator" } });
    expect(res.body).not.toContain(KEY);
    expect((await keyStatus()).body).not.toContain(KEY);
    const { rows } = await pool.query("SELECT sealed FROM pizza_reader_keys");
    expect(JSON.stringify(rows)).not.toContain(KEY);
    expect(w.audit.map((a) => a.action)).toContain("pizza.reader_key.set");
    expect(JSON.stringify(w.audit)).not.toContain(KEY);
  });

  it("is replaced at once, and revoked at once, both audited", async () => {
    await setKey();
    await setKey("integrator", "sk-ant-demo-1111111111111111abcd");
    expect(json(await keyStatus())).toMatchObject({ last4: "abcd" });
    expect((await w.call("integrator", "DELETE", "/api/pizza/reader/key")).statusCode).toBe(204);
    expect(json(await keyStatus())).toMatchObject({ set: false });
    expect(w.audit.map((a) => a.action).filter((a) => a.startsWith("pizza.reader_key"))).toEqual([
      "pizza.reader_key.set",
      "pizza.reader_key.replaced",
      "pizza.reader_key.revoked",
    ]);
  });

  it("is only for admin.integrations.write", async () => {
    for (const who of ["pena", "crew", "treasurer", "menus"]) {
      expect(errorOf(await setKey(who)).code, who).toBe("missing_right");
      expect(errorOf(await keyStatus(who)).code, who).toBe("missing_right");
    }
  });

  it("is one event's: another event has none", async () => {
    await setKey();
    const other = await w.call("integrator", "GET", "/api/pizza/reader/key", undefined, {
      host: "two.test",
    });
    expect(json(other)).toMatchObject({ set: false });
  });
});

describe.skipIf(!DATABASE_URL)("reading a receipt", () => {
  it("is off by default, and off without a key", async () => {
    await setKey();
    w.settings.set("demo", DEFAULT_SETTINGS);
    expect(errorOf(await read(await addReceipt())).code).toBe("reader_off");
    w.settings.set("demo", { ...DEFAULT_SETTINGS, ai_reader: true });
    await w.call("integrator", "DELETE", "/api/pizza/reader/key");
    expect(errorOf(await read(await addReceipt())).code).toBe("reader_off");
    expect(w.reader.sent).toEqual([]);
  });

  it("suggests the total and each pizza's price, matched by menu number, and changes nothing", async () => {
    await setKey();
    const receipt = await addReceipt();
    const withoutReads = (m: Record<string, unknown>) => ({ ...m, receipts: undefined });
    const before = withoutReads(json(await money()));
    const res = await read(receipt);
    expect(res.statusCode).toBe(200);
    const r = json(res).read as Record<string, unknown>;
    expect(r).toMatchObject({
      total_cents: 3200,
      extras_cents: 300,
      adds_up: false,
      unmatched_lines: [2],
    });
    expect(r.pizzas).toEqual([
      expect.objectContaining({
        item_id: items.anni,
        price_cents: 800,
        suggested_cents: 850,
        differs: true,
        line: 0,
      }),
      expect.objectContaining({
        item_id: items.anni2,
        price_cents: 800,
        suggested_cents: 850,
        differs: true,
        line: 0,
      }),
      expect.objectContaining({
        item_id: items.mikko,
        price_cents: 950,
        suggested_cents: 950,
        differs: false,
        line: 1,
      }),
    ]);
    expect(withoutReads(json(await money()))).toEqual(before);
    expect(w.reader.sent[0]).toMatchObject({ kind: "receipt", key: KEY });
  });

  it("names a pizza that has no line on the receipt", async () => {
    await setKey();
    w.reader.receipt = {
      total_cents: 1800,
      lines: w.reader.receipt.lines.filter((_l, i) => i === 0 || i === 3),
    };
    const r = json(await read(await addReceipt())).read as {
      pizzas: { item_id: string; line: number | null }[];
    };
    expect(r.pizzas.find((p) => p.item_id === items.mikko)).toMatchObject({ line: null });
  });

  it("sends only the photo, shrunk to 1,600 px and without its location", async () => {
    await setKey();
    await read(await addReceipt(await photoWithLocation(3000, 4000)));
    expect(w.reader.sent[0]).toMatchObject({ height: 1600, width: 1200, exif: false });
  });

  it("sends the reader the photo as it is stored, no second copy", async () => {
    await setKey();
    const receipt = await addReceipt(await photoWithLocation(3000, 4000));
    await read(receipt);
    const photo = await w.call("pena", "GET", `/api/pizza/receipts/${receipt}/photo`);
    expect(w.reader.sent[0]?.bytes.equals(photo.rawPayload)).toBe(true);
  });

  it("sends a JPEG rendition of a PNG photo, never the lossless PNG", async () => {
    await setKey();
    await read(await addReceipt());
    expect(w.reader.sent[0]?.type).toBe("image/jpeg");
  });

  it("counts once the holder confirms: the total, the prices and the receipt it came from", async () => {
    await setKey();
    const receipt = await addReceipt();
    await read(receipt);
    const res = await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, {
      total_cents: 3200,
      receipt_id: receipt,
      prices: [
        { item_id: items.anni, price_cents: 850 },
        { item_id: items.anni2, price_cents: 850 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const m = json(res);
    expect(m).toMatchObject({
      total_cents: 3200,
      total_receipt_id: receipt,
      total_set_by: { name: "Pena" },
      split_effective: "exact",
    });
    const people = m.people as { name: string; amount_cents: number }[];
    expect(people.reduce((s, p) => s + p.amount_cents, 0)).toBe(3200);
    // Extras 5.50 over 3 pizzas; Anni has 2: 17.00 + 3.67 by the largest remainder.
    expect(people.find((p) => p.name === "Anni")?.amount_cents).toBe(2067);
  });

  it("refuses a receipt that is not this order's as the total's source", async () => {
    const res = await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, {
      total_cents: 3200,
      receipt_id: "pr_nope",
    });
    expect(errorOf(res).code).toBe("invalid_request");
  });

  it("stops at the event's daily cap, and starts again the next event day", async () => {
    await setKey();
    w.settings.set("demo", { ...DEFAULT_SETTINGS, ai_reader: true, ai_reader_daily_reads: 2 });
    const receipt = await addReceipt();
    expect((await read(receipt)).statusCode).toBe(200);
    expect((await read(receipt)).statusCode).toBe(200);
    const third = await read(receipt);
    expect(third.statusCode).toBe(429);
    expect(errorOf(third).code).toBe("reader_limit");
    w.advance(24 * 60);
    // The holder's money closed with the event day; the crew reads now.
    expect((await read(receipt, "crew")).statusCode).toBe(200);
    expect(json(await keyStatus())).toMatchObject({ reads_this_month: 3 });
  });

  it("never goes over the daily cap when scans run at once", async () => {
    await setKey();
    w.settings.set("demo", { ...DEFAULT_SETTINGS, ai_reader: true, ai_reader_daily_reads: 2 });
    const receipt = await addReceipt();
    let release!: () => void;
    w.reader.hold = new Promise<void>((r) => (release = r));
    const reads = Array.from({ length: 6 }, () => read(receipt));
    // The provider holds its answers, so the reads that passed the cap are all in flight.
    for (let i = 0; i < 300 && w.reader.sent.length < 2; i++)
      await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 100));
    release();
    const codes = (await Promise.all(reads)).map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 200, 429, 429, 429, 429]);
    expect(w.reader.sent).toHaveLength(2);
    const stored = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM pizza_reads");
    expect(stored.rows[0]?.n).toBe(2);
  });

  it("marks a key refused only if it is the key the read used, not one set meanwhile", async () => {
    await setKey();
    const receipt = await addReceipt();
    let release!: () => void;
    w.reader.hold = new Promise<void>((r) => (release = r));
    w.reader.fail = "rejected";
    const reading = read(receipt);
    for (let i = 0; i < 200 && w.reader.sent.length === 0; i++)
      await new Promise((r) => setTimeout(r, 10));
    await setKey("integrator", "sk-ant-demo-1111111111111111ab02");
    release();
    expect(errorOf(await reading).code).toBe("reader_key_rejected");
    expect(json(await keyStatus())).toMatchObject({ set: true, rejected: false, last4: "ab02" });
    w.reader.fail = null;
    w.reader.hold = null;
    expect((await read(receipt)).statusCode).toBe(200);
  });

  it("says when the provider fails, and stops on a refused key instead of trying again", async () => {
    await setKey();
    const receipt = await addReceipt();
    w.reader.fail = "failed";
    expect(errorOf(await read(receipt)).code).toBe("reader_failed");
    w.reader.fail = "rejected";
    expect(errorOf(await read(receipt)).code).toBe("reader_key_rejected");
    w.reader.fail = null;
    expect(errorOf(await read(receipt)).code).toBe("reader_off");
    expect(w.reader.sent.length).toBe(2);
    expect(json(await keyStatus())).toMatchObject({ set: true, rejected: true });
    await setKey();
    expect((await read(receipt)).statusCode).toBe(200);
  });

  it("is for those who change the order's money", async () => {
    await setKey();
    const receipt = await addReceipt();
    expect(errorOf(await read(receipt, "anni")).code).toBe("not_holder");
    expect(errorOf(await read(receipt, "treasurer")).code).toBe("not_holder");
    expect((await read(receipt, "crew")).statusCode).toBe(200);
  });
});
