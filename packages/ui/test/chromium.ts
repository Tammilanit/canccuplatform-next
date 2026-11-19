/** The browser of the browser tests: Playwright's bundled Chromium, else the runner's Chrome. */
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";

/** Undefined when neither starts, so a suite skips locally; in CI one must run. */
export async function launch(): Promise<Browser | undefined> {
  for (const options of [{}, { channel: "chrome" }]) {
    try {
      return await chromium.launch(options);
    } catch {
      // Try the next one.
    }
  }
  if (process.env.CI) throw new Error("no Chromium or Chrome for the browser tests");
  return undefined;
}
