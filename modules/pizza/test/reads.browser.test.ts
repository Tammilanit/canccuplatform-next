/// <reference lib="dom" />
/**
 * A receipt read in Chromium (#789 items 2 and 11): the photo's upload bar, then "Reading the
 * receipt…" while the reader works, then the check page; and a busy reader tried again by the page
 * itself after a countdown.
 */
import type pg from "pg";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { HOSTS, serve, signedIn } from "./browser.js";
import type { Served } from "./browser.js";
import { launch } from "./chromium.js";
import { png } from "./images.js";
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

const browser: Browser | undefined = DATABASE_URL === undefined ? undefined : await launch(HOSTS);

describe.skipIf(browser === undefined)("reading a receipt in Chromium", { timeout: 60_000 }, () => {
  let pool: pg.Pool;
  let w: World;
  let s: Served;
  let id: string;

  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await browser?.close();
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(TRUNCATE);
    w = await world(pool);
    w.setNow(new Date().toISOString());
    w.settings.set("demo", { ...DEFAULT_SETTINGS, ai_reader: true });
    const { pz } = await seedPizzerias(w);
    id = json(await open(w, "pena", pz)).id as string;
    await w.call("anni", "POST", `/api/pizza/orders/${id}/items`, {
      kind: "menu",
      menu_item_id: await itemId(w, pz, "1"),
    });
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
    await w.call("integrator", "PUT", "/api/pizza/reader/key", {
      api_key: "sk-ant-demo-key-0000wxyz",
    });
    s = await serve(w);
    return () => s.close();
  });

  it("shows the upload bar, then Reading the receipt, then the check page", async () => {
    if (browser === undefined) return;
    let release!: () => void;
    w.reader.hold = new Promise<void>((ok) => (release = ok));
    const context = await signedIn(browser, s, "pena", 390);
    const page = await context.newPage();
    await page.goto(`${s.origin}/pizza/hold/${id}/money/scan`);
    await page
      .locator("input[capture]")
      .setInputFiles({ name: "r.png", mimeType: "image/png", buffer: await png() });
    await page.locator("progress.pizza-progress__bar").waitFor();
    await page.getByText("Reading the receipt (about 10 s)…").waitFor();
    // Still on the scan page while the reader works: the page waits, it does not hang.
    expect(page.url()).toContain("/money/scan");
    release();
    await page.waitForURL(/\/money\/check\?receipt=pr_/);
    await context.close();
  });

  it("counts down and tries a busy reader again by itself", async () => {
    if (browser === undefined) return;
    w.reader.fail = "rate_limited";
    w.reader.retryAfterS = 2;
    const context = await signedIn(browser, s, "pena", 390);
    const page = await context.newPage();
    await page.goto(`${s.origin}/pizza/hold/${id}/money/scan`);
    await page
      .locator("input[capture]")
      .setInputFiles({ name: "r.png", mimeType: "image/png", buffer: await png() });
    await page.waitForURL(/failed=rate_limited/);
    await page.getByText(/Trying again in [12] s…/).waitFor();
    w.reader.fail = null;
    await page.waitForURL(/\/money\/check\?receipt=pr_/, { timeout: 10_000 });
    await context.close();
  });
});
