/**
 * The read log and what a failed read costs (#789 items 11 and 12): every read is a row with its
 * outcome, reason, pages, tokens, cost and time; a provider error that billed nothing does not use
 * up the day, a read the model answered does; no failed read changes a price; the crew hears once
 * when the reader stops on a refused key or an empty account; Admin → Integrations reads the month.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { DATABASE_URL, errorOf, json } from "./helpers.js";
import type { World } from "./helpers.js";
import { readerCalls, useReaderWorld } from "./reader-world.js";

let pool: pg.Pool;
let w: World;
let id: string;
const r = useReaderWorld();
const { setKey, addReceipt, read, money } = readerCalls(r);
beforeEach(() => {
  ({ pool, w, id } = r);
});

const cap = (n: number, more: Record<string, unknown> = {}) => {
  w.settings.set("demo", {
    ...DEFAULT_SETTINGS,
    ai_reader: true,
    ai_reader_daily_reads: n,
    ...more,
  });
};
const reads = (who = "integrator", month = "2026-10") =>
  w.call(who, "GET", `/api/pizza/reader/reads?month=${month}`);
const stopped = () => w.events().filter((e) => e.type === "pizza.reader.stopped");

describe.skipIf(!DATABASE_URL)("the read log", () => {
  it("does not count a rate-limited read against the day: the provider billed nothing", async () => {
    await setKey();
    cap(1);
    const receipt = await addReceipt();
    w.reader.fail = "rate_limited";
    const limited = await read(receipt);
    expect(limited.statusCode).toBe(502);
    expect(errorOf(limited)).toMatchObject({
      code: "reader_failed",
      reason: "rate_limited",
      retry_after_s: 5,
    });
    w.reader.fail = null;
    expect((await read(receipt)).statusCode).toBe(200);
  });

  it("counts an unreadable read: the model answered", async () => {
    await setKey();
    cap(1);
    const receipt = await addReceipt();
    w.reader.fail = "unreadable";
    const res = await read(receipt);
    expect(errorOf(res)).toMatchObject({
      reason: "unreadable",
      message: w.reader.unreadableReason,
    });
    w.reader.fail = null;
    expect(errorOf(await read(receipt)).code).toBe("reader_limit");
  });

  it("logs every read with its outcome, reason, pages, tokens, cost and time", async () => {
    await setKey();
    const receipt = await addReceipt();
    await read(receipt);
    w.reader.fail = "service_down";
    await read(receipt);
    const res = await reads();
    expect(res.statusCode).toBe(200);
    const log = json(res) as {
      reads: Record<string, unknown>[];
      totals: Record<string, unknown>;
    };
    // Newest first.
    expect(log.reads).toEqual([
      expect.objectContaining({
        kind: "receipt",
        outcome: "service_down",
        reason: null,
        pages: 1,
        input_tokens: null,
        output_tokens: null,
        cost_micro_usd: 0,
      }),
      expect.objectContaining({
        kind: "receipt",
        outcome: "ok",
        pages: 1,
        input_tokens: 1600,
        output_tokens: 400,
        // Claude Haiku 5.5: $0.10 and $0.50 per million tokens in and out.
        cost_micro_usd: 360,
      }),
    ]);
    expect(typeof log.reads[0]?.ms).toBe("number");
    expect(typeof log.reads[0]?.at).toBe("string");
    expect(log.totals).toEqual({ reads: 2, cost_micro_usd: 360, limit_micro_usd: null });
  });

  it("keeps the model's reason for an unreadable photo", async () => {
    await setKey();
    w.reader.fail = "unreadable";
    await read(await addReceipt());
    const log = json(await reads()) as { reads: Record<string, unknown>[] };
    expect(log.reads[0]).toMatchObject({
      outcome: "unreadable",
      reason: w.reader.unreadableReason,
      cost_micro_usd: 360,
    });
  });

  it("changes no price and no total when a read fails", async () => {
    await setKey();
    const receipt = await addReceipt();
    const before = json(await money());
    for (const fail of ["timeout", "service_down", "declined", "unreadable", "failed"] as const) {
      w.reader.fail = fail;
      expect(errorOf(await read(receipt)).code, fail).toBe("reader_failed");
    }
    expect(json(await money())).toEqual(before);
  });

  it("logs both of two reads of one receipt at once, and neither touches the money", async () => {
    await setKey();
    const receipt = await addReceipt();
    const before = json(await money());
    const revision = json(await w.call("pena", "GET", `/api/pizza/orders/${id}`)).revision;
    let release!: () => void;
    w.reader.hold = new Promise<void>((ok) => (release = ok));
    const both = [read(receipt), read(receipt)];
    for (let i = 0; i < 300 && w.reader.sent.length < 2; i++)
      await new Promise((ok) => setTimeout(ok, 10));
    release();
    expect((await Promise.all(both)).map((x) => x.statusCode)).toEqual([200, 200]);
    const { rows } = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pizza_reads WHERE outcome = 'ok'",
    );
    expect(rows[0]?.n).toBe(2);
    const after = json(await money());
    expect({ ...after, receipts: undefined }).toEqual({ ...before, receipts: undefined });
    expect(json(await w.call("pena", "GET", `/api/pizza/orders/${id}`)).revision).toBe(revision);
  });

  it("is read in Admin → Integrations only (admin.integrations.write)", async () => {
    for (const who of ["pena", "crew", "treasurer"])
      expect(errorOf(await reads(who)).code, who).toBe("missing_right");
    expect(errorOf(await reads("integrator", "2026-13")).code).toBe("invalid_request");
    expect(json(await reads("integrator", "2026-05"))).toMatchObject({ reads: [] });
  });

  it("names the month's limit from ai_reader_monthly_limit_usd, none when it is 0", async () => {
    cap(100, { ai_reader_monthly_limit_usd: 5 });
    expect(json(await reads())).toMatchObject({ totals: { limit_micro_usd: 5_000_000 } });
    cap(100, { ai_reader_monthly_limit_usd: 0 });
    expect(json(await reads())).toMatchObject({ totals: { limit_micro_usd: null } });
  });
});

describe.skipIf(!DATABASE_URL)("telling the organisers the reader stopped", () => {
  beforeEach(async () => {
    // The crew is who pizza has seen with pizza.order.manage.
    await w.call("crew", "GET", "/api/pizza/orders");
    await setKey();
  });

  it("tells the crew once when the provider refuses the key", async () => {
    const receipt = await addReceipt();
    w.reader.fail = "rejected";
    expect(errorOf(await read(receipt)).code).toBe("reader_key_rejected");
    expect(errorOf(await read(receipt)).code).toBe("reader_off");
    expect(stopped()).toHaveLength(1);
    expect(stopped()[0]?.data).toEqual({ reason: "key_rejected", user_ids: ["u_crew"] });
  });

  it("tells the crew once per event day when the account is out of credit", async () => {
    const receipt = await addReceipt();
    w.reader.fail = "out_of_credit";
    expect(errorOf(await read(receipt))).toMatchObject({ reason: "out_of_credit" });
    expect(errorOf(await read(receipt))).toMatchObject({ reason: "out_of_credit" });
    expect(stopped()).toHaveLength(1);
    expect(stopped()[0]?.data).toEqual({ reason: "out_of_credit", user_ids: ["u_crew"] });
    w.advance(24 * 60);
    await read(receipt, "crew");
    expect(stopped()).toHaveLength(2);
  });

  it("tells nobody when a read only failed", async () => {
    w.reader.fail = "service_down";
    await read(await addReceipt());
    expect(stopped()).toEqual([]);
  });
});
