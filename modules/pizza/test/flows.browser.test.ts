/// <reference lib="dom" />
/**
 * The holder's and the crew's flows in Chromium, on the real app and a real Postgres: the holder
 * from close to "Everyone got theirs" (its undo included) on a phone; the crew stepping in on the
 * desk and reading the same page on a phone; a receipt photo and the split on the money step; a
 * menu CSV through its preview; a settings slider.
 */
import type pg from "pg";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HOSTS, serve, signedIn } from "./browser.js";
import type { Served } from "./browser.js";
import { launch } from "./chromium.js";
import { SPEC_MENU } from "./fixtures.js";
import { png } from "./images.js";
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

const browser: Browser | undefined = DATABASE_URL === undefined ? undefined : await launch(HOSTS);

describe.skipIf(browser === undefined)("the Food pages in Chromium", { timeout: 60_000 }, () => {
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
    await pool.query(
      "TRUNCATE pizza_receipts, pizza_paid, pizza_pay_details, pizza_reader_keys, pizza_reads, pizza_due, pizza_crew, pizza_pizzerias, pizza_menu_entries, pizza_orders, pizza_items, pizza_order_log, pizza_idempotency, pizza_outbox, pizza_outbox_tenants, pizza_tenants",
    );
    // The pages' times and the app's clock agree: both run on the real clock here.
    w = await world(pool);
    w.setNow(new Date().toISOString());
    const { pz } = await seedPizzerias(w);
    id = json(await open(w, "pena", pz)).id as string;
    for (const [who, number] of [
      ["anni", "12"],
      ["anni", "12"],
      ["mikko", "1"],
    ] as const)
      await w.call(who, "POST", `/api/pizza/orders/${id}/items`, {
        kind: "menu",
        menu_item_id: await itemId(w, pz, number),
      });
    s = await serve(w);
    return () => s.close();
  });

  const state = async () => json(await w.call("pena", "GET", `/api/pizza/orders/${id}`));

  it("takes the holder from close to Everyone got theirs on a phone, with its undo", async () => {
    if (browser === undefined) return;
    const context = await signedIn(browser, s, "pena");
    const page = await context.newPage();
    await page.goto(`${s.origin}/pizza/hold/${id}`);
    expect(await page.locator("h1").textContent()).toBe("Your order 1");
    await page.getByRole("button", { name: "Close the order now" }).click();

    // Call mode: the list read aloud; a tick stays on this phone across a reload.
    await page.waitForURL(`**/pizza/hold/${id}/call`);
    expect(await page.locator(".pizza-line__label").first().textContent()).toBe("#1 Margherita");
    await page.locator("[data-tick]").first().check();
    await page.reload();
    expect(await page.locator("[data-tick]").first().isChecked()).toBe(true);

    await page.getByRole("link", { name: "Called in: add the estimate" }).click();
    await page.getByRole("radio", { name: "30 min" }).check();
    await page.waitForFunction(() =>
      document.querySelector("[data-about]")?.textContent.startsWith("≈"),
    );
    await page.getByRole("button", { name: "Mark called in" }).click();
    await page.waitForURL(`**/pizza/hold/${id}`);
    expect((await state()).state).toBe("placed");
    expect(await page.locator('[aria-current="step"]').textContent()).toContain("It's here");

    await page.getByRole("link", { name: "It's here" }).first().click();
    await page.getByLabel("Where to collect it").fill("Entrance table");
    await page.getByRole("button", { name: "It's here: tell everyone" }).click();
    await page.waitForURL(`**/pizza/hold/${id}/hand-out`);
    await page.getByText("0 of 2 collected").waitFor();

    // One press ticks everyone; Undo within 10 s sends nothing. The page's own clock is faked
    // from here, which also stops Playwright's waits for a still element: these clicks force.
    await context.clock.install();
    await page.reload();
    await page.getByRole("button", { name: "Everyone got theirs" }).click({ force: true });
    expect(await page.getByRole("status").textContent()).toContain("order 1 is done");
    expect(await page.locator(".pizza-tick--on").count()).toBe(2);
    await page.getByRole("button", { name: "Undo" }).click({ force: true });
    expect(await page.locator(".pizza-tick--on").count()).toBe(0);
    await context.clock.fastForward(11_000);
    expect((await state()).state).toBe("arrived");

    await page.getByRole("button", { name: "Everyone got theirs" }).click({ force: true });
    await context.clock.fastForward(11_000);
    await page.waitForURL(`**/pizza/hold/${id}/hand-out`);
    await page.getByText("Order 1 is done").waitFor();
    expect((await state()).done_reason).toBe("handed_out");
    await context.close();
  });

  it("lets the crew step in with a reason on the desk, and shows the day on a phone", async () => {
    if (browser === undefined) return;
    await w.call("pena", "POST", `/api/pizza/orders/${id}/close`);
    await w.call("pena", "POST", `/api/pizza/orders/${id}/release`);
    const desk = await signedIn(browser, s, "crew", 1280);
    const page = await desk.newPage();
    await page.goto(`${s.origin}/pizza/crew`);
    expect(await page.locator(".pizza-desk").isVisible()).toBe(true);
    expect(await page.locator(".pizza-desk").textContent()).toContain("Nobody holds it");
    await page.locator(".pizza-desk").getByRole("link", { name: "Open ›" }).click();
    await page.getByLabel("Why").fill("The holder went home");
    await page.getByRole("button", { name: "Take over" }).click();
    await page.locator(".canccu-history", { hasText: "Taken over by Crew" }).waitFor();
    expect(((await state()).holder as { name: string }).name).toBe("Crew");
    expect(w.audit.at(-1)).toMatchObject({ reason: "The holder went home" });

    const phone = await signedIn(browser, s, "crew", 390);
    const small = await phone.newPage();
    await small.goto(`${s.origin}/pizza/crew`);
    expect(await small.locator(".pizza-desk").isVisible()).toBe(false);
    expect(await small.locator(".pizza-phone").textContent()).toContain("Order 1 · Demo Pizzeria");
    await desk.close();
    await phone.close();
  });

  it("sends the receipt as soon as the camera's photo is taken, and selects the split on tap", async () => {
    if (browser === undefined) return;
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
    const context = await signedIn(browser, s, "pena", 390);
    const page = await context.newPage();
    await page.goto(`${s.origin}/pizza/hold/${id}/money/scan`);
    await page.locator("input[capture]").setInputFiles({
      name: "receipt.png",
      mimeType: "image/png",
      buffer: await png(),
    });
    // The reader is off: the photo is kept and the holder types the total.
    await page.waitForURL(`**/pizza/hold/${id}/money/total`);
    await page.locator("input[name=total]").fill("30.00");
    await page.getByRole("button", { name: "Save the total" }).click();
    await page.waitForURL(`**/pizza/hold/${id}/money`);
    await page.getByRole("button", { name: "Even shares" }).click();
    await page.waitForURL(`**/pizza/hold/${id}/money`);
    expect(
      await page.getByRole("button", { name: "Even shares" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (json(await w.call("pena", "GET", `/api/pizza/orders/${id}/money`)) as { split: string })
        .split,
    ).toBe("even");
    await context.close();
  });

  it("imports a menu CSV from a file through its preview", async () => {
    if (browser === undefined) return;
    const context = await signedIn(browser, s, "menus", 1280);
    const page = await context.newPage();
    await page.goto(`${s.origin}/pizza/crew/pizzerias/import`);
    await page.locator("[data-csv-file]").setInputFiles({
      name: "trattoria-menu.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(SPEC_MENU),
    });
    await page.waitForFunction(() =>
      document
        .querySelector<HTMLTextAreaElement>("textarea[name=csv]")
        ?.value.startsWith("pizzeria,phone"),
    );
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByText("a new pizzeria with 3 items").waitFor();
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL("**/pizza/crew/pizzerias");
    await page.getByText("Demo Trattoria").waitFor();
    await context.close();
  });

  it("says a time setting's value as its slider moves", async () => {
    if (browser === undefined) return;
    const context = await signedIn(browser, s, "organiser", 390);
    const page = await context.newPage();
    await page.goto(`${s.origin}/pizza/crew/settings`);
    const slider = page.locator("input[name=release_after_minutes]");
    await slider.fill("150");
    expect(await slider.locator("xpath=following-sibling::output").textContent()).toBe(
      "2 h 30 min",
    );
    await context.close();
  });
});
