/** The browser of the browser tests: Playwright's bundled Chromium, else the runner's Chrome. */
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";

/** Undefined when neither starts, so a suite skips locally; in CI one must run. */
export async function launch(): Promise<Browser | undefined> {
  for (const options of [{}, { channel: "chrome" }]) {
    let browser: Browser;
    try {
      browser = await chromium.launch(options);
    } catch {
      continue; // Try the next one.
    }
    await warm(browser);
    return browser;
  }
  if (process.env.CI) throw new Error("no Chromium or Chrome for the browser tests");
  return undefined;
}

/**
 * The first page of a fresh CI runner's Chrome is slow (#685): it reads Chrome off a cold disk
 * and starts its first renderer, GPU process, fonts and input path. That cost landed in whichever
 * test ran first, up to 5 s and past its timeout. Paying it here, at the file's import, which has
 * no timeout, leaves each test timing only its own work.
 */
async function warm(browser: Browser): Promise<void> {
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  await page.setContent(
    `<p>Warm</p><input type="range"><label><input type="checkbox"> Box</label><button>Go</button>`,
  );
  await page.locator("label").click();
  await page.locator("button").click();
  await context.close();
}
