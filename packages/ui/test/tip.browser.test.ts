/// <reference lib="dom" />
/**
 * The tooltip in Chromium (#782): hover and keyboard focus at 1280 px; at 390 px a tap opens an
 * info tooltip and a tap elsewhere closes it, and an icon button acts on a tap while a long press
 * shows its tooltip without acting. The touch half is admin's shell.js, which every shell loads.
 */
import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { html } from "../src/html.js";
import { shellPage } from "../src/shell.js";
import { iconButton, infoTip } from "../src/tip.js";
import { launch } from "./chromium.js";

const browser = await launch();
const css = readFileSync(new URL("../ui.css", import.meta.url), "utf8");
const shellJs = readFileSync(
  new URL("../../../modules/admin/src/canccu_admin/static/shell.js", import.meta.url),
  "utf8",
);

async function render(width: number, touch: boolean): Promise<Page> {
  if (browser === undefined) throw new Error("the suite runs only with a browser");
  const body = html`<p style="margin-top:6rem">Health ${infoTip("Checks every part every 10 seconds.")}</p>
    <p>${iconButton({ icon: "close", label: "Remove the zone" })}</p><p id="away">Elsewhere</p>`;
  const doc = String(
    shellPage({
      title: "Tips",
      description: "Where the tooltips are tried.",
      body,
      session: { userName: "Demo Organiser", rights: new Set(["admin.settings.read"]) },
    }),
  )
    .replace(/<link rel="stylesheet"[^>]*>/, `<style>${css}</style>`)
    .replace(
      /<script[^>]*><\/script>/,
      `<script>${shellJs.replace(/^if \("serviceWorker"[\s\S]*?\n}\n/m, "")}</script>`,
    );
  const page = await browser.newPage({
    viewport: { width, height: 800 },
    hasTouch: touch,
    isMobile: touch,
  });
  await page.setContent(doc);
  await page.evaluate(() => {
    (window as unknown as { acted: number }).acted = 0;
    document.querySelector(".canccu-button--icon")?.addEventListener("click", () => {
      (window as unknown as { acted: number }).acted += 1;
    });
  });
  return page;
}

const shown = (page: Page, sel: string): Promise<string> =>
  page
    .locator(sel)
    .evaluate(
      (el) =>
        getComputedStyle(el.parentElement?.querySelector(".canccu-tip__text") ?? el).visibility,
    );

describe.skipIf(browser === undefined)("tooltips (#782)", () => {
  afterAll(async () => browser?.close());

  it("open by keyboard focus and close by Esc at 1280 px", async () => {
    const page = await render(1280, false);
    expect(await shown(page, ".canccu-tip__info")).toBe("hidden");
    await page.locator(".canccu-tip__info").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await shown(page, ".canccu-tip__info")).toBe("visible");
    await page.keyboard.press("Escape");
    expect(await shown(page, ".canccu-tip__info")).toBe("hidden");
    await page.locator(".canccu-tip__info").hover();
    await page.locator("#away").hover();
    await page.locator(".canccu-tip__info").hover();
    expect(await shown(page, ".canccu-tip__info")).toBe("visible");
    await page.close();
  });

  it("open by a tap and close by a tap elsewhere at 390 px", async () => {
    const page = await render(390, true);
    await page.locator(".canccu-tip__info").tap();
    expect(await shown(page, ".canccu-tip__info")).toBe("visible");
    await page.locator("#away").tap();
    expect(await shown(page, ".canccu-tip__info")).toBe("hidden");
    await page.close();
  });

  it("let an icon button act on a tap and show its tooltip on a long press", async () => {
    const page = await render(390, true);
    await page.locator(".canccu-button--icon").tap();
    expect(await page.evaluate(() => (window as unknown as { acted: number }).acted)).toBe(1);
    await page.locator(".canccu-button--icon").evaluate(async (b) => {
      b.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      b.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", bubbles: true }));
      (b as HTMLElement).click();
    });
    expect(await shown(page, ".canccu-button--icon")).toBe("visible");
    expect(await page.evaluate(() => (window as unknown as { acted: number }).acted)).toBe(1);
    await page.close();
  });
});
