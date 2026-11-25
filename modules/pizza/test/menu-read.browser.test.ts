/// <reference lib="dom" />
/**
 * Reading a menu in Chromium (#789 items 1–3 and 15): pages chosen as thumbnails to reorder and
 * remove, "Add another page" up to six, the cost for the pages chosen; the upload bar, "Reading 3
 * pages…" and then the table; a read past the page's time limit with Try again; and the table's
 * rows added, deleted and merged in place.
 */
import type pg from "pg";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { HOSTS, serve, signedIn } from "./browser.js";
import type { Served } from "./browser.js";
import { launch } from "./chromium.js";
import { png } from "./images.js";
import { DATABASE_URL, TRUNCATE, freshDatabase, seedPizzerias, world } from "./helpers.js";
import type { World } from "./helpers.js";

const browser: Browser | undefined = DATABASE_URL === undefined ? undefined : await launch(HOSTS);

describe.skipIf(browser === undefined)("reading a menu in Chromium", { timeout: 60_000 }, () => {
  let pool: pg.Pool;
  let w: World;
  let s: Served;
  let pz: string;

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
    ({ pz } = await seedPizzerias(w));
    await w.call("integrator", "PUT", "/api/pizza/reader/key", {
      api_key: "sk-ant-demo-key-0000wxyz",
    });
    s = await serve(w);
    return () => s.close();
  });

  /** Pages of different widths, so the order they reach the reader in shows. */
  const pages = (widths: number[]) =>
    Promise.all(
      widths.map(async (width, i) => ({
        name: `p${i + 1}.png`,
        mimeType: "image/png",
        buffer: await png(width, 300),
      })),
    );
  const open = async (width: number): Promise<Page> => {
    const context = await signedIn(browser as Browser, s, "organiser", width);
    const page = await context.newPage();
    await page.goto(`${s.origin}/pizza/crew/pizzerias/${pz}/read`);
    return page;
  };
  const rows = (page: Page) => page.locator("tbody[data-items] tr").count();

  it("shows the pages and their cost, the upload bar, Reading 3 pages, then the table", async () => {
    let release!: () => void;
    w.reader.hold = new Promise<void>((ok) => (release = ok));
    const page = await open(1280);
    await page.locator(".pizza-drop__input").setInputFiles(await pages([410, 420, 430]));
    await expect.poll(() => page.locator("[data-thumbs] li").count()).toBe(3);
    await page.getByText("About $0.0045 for 3 pages").waitFor();
    await page.getByRole("button", { name: "Read the photos" }).click();
    await page.locator("progress.pizza-progress__bar").waitFor();
    await page.getByText("Reading 3 pages (about 30 s)…").waitFor();
    expect(page.url()).toContain("/read");
    release();
    await page.getByText("Read 11 items · check them first").waitFor();
    expect(w.reader.menuCalls).toEqual([3]);
    expect(w.reader.sent.map((x) => x.width)).toEqual([410, 420, 430]);
    await page.context().close();
  });

  it("offers Add another page on a phone after the first, up to 6, and reads them in the order set", async () => {
    const page = await open(390);
    const add = page.getByRole("button", { name: "Add another page" });
    expect(await add.isVisible()).toBe(false);
    await page.locator("input[capture]").setInputFiles(await pages([410]));
    await add.waitFor();
    await page.locator(".pizza-saved input").setInputFiles(await pages([420, 430, 440, 450]));
    await expect.poll(() => page.locator("[data-thumbs] li").count()).toBe(5);
    await page.locator("input[capture]").setInputFiles(await pages([460]));
    await expect.poll(() => page.locator("[data-thumbs] li").count()).toBe(6);
    expect(await add.isVisible()).toBe(false);
    // Move the second page up, remove the last one.
    await page.locator("[data-thumbs] li").nth(1).getByRole("button", { name: "Move up" }).click();
    await page.locator("[data-thumbs] li").nth(5).getByRole("button", { name: "Remove" }).click();
    await page.getByText("About $0.0075 for 5 pages").waitFor();
    await page.getByRole("button", { name: "Read the photos" }).click();
    await page.getByText("Read 11 items · check them first").waitFor();
    expect(w.reader.sent.map((x) => x.width)).toEqual([420, 410, 430, 440, 450]);
    await page.context().close();
  });

  it("says a read past the page's time limit took too long, with Try again", async () => {
    w.reader.hold = new Promise<void>(() => undefined);
    const page = await open(1280);
    await page.locator(".pizza-drop__input").setInputFiles(await pages([410]));
    // The page's limit is the reader's 50 s and 10 s more; shortened here to keep the test short.
    await page
      .locator("form[data-pages]")
      .evaluate((f) => f.setAttribute("data-timeouts", "1500,1500,1500,1500,1500,1500"));
    await page.getByRole("button", { name: "Read the photos" }).click();
    await page.getByText("The read is taking too long. Try again, or type the menu.").waitFor();
    await page.getByRole("button", { name: "Try again" }).waitFor();
    expect(await page.getByRole("button", { name: "Try again" }).isEnabled()).toBe(true);
    await page.context().close();
  });

  it("adds, deletes and merges the table's rows in place, and checks the import", async () => {
    const page = await open(1280);
    await page.locator(".pizza-drop__input").setInputFiles(await pages([410]));
    await page.getByRole("button", { name: "Read the photos" }).click();
    await page.getByText("Read 9 items · check them first").waitFor();
    const url = page.url();
    expect(await rows(page)).toBe(9);
    await page.getByRole("button", { name: "Add a row" }).click();
    expect(await rows(page)).toBe(10);
    await page.locator("tbody[data-items] tr").last().locator('input[name$="[number]"]').fill("99");
    await page
      .locator("tbody[data-items] tr")
      .last()
      .locator('input[name$="[name]"]')
      .fill("Demo Uusi");
    await page
      .locator("tbody[data-items] tr")
      .first()
      .getByRole("button", { name: "Delete" })
      .click();
    expect(await rows(page)).toBe(9);
    // Merge the (now) second row into the first: the first keeps its own values.
    await page
      .locator("tbody[data-items] tr")
      .nth(1)
      .getByRole("button", { name: "Merge into the row above" })
      .click();
    expect(await rows(page)).toBe(8);
    expect(page.url()).toBe(url);
    await page.getByRole("button", { name: "Check the import" }).click();
    await page.getByRole("button", { name: "Apply" }).waitFor();
    const csv = await page.locator("textarea[name=csv]").first().inputValue();
    expect(csv).toContain("Demo Uusi");
    expect(csv).not.toContain("Demo Margherita");
    expect(csv).not.toContain("Demo Hawaii");
    expect(csv).toContain("Demo Kinkku");
    await page.context().close();
  });
});
