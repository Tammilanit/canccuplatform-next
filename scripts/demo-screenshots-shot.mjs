// The one capture every page shot of scripts/demo-screenshots.mjs goes through, and the window sizes
// they use. A page that does not answer its own status or whose API reads are refused fails, so a
// screenshot of an error never passes for a real one.
import { DEMO_HOST } from "../modules/screen/test/stack/client.mjs";

export const DESK = { width: 1280, height: 800 };
export const PHONE = { width: 390, height: 844 };
// Settings' Last changes sit beside the list only from 1440 px (docs/design/mockups.html, sheet 2).
export const WIDE = { width: 1440, height: 900 };

export const firstLine = (err) =>
  String(err?.message ?? err)
    .split("\n")[0]
    .slice(0, 300);

export const cookieOn = (pair) => {
  const cut = pair.indexOf("=");
  return {
    name: pair.slice(0, cut),
    value: pair.slice(cut + 1),
    domain: DEMO_HOST,
    path: "/",
  };
};

/**
 * `shot(name, path, viewport, cookie, options)`: one page in a fresh context, written to
 * `out/<name>.png` unless `check`. A failure is handed to `fail`, never thrown, so the run goes on.
 */
export function shooter({ browser, at, out, check, fail, ok }) {
  return async function shot(
    name,
    path,
    viewport,
    cookie,
    { fullPage = true, ready, status = 200, tall = false, touch = false } = {},
  ) {
    const url = at(path);
    // A touch screen has no hover, so a phone page's `(hover: none)` rules apply.
    const finger = touch ? { hasTouch: true, isMobile: true } : {};
    const context = await browser.newContext({ viewport, ...finger });
    try {
      if (cookie !== null) await context.addCookies([cookieOn(cookie)]);
      const page = await context.newPage();
      // A page whose data read is refused still answers 200 and draws an error view. A 404 is how
      // some reads say "nothing yet", so it passes.
      const refused = [];
      page.on("response", (r) => {
        const { pathname } = new URL(r.url());
        if (
          pathname.startsWith("/api/") &&
          (r.status() === 401 || r.status() === 403 || r.status() >= 500)
        ) {
          refused.push(`${pathname} ${r.status()}`);
        }
      });
      const res = await page.goto(url);
      if (res?.status() !== status)
        throw new Error(`answered HTTP ${res?.status()}, not ${status}`);
      // Signed out, a page sends the browser to the sign-in page, which answers 200.
      if (res.request().redirectedFrom())
        throw new Error(`was sent on to ${new URL(res.url()).pathname}`);
      // Pages read their data after load; one that keeps a stream open is shot after the wait.
      if (ready) await ready(page);
      else
        await page
          .waitForLoadState("networkidle", { timeout: 5000 })
          .catch(() => undefined);
      if (refused.length)
        throw new Error(`its API reads answered ${refused.join(", ")}`);
      if (tall) {
        // A full-page capture would leave the sticky bottom bar where the window ended.
        const { width, height } = page.viewportSize();
        const full = await page.evaluate(
          () => document.documentElement.scrollHeight,
        );
        if (full > height) await page.setViewportSize({ width, height: full });
        await page.waitForTimeout(500);
      } else if (fullPage && viewport.width === PHONE.width) {
        // A phone page is shot as tall as it is, so what sticks to the bottom (the bar, an action
        // row) sits where it does once the page is scrolled to its end, not over its middle.
        const height = await page.evaluate(
          () => document.documentElement.scrollHeight,
        );
        if (height > viewport.height)
          await page.setViewportSize({ ...viewport, height });
      }
      if (!check)
        await page.screenshot({
          path: `${out}/${name}.png`,
          fullPage: fullPage && !tall,
        });
      ok(`${name}.png  ${url}`);
    } catch (err) {
      fail(`${name}: ${url}: ${firstLine(err)}`);
    } finally {
      await context.close();
    }
  };
}
