// The browser pages the screen shots open (screens.mjs), and the run of each view. A view's page
// is closed when the view ends, also when it failed: a page left open polls on as the device, and
// the views after it timed out one by one (#549).

/**
 * `open` a page of a size, signed in as a device; `attempt` a view, failing only that view. With
 * `only` (a set of attempt names, screen-views.mjs `attemptOf`), the other views are not taken:
 * the run's choice of themes, sizes and views (screen-views.mjs `chosen`).
 */
export function screenPages({ browser, cookieOn, fail, only = null }) {
  const opened = new Set();
  const open = async ([width, height], cookie) => {
    const context = await browser.newContext({ viewport: { width, height } });
    let page = null;
    // A request still routed when the context closes (a state poll) would throw out of the run.
    const shut = async () => {
      await page?.unrouteAll({ behavior: "ignoreErrors" });
      await context.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
      opened.delete(close);
    };
    // Registered before the setup below, which may throw, and kept until the context is closed:
    // the view's run closes in its `finally` whatever it left open. A view that lost its race
    // may still close its page while the run does; both wait on the one close.
    let shutting = null;
    const close = async () => {
      if (!opened.has(close)) return;
      shutting ??= shut().finally(() => (shutting = null));
      await shutting;
    };
    opened.add(close);
    if (cookie) await context.addCookies([cookieOn(cookie)]);
    // The screen's state and stream are the only things the page waits on; nothing leaves the stack.
    await context.route(/^https:\/\/next-event\.example\//, (route) => route.abort());
    page = await context.newPage();
    return { page, close };
  };
  const attempt = async (name, run) => {
    if (only && !only.has(name)) return;
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

/**
 * Hands `page` each state it fetches through `change`. A state that cannot be handed (an answer
 * not JSON, a `change` that throws) rejects `unhanded`, for the view to fail with its own error.
 * A request cut short once the view closes its page through the `close` answered here is not one
 * (#583): stage-surge closes its page and shows another while its own view is still running.
 */
export async function handStates(page, close, change) {
  let closing = false;
  let broken;
  const unhanded = new Promise((_, reject) => (broken = reject));
  // Rejected only while a view still awaits it; a later rejection must not be unhandled.
  unhanded.catch(() => undefined);
  await page.route("**/api/screen/device/state", async (route) => {
    try {
      const answer = await route.fetch(await viaLoopback(page, route.request()));
      await route.fulfill({ response: answer, json: change(await answer.json()) });
    } catch (err) {
      if (!closing) broken(new Error(`the state handed to the page: ${err?.message ?? err}`));
      await route.abort().catch(() => undefined);
    }
  });
  return {
    unhanded,
    close: () => {
      closing = true;
      return close();
    },
  };
}

/**
 * `route.fetch` options for `request` of `page`: a `.localhost` name goes to the loopback, with the
 * name in `Host` and the context's cookies for it; any other is fetched as asked (`undefined`).
 * Chromium finds `.localhost` names on the loopback itself, but `route.fetch` runs in Node, which
 * asks the resolver; on some runners that answered ENOTFOUND for every handed view (#655). The
 * shots share Caddy's network namespace, so its loopback is where the page's name leads.
 */
async function viaLoopback(page, request) {
  const url = new URL(request.url());
  if (!url.hostname.endsWith(".localhost")) return undefined;
  const headers = { ...request.headers(), host: url.host };
  // Cookies follow the URL, which no longer names the event once it points at the loopback.
  const cookies = await page.context().cookies(url.href);
  if (cookies.length) headers.cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  url.hostname = "127.0.0.1";
  return { url: url.href, headers };
}
