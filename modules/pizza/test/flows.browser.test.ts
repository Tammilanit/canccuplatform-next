/// <reference lib="dom" />
/**
 * The holder's and the crew's flows in Chromium, on the real app and a real Postgres: the holder
 * from close to "Everyone got theirs" (its undo included) on a phone; the crew stepping in on the
 * desk and reading the same page on a phone; a receipt photo and the split on the money step; a
 * menu CSV through its preview; a time setting's quick picks and stepper.
 */
import type pg from "pg";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HOSTS, serve, signedIn } from "./browser.js";
import type { Served } from "./browser.js";
import { launch } from "./chromium.js";
import { SPEC_MENU } from "./fixtures.js";
import { png, tallJpeg } from "./images.js";
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
    const schedule = page.locator(".pizza-schedule");
    expect(await schedule.isVisible()).toBe(true);
    expect(await schedule.textContent()).toContain("Nobody holds it");
    await schedule.getByRole("link", { name: /Order 1 · Demo Pizzeria/ }).click();
    await page.getByLabel("Why").fill("The holder went home");
    await page.getByRole("button", { name: "Take over" }).click();
    await page.locator(".canccu-history", { hasText: "Taken over by Crew" }).waitFor();
    expect(((await state()).holder as { name: string }).name).toBe("Crew");
    expect(w.audit.at(-1)).toMatchObject({ reason: "The holder went home" });

    // The organiser has all four Food tabs, one more than the shell shows on a phone.
    const phone = await signedIn(browser, s, "organiser", 390);
    const small = await phone.newPage();
    await small.goto(`${s.origin}/pizza/crew`);
    // The same day schedule on a phone, and every Food tab in the row: none behind "N more".
    expect(await small.locator(".pizza-schedule").textContent()).toContain(
      "Order 1 · Demo Pizzeria",
    );
    const tabs = small.locator(".canccu-tabs > a");
    expect(await tabs.count()).toBe(4);
    for (const tab of await tabs.all()) expect(await tab.isVisible()).toBe(true);
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

  it("sends a new camera photo at once also under a failed read's Try again", async () => {
    if (browser === undefined) return;
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
    const context = await signedIn(browser, s, "pena", 390);
    const page = await context.newPage();
    await page.goto(`${s.origin}/pizza/hold/${id}/money/scan?failed=timeout&receipt=pr_kept1`);
    // Try again also shows progress, and comes before the scan form on the page.
    await page.getByRole("button", { name: "Try again" }).waitFor();
    await page.locator("input[capture]").setInputFiles({
      name: "receipt.png",
      mimeType: "image/png",
      buffer: await png(),
    });
    await page.waitForURL(`**/pizza/hold/${id}/money/total`);
    expect(
      (
        json(await w.call("pena", "GET", `/api/pizza/orders/${id}/money`)) as {
          receipts: unknown[];
        }
      ).receipts.length,
    ).toBe(1);
    await context.close();
  });

  it("shows a receipt photo in a viewer that closes on ✕, Esc, a tap outside and a swipe down", async () => {
    if (browser === undefined) return;
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
    await w.call("pena", "POST", `/api/pizza/orders/${id}/receipts`, undefined, {
      raw: await png(),
      contentType: "image/png",
    });
    await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, { total_cents: 3000 });
    const context = await signedIn(browser, s, "pena", 390);
    const page = await context.newPage();
    await page.goto(`${s.origin}/pizza/hold/${id}/money`);
    const viewer = page.locator("dialog.pizza-viewer");
    const openIt = async () => {
      await page.locator("a[data-viewer]").first().click();
      await viewer.waitFor({ state: "visible" });
      expect(page.url()).toContain(`/pizza/hold/${id}/money`);
    };
    const closed = () => viewer.waitFor({ state: "hidden" });

    await openIt();
    await page.getByRole("button", { name: "Close" }).click();
    await closed();

    await openIt();
    await page.keyboard.press("Escape");
    await closed();

    await openIt();
    await page.mouse.click(5, 5);
    await closed();

    await openIt();
    await viewer.evaluate((d) => {
      const at = (y: number) => [new Touch({ identifier: 1, target: d, clientX: 195, clientY: y })];
      const fire = (type: string, y: number) =>
        d.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            touches: type === "touchend" ? [] : at(y),
            changedTouches: at(y),
          }),
        );
      fire("touchstart", 300);
      fire("touchmove", 420);
      fire("touchend", 420);
    });
    await closed();
    await context.close();
  });

  it("keeps the viewer open on a swipe while the page is zoomed, and leaves a modifier click to the browser", async () => {
    if (browser === undefined) return;
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
    await w.call("pena", "POST", `/api/pizza/orders/${id}/receipts`, undefined, {
      raw: await png(),
      contentType: "image/png",
    });
    await w.call("pena", "PATCH", `/api/pizza/orders/${id}/money`, { total_cents: 3000 });
    const context = await signedIn(browser, s, "pena", 390);
    const page = await context.newPage();
    await page.goto(`${s.origin}/pizza/hold/${id}/money`);
    const viewer = page.locator("dialog.pizza-viewer");
    const link = page.locator("a[data-viewer]").first();

    // Ctrl or Shift asks for a new tab or window: the browser's, not the viewer's.
    const popup = context.waitForEvent("page");
    await link.click({ modifiers: ["Shift"] });
    await (await popup).close();
    expect(await viewer.count()).toBe(0);

    await link.click();
    await viewer.waitFor({ state: "visible" });
    // A pinch-zoomed page: a drag down pans the photo, it does not close it.
    await page.evaluate(() =>
      Object.defineProperty(window.visualViewport, "scale", { configurable: true, get: () => 2 }),
    );
    await viewer.evaluate((d) => {
      const at = (y: number) => [new Touch({ identifier: 1, target: d, clientX: 195, clientY: y })];
      const fire = (type: string, y: number) =>
        d.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            touches: type === "touchend" ? [] : at(y),
            changedTouches: at(y),
          }),
        );
      fire("touchstart", 300);
      fire("touchmove", 420);
      fire("touchend", 420);
    });
    await page.waitForTimeout(100);
    expect(await viewer.isVisible()).toBe(true);
    await context.close();
  });

  it("shrinks a 4000 px photo to 2000 px on the phone before it uploads", async () => {
    if (browser === undefined) return;
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
    const context = await signedIn(browser, s, "pena", 390);
    const page = await context.newPage();
    await page.goto(`${s.origin}/pizza/hold/${id}/money/scan`);
    // What the form posts when it is sent: Chromium does not show a request's file parts.
    const sent = page.evaluate(
      () =>
        new Promise<{ width: number; height: number; type: string; n: number }>((resolve) => {
          const form = document.querySelector("form[data-shrink]") as HTMLFormElement;
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            const files = [...form.querySelectorAll("input[type=file]")].flatMap((i) => [
              ...((i as HTMLInputElement).files ?? []),
            ]);
            const file = files[0] as File;
            void createImageBitmap(file).then((b) => {
              resolve({ width: b.width, height: b.height, type: file.type, n: files.length });
            });
          });
        }),
    );
    await page.locator("input[capture]").setInputFiles({
      name: "big.jpg",
      mimeType: "image/jpeg",
      buffer: await tallJpeg(4000, 3000),
    });
    expect(await sent).toEqual({ width: 2000, height: 1500, type: "image/jpeg", n: 1 });
    await context.close();
  });

  it("offers the camera on a phone and, on a PC, a file to attach that it sends from (H2)", async () => {
    if (browser === undefined) return;
    await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
    const phone = await signedIn(browser, s, "pena", 390);
    const small = await phone.newPage();
    await small.goto(`${s.origin}/pizza/hold/${id}/money/scan`);
    expect(await small.getByText("Take a photo of the receipt").isVisible()).toBe(true);
    expect(await small.getByText("Attach the receipt image").isVisible()).toBe(false);
    await phone.close();

    const desk = await signedIn(browser, s, "pena", 1280);
    const page = await desk.newPage();
    await page.goto(`${s.origin}/pizza/hold/${id}/money/scan`);
    expect(await page.getByText("Take a photo of the receipt").isVisible()).toBe(false);
    expect(await page.getByText("Attach the receipt image").isVisible()).toBe(true);
    await page.locator(".pizza-drop__input").setInputFiles({
      name: "receipt.png",
      mimeType: "image/png",
      buffer: await png(),
    });
    await page.locator("form[data-reading] button[type=submit]").click();
    // The reader is off: the photo is kept and the holder types the total.
    await page.waitForURL(`**/pizza/hold/${id}/money/total`);
    await desk.close();
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

  it("sets a time setting with a quick pick and steps it inside its bounds", async () => {
    if (browser === undefined) return;
    const context = await signedIn(browser, s, "organiser", 390);
    const page = await context.newPage();
    await page.goto(`${s.origin}/pizza/crew/settings`);
    const field = page.locator("input[name=release_after_minutes]");
    await page
      .locator('[data-canccu-for="pizza-release_after_minutes"][data-canccu-pick="240"]')
      .click();
    expect(await field.inputValue()).toBe("240");
    await page
      .locator('[data-canccu-for="pizza-release_after_minutes"][data-canccu-step="1"]')
      .click();
    expect(await field.inputValue()).toBe("241");
    await field.fill("720");
    await page
      .locator('[data-canccu-for="pizza-release_after_minutes"][data-canccu-step="1"]')
      .click();
    expect(await field.inputValue()).toBe("720");
    await context.close();
  });
});
