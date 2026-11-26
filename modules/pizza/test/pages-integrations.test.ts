/**
 * Admin → Integrations' read log (#789 item 12, D22, D23): each read of the month with its outcome
 * and cost, and the month's total against the account's limit, warned of from 80 %, so nobody waits
 * for the provider's Console.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { DATABASE_URL, TRUNCATE, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { view } from "./forms.js";

let pool: pg.Pool;
let w: World;

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
  await w.call("integrator", "PUT", "/api/pizza/reader/key", {
    api_key: "sk-ant-demo-key-0000wxyz",
  });
});

/** A logged read of the world's event day (2026-10-29), as the reader leaves one. */
const logged = (o: {
  kind?: string;
  outcome?: string;
  reason?: string;
  pages?: number;
  cost: number;
}) =>
  pool.query(
    `INSERT INTO pizza_reads (tenant_id, at, day, kind, outcome, reason, pages, input_tokens, output_tokens, cost_micro_usd, ms, counted)
     VALUES ('demo', '2026-10-29T15:00:00Z', '2026-10-29', $1, $2, $3, $4, 1600, 400, $5, 2300, true)`,
    [o.kind ?? "receipt", o.outcome ?? "ok", o.reason ?? null, o.pages ?? 1, o.cost],
  );
const limit = (usd: number) => {
  w.settings.set("demo", { ...DEFAULT_SETTINGS, ai_reader_monthly_limit_usd: usd });
};
const page = async () =>
  (await view(w, "integrator", "/integrations")).body.replaceAll("&#39;", "'");

describe.skipIf(!DATABASE_URL)("the read log in Admin → Integrations", () => {
  it("lists this month's reads, each with its outcome and cost, and their total", async () => {
    await logged({ cost: 360 });
    await logged({
      kind: "menu",
      pages: 3,
      outcome: "unreadable",
      reason: "The photo is blurred.",
      cost: 900,
    });
    const body = await page();
    expect(body).toContain("Reads this month");
    expect(body).toContain("2 reads · $0.0013");
    expect(body).toContain("Receipt");
    expect(body).toContain("Menu, 3 pages");
    expect(body).toContain("Unreadable");
    expect(body).toContain("The photo is blurred.");
    expect(body).toContain("$0.0004");
    expect(body).toContain("2,000 tokens");
  });

  it("says when nothing was read this month", async () => {
    expect(await page()).toContain("No reads yet this month.");
  });

  it("shows the month's total against the limit, and warns from 80 %", async () => {
    limit(5);
    await logged({ cost: 4_000_000 });
    let body = await page();
    expect(body).toContain("$4.00 of $5.00 this month");
    expect(body).toContain("Near the account's monthly limit");
    await pool.query("UPDATE pizza_reads SET cost_micro_usd = 3990000");
    body = await page();
    expect(body).toContain("$3.99 of $5.00 this month");
    expect(body).not.toContain("Near the account's monthly limit");
  });

  it("shows the total alone without a limit", async () => {
    limit(0);
    await logged({ cost: 4_000_000 });
    const body = await page();
    expect(body).toContain("1 read · $4.00");
    expect(body).not.toContain(" of $");
  });
});

/** The how-to next to the key (#782 item 6, D5): API billing, step by step, with the cost. */
describe.skipIf(!DATABASE_URL)("how to get the AI reader's key", () => {
  const steps = (body: string) =>
    [...body.matchAll(/<li class="pizza-howto__step">([\s\S]*?)<\/li>/g)].map((m) =>
      (m[1] ?? "").replace(/<[^>]+>/g, ""),
    );

  it("is open with no key and lists the five steps in order", async () => {
    await w.call("integrator", "DELETE", "/api/pizza/reader/key");
    const body = await page();
    expect(body).toMatch(/<details class="pizza-howto" open>/);
    const s = steps(body);
    expect(s).toHaveLength(5);
    expect(s[0]).toContain("Anthropic Console account");
    expect(s[1]).toContain("billing");
    expect(s[2]).toContain("API key");
    expect(s[3]).toContain("Paste it here");
    expect(s[4]).toContain("monthly spend limit");
  });

  it("is folded once a key is set", async () => {
    const body = await page();
    expect(body).toMatch(/<details class="pizza-howto">/);
  });

  it("names the model, the cost per receipt and for 50, a $5 limit, and API billing", async () => {
    const body = await page();
    expect(body).toContain("Claude Haiku 5.5");
    expect(body).toContain("about 0.06 cents");
    expect(body).toContain("about 3 cents");
    expect(body).toContain("$5");
    expect(body).toContain("A Claude subscription");
  });

  it("links to the Console's API keys page in a new tab", async () => {
    expect(await page()).toContain(
      '<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">',
    );
  });

  it("has the same five steps in Finnish", async () => {
    w.languages.set("demo", "fi");
    const s = steps(await page());
    expect(s).toHaveLength(5);
    expect(s[4]).toContain("kuukausi");
  });
});
