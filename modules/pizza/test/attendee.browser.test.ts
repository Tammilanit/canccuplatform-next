/// <reference lib="dom" />
/**
 * The attendee's flow in Chromium (#119), on the real app, a real Postgres and the bus in memory
 * feeding the live stream as in production: from the screen's QR to a pizza in the order on a
 * phone, the order's page following the holder's steps live until "I've got mine", the
 * "Reconnecting…" banner and its catch-up, and starting an order on the desk.
 */
import type pg from "pg";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Bus } from "@canccu/kit";
import { HOSTS, serve, signedIn } from "./browser.js";
import type { Served } from "./browser.js";
import { launch } from "./chromium.js";
import { DATABASE_URL, freshDatabase, json, open, seedPizzerias, world } from "./helpers.js";
import type { World } from "./helpers.js";

const browser: Browser | undefined = DATABASE_URL === undefined ? undefined : await launch(HOSTS);

describe.skipIf(browser === undefined)(
  "the attendee's Food pages in Chromium",
  { timeout: 60_000 },
  () => {
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
        "TRUNCATE pizza_due, pizza_crew, pizza_pizzerias, pizza_menu_entries, pizza_orders, pizza_items, pizza_order_log, pizza_idempotency, pizza_outbox, pizza_outbox_tenants, pizza_tenants",
      );
      w = await world(pool);
      w.setNow(new Date().toISOString());
      const { pz } = await seedPizzerias(w);
      id = json(await open(w, "pena", pz)).id as string;
      const sub = new Bus(w.store, "pizza").subscribeTenants(
        ["pizza"],
        (e) => {
          w.deps.live.handle(e);
        },
        { blockMs: 20, rescanMs: 0 },
      );
      s = await serve(w);
      return async () => {
        w.deps.live.close();
        await sub.close();
        await s.close();
      };
    });

    const step = (name: string, body: Record<string, unknown> = {}) =>
      w.call("pena", "POST", `/api/pizza/orders/${id}/${name}`, body);

    it("goes from the QR to a pizza in the order, then follows it live to I’ve got mine", async () => {
      if (browser === undefined) return;
      const context = await signedIn(browser, s, "anni");
      const page = await context.newPage();
      // L6: one open order, so the QR lands on its menu.
      await page.goto(`${s.origin}/pizza/go`);
      await page.waitForURL(`**/pizza/orders/${id}/add`);
      // The filter keeps focus and narrows the list as you type.
      await page.getByLabel("Name or ingredient").fill("jalap");
      expect(await page.locator("[data-item]:visible").count()).toBe(1);
      await page.getByRole("radio", { name: /#12 Kebab/ }).check();
      await page.getByLabel("Note for the pizzeria (read out)").fill("no onion");
      await page.getByRole("button", { name: "Add to the order" }).click();
      await page.waitForURL(`**/pizza/orders/${id}?added=1`);
      await page.getByText("Added to order 1").waitFor();
      expect(await page.locator(".pizza-line__label").textContent()).toBe("#12 Kebab");

      // The holder's steps reach the page without a reload (D13).
      await step("close");
      await page.getByText("Closed: Pena is calling").waitFor();
      await step("place", { estimate_minutes: 40 });
      await page.getByText("the pizzeria said").waitFor();
      await step("arrive", { pickup: "Entrance table" });
      await page.getByText("Collect at Entrance table").first().waitFor();
      await page.getByRole("button", { name: "I’ve got mine" }).click();
      await page.getByText("You’ve got yours").waitFor();
      const mine = json(await w.call("anni", "GET", `/api/pizza/orders/${id}`)).mine as {
        handed_out: boolean;
      }[];
      expect(mine[0]?.handed_out).toBe(true);
      await context.close();
    });

    it("says Reconnecting while the stream is gone, and catches up when it is back (E16)", async () => {
      if (browser === undefined) return;
      const context = await signedIn(browser, s, "anni");
      const page = await context.newPage();
      await page.goto(`${s.origin}/pizza/orders/${id}`);
      await page.getByText("Open · closes").waitFor();
      // The server drops every stream; the order closes meanwhile, as if no event reached the page.
      w.deps.live.close();
      await page.getByText("Reconnecting…").waitFor();
      await w.call("pena", "POST", `/api/pizza/orders/${id}/close`, {});
      // EventSource tries again by itself; the new stream's `ready` makes the page read the order.
      await page.getByText("Closed: Pena is calling").waitFor({ timeout: 15_000 });
      expect(await page.getByText("Reconnecting…").count()).toBe(0);
      await context.close();
    });

    it("starts an order on the desk and offers the holder's view", async () => {
      if (browser === undefined) return;
      const context = await signedIn(browser, s, "mikko", 1280);
      const page = await context.newPage();
      await page.goto(`${s.origin}/pizza/`);
      await page.getByRole("link", { name: "Start another order" }).click();
      await page.getByText("Order 1 is open · join it instead?").waitFor();
      await page.getByRole("radio", { name: /Demo Grill/ }).check();
      await page.getByRole("button", { name: "Open the order" }).click();
      await page.getByText("Order 2 is open").waitFor();
      await page.getByRole("link", { name: "Open my holder view" }).click();
      await page.waitForURL("**/pizza/hold/**");
      expect(await page.locator("h1").textContent()).toBe("Your order 2");
      await context.close();
    });
  },
);
