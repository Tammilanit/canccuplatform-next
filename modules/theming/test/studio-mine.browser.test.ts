/// <reference lib="dom" />
/**
 * My presets in Chromium (plan issue-784 D18): Save as my preset asks for a name, then opens Pick a
 * look at Your looks with the new preset; a refused name is said in the dialog; Delete asks first.
 */
import { describe, expect, it } from "vitest";
import { browser, studioSuite } from "./studio-page.js";

describe.skipIf(browser === undefined)("My presets in Chromium", { timeout: 60_000 }, () => {
  const s = studioSuite();
  const { open, api } = s;

  it("saves the draft under a name and shows it under Your looks, then deletes it", async () => {
    const applied = await api("PUT", "/api/theming/draft/preset", {
      preset: "default",
      scheme: "night",
    });
    expect(applied.status).toBe(200);
    const page = await open("/theming/studio/yours");
    await page.locator('[data-mine-ask="canccu-studio-mine-save"]:visible').first().click();
    const dialog = page.locator("#canccu-studio-mine-save[open]");
    await dialog.waitFor();

    // A name of spaces only is refused by the API and said in the dialog, which stays open.
    await dialog.locator('input[name="name"]').fill("   ");
    await dialog.locator('button[type="submit"]').click();
    await dialog.locator(".canccu-studio-mine-error:not([hidden])").waitFor();

    await dialog.locator('input[name="name"]').fill("Spring look");
    await Promise.all([
      page.waitForURL(/\/theming\/studio\/#canccu-studio-mine$/),
      dialog.locator('button[type="submit"]').click(),
    ]);
    const look = page.locator('#canccu-studio-mine button[data-action="preset"]');
    await expect.poll(() => look.count()).toBe(1);
    expect(await look.textContent()).toContain("Spring look");

    await page.locator('#canccu-studio-mine [data-mine-ask="canccu-studio-mine-delete"]').click();
    const ask = page.locator("#canccu-studio-mine-delete[open]");
    await ask.waitFor();
    expect(await ask.locator(".canccu-studio-mine-name").textContent()).toBe("Spring look");
    await Promise.all([
      page.waitForEvent("load"),
      ask.locator('[data-action="mine-delete"]').click(),
    ]);
    expect(await page.locator('#canccu-studio-mine button[data-action="preset"]').count()).toBe(0);
    const listed = (await (await api("GET", "/api/theming/presets")).json()) as { mine: unknown[] };
    expect(listed.mine).toEqual([]);
  });
});
