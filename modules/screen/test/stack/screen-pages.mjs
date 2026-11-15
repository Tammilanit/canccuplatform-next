// The browser pages the screen shots open (screens.mjs), and the run of each view. A view's page
// is closed when the view ends, also when it failed: a page left open polls on as the device, and
// the views after it timed out one by one (#549).

/** `open` a page of a size, signed in as a device; `attempt` a view, failing only that view. */
export function screenPages({ browser, cookieOn, fail }) {
  const opened = new Set();
  const open = async ([width, height], cookie) => {
    const context = await browser.newContext({ viewport: { width, height } });
    if (cookie) await context.addCookies([cookieOn(cookie)]);
    // The screen's state and stream are the only things the page waits on; nothing leaves the stack.
    await context.route(/^https:\/\/next-event\.example\//, (route) => route.abort());
    const page = await context.newPage();
    // A request still routed when the context closes (a state poll) would throw out of the run.
    const close = async () => {
      if (!opened.delete(close)) return;
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
    };
    opened.add(close);
    return { page, close };
  };
  const attempt = async (name, run) => {
    try {
      await run();
    } catch (err) {
      fail(`${name}: ${String(err?.message ?? err).split("\n")[0]}`);
    } finally {
      for (const close of [...opened]) await close().catch(() => undefined);
    }
  };
  return { open, attempt };
}
