/// <reference lib="dom" />
/**
 * The tooltip in Chromium (#782): hover and keyboard focus at 1280 px; at 390 px a tap opens an
 * info tooltip and a tap elsewhere or on it again closes it, and an icon button acts on a tap while a long press
 * shows its tooltip without acting. The touch half is admin's shell.js, which every shell loads.
 */
import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { html, raw } from "../src/html.js";
import type { Html } from "../src/html.js";
import { shellPage } from "../src/shell.js";
import { iconButton, infoTip } from "../src/tip.js";
import { launch } from "./chromium.js";

const browser = await launch();
const css = readFileSync(new URL("../ui.css", import.meta.url), "utf8");
const shellJs = readFileSync(
  new URL("../../../modules/admin/src/canccu_admin/static/shell.js", import.meta.url),
  "utf8",
);

async function render(width: number, touch: boolean, extra: Html | string = ""): Promise<Page> {
  if (browser === undefined) throw new Error("the suite runs only with a browser");
  const body = html`<p style="margin-top:6rem">Health ${infoTip("Checks every part every 10 seconds.")}</p>
    <p>${iconButton({ icon: "close", label: "Remove the zone" })}</p><p id="away">Elsewhere</p>${extra}`;
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
  await page.setContent(
    doc.replace(
      "<head>",
      '<head><meta name="viewport" content="width=device-width, initial-scale=1">',
    ),
  );
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
    // Enter on the hushed info button opens it again.
    await page.keyboard.press("Enter");
    expect(await shown(page, ".canccu-tip__info")).toBe("visible");
    await page.locator(".canccu-tip__info").blur();
    await page.locator(".canccu-tip__info").hover();
    await page.locator("#away").hover();
    await page.locator(".canccu-tip__info").hover();
    expect(await shown(page, ".canccu-tip__info")).toBe("visible");
    // Esc hushes a tooltip shown by hover too.
    await page.keyboard.press("Escape");
    expect(await shown(page, ".canccu-tip__info")).toBe("hidden");
    await page.close();
  });

  it("a hidden tooltip near the right edge does not widen the page at 390 px", async () => {
    const page = await render(
      390,
      true,
      html`<p style="text-align:end">${raw("A long label that wraps onto more lines")} ${infoTip("A long tip that is wide enough to reach past the right edge of a phone. ".repeat(3))}</p>`,
    );
    const widths = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    // innerWidth would grow with the overflow on a phone, so compare with the width asked for.
    expect(widths[0]).toBeLessThanOrEqual(390);
    await page.close();
  });

  it("open by a tap and close by a tap elsewhere at 390 px", async () => {
    const page = await render(390, true);
    await page.locator(".canccu-tip__info").tap();
    expect(await shown(page, ".canccu-tip__info")).toBe("visible");
    await page.locator("#away").tap();
    expect(await shown(page, ".canccu-tip__info")).toBe("hidden");
    // A second tap on the button closes it: a touch screen's sticky :hover does not keep it open.
    await page.locator(".canccu-tip__info").tap();
    await page.locator(".canccu-tip__info").tap();
    expect(await shown(page, ".canccu-tip__info")).toBe("hidden");
    await page.close();
  });

  it("let an icon button act on a tap and show its tooltip on a long press", async () => {
    const page = await render(390, true);
    await page.locator(".canccu-button--icon").tap();
    expect(await page.evaluate(() => (window as unknown as { acted: number }).acted)).toBe(1);
    expect(await shown(page, ".canccu-button--icon")).toBe("hidden");
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

  // A touch press on `sel`, held 600 ms after moving `drift` px; `after` ms later, a click.
  const press = (page: Page, sel: string, drift: number, after?: number): Promise<void> =>
    page.locator(sel).evaluate(
      async (b, [d, wait]) => {
        const at = (x: number) => ({
          pointerType: "touch",
          bubbles: true,
          clientX: x,
          clientY: 100,
        });
        b.dispatchEvent(new PointerEvent("pointerdown", at(100)));
        b.dispatchEvent(new PointerEvent("pointermove", at(100 + d)));
        await new Promise((r) => setTimeout(r, 600));
        b.dispatchEvent(new PointerEvent("pointerup", at(100 + d)));
        if (wait === undefined) return;
        await new Promise((r) => setTimeout(r, wait));
        (b as HTMLElement).click();
      },
      [drift, after] as const,
    );
  const acted = (page: Page): Promise<number> =>
    page.evaluate(() => (window as unknown as { acted: number }).acted);

  it("keep a long press that drifts a few pixels and drop one that moves on", async () => {
    const page = await render(390, true);
    await press(page, ".canccu-button--icon", 30);
    expect(await shown(page, ".canccu-button--icon")).toBe("hidden");
    await press(page, ".canccu-button--icon", 5);
    expect(await shown(page, ".canccu-button--icon")).toBe("visible");
    await page.close();
  });

  it("swallow only the click that ends a long press, not a later one", async () => {
    const page = await render(390, true);
    await press(page, ".canccu-button--icon", 0, 800);
    expect(await acted(page)).toBe(1);
    await page.close();
  });

  it("show a stepper button's tooltip on a long press", async () => {
    const stepper = raw(
      '<span class="canccu-tip"><button type="button" class="canccu-stepper__button" aria-label="More">+</button>' +
        '<span role="tooltip" class="canccu-tip__text" aria-hidden="true">More</span></span>',
    );
    const page = await render(390, true, stepper);
    await press(page, ".canccu-stepper__button", 0);
    expect(await shown(page, ".canccu-stepper__button")).toBe("visible");
    await page.close();
  });

  it("keep a tooltip on the screen and out of a flush card's clip, below when there is no room above", async () => {
    const corner = html`<div class="canccu-card canccu-card--flush" id="corner"
      style="position:absolute;top:0;right:0;width:3rem;height:2.5rem">
      ${infoTip("A long explanation that is far wider than the small card it sits in.")}
    </div>`;
    const page = await render(390, true, corner);
    await page.locator("#corner .canccu-tip__info").tap();
    expect(await shown(page, "#corner .canccu-tip__info")).toBe("visible");
    const box = await page.locator("#corner .canccu-tip__info").evaluate((b) => {
      const text = b.parentElement?.querySelector(".canccu-tip__text") as HTMLElement;
      const r = text.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        below: b.getBoundingClientRect().bottom,
        position: getComputedStyle(text).position,
      };
    });
    expect(box.position).toBe("fixed");
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(390);
    expect(box.top).toBeGreaterThanOrEqual(box.below);
    await page.close();
  });
});
