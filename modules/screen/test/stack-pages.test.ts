// The screen shots' pages (stack/screen-pages.mjs, #549): a view that fails closes the page it
// opened, so it stops polling as the device and the views after it run on their own; one whose
// setup throws or whose close fails is closed all the same (#583).
import { describe, expect, it } from "vitest";
import { handStates, screenPages } from "./stack/screen-pages.mjs";

/** `newPage` rejects with `pageFails`; the first `closeFails` closes of each context reject. */
function fakeBrowser({ pageFails = "", closeFails = 0 } = {}) {
  const contexts: { closed: number; tries: number }[] = [];
  const browser = {
    newContext: () => {
      const context = {
        closed: 0,
        tries: 0,
        addCookies: () => Promise.resolve(),
        route: () => Promise.resolve(),
        unrouteAll: () => Promise.resolve(),
        close: () => {
          context.tries += 1;
          if (context.tries <= closeFails) return Promise.reject(new Error("close failed"));
          context.closed += 1;
          return Promise.resolve();
        },
        newPage: () =>
          pageFails
            ? Promise.reject(new Error(pageFails))
            : Promise.resolve({ unrouteAll: () => Promise.resolve() }),
      };
      contexts.push(context);
      return Promise.resolve(context);
    },
  };
  return { browser, contexts };
}

describe("the screen shots' pages", () => {
  it("closes the page of a failed view, and runs the next view on its own", async () => {
    const { browser, contexts } = fakeBrowser();
    const failed: string[] = [];
    const { open, attempt } = screenPages({
      browser,
      cookieOn: (c) => ({ name: "canccu_device", value: c }),
      fail: (m) => failed.push(m),
    });
    await attempt("pulse", async () => {
      await open([1920, 1080], "a");
      throw new Error("the layout did not draw\n  at a long stack");
    });
    expect(failed).toEqual(["pulse: the layout did not draw"]);
    expect(contexts.map((c) => c.closed)).toEqual([1]);

    await attempt("unassigned", async () => {
      const { close } = await open([1920, 1080], "b");
      await close();
    });
    expect(failed).toHaveLength(1);
    // Closed once, by the view itself: the run's own close in `finally` does not close it again.
    expect(contexts.map((c) => c.closed)).toEqual([1, 1]);
  });

  it("closes the context of a page whose setup throws", async () => {
    const { browser, contexts } = fakeBrowser({ pageFails: "the browser has crashed" });
    const failed: string[] = [];
    const { open, attempt } = screenPages({ browser, cookieOn: () => ({}), fail: (m) => failed.push(m) });
    await attempt("pulse", () => open([1920, 1080], "a"));
    expect(failed).toEqual(["pulse: the browser has crashed"]);
    expect(contexts.map((c) => c.closed)).toEqual([1]);
  });

  it("keeps a page whose close failed, and closes it after the view", async () => {
    const { browser, contexts } = fakeBrowser({ closeFails: 1 });
    const failed: string[] = [];
    const { open, attempt } = screenPages({ browser, cookieOn: () => ({}), fail: (m) => failed.push(m) });
    await attempt("pulse", async () => {
      const { close } = await open([1920, 1080], "a");
      await close();
    });
    expect(failed).toEqual(["pulse: close failed"]);
    expect(contexts.map((c) => [c.tries, c.closed])).toEqual([[2, 1]]);
  });
});

type Handler = (route: FakeRoute) => Promise<void>;
interface FakeRoute {
  fetch: () => Promise<{ json: () => Promise<object> }>;
  fulfill: (o: { json: object }) => Promise<void>;
  abort: () => Promise<void>;
  aborted?: boolean;
  handed?: object;
}

/** A page whose state requests the test sends itself (`request`), each failing or not. */
function fakePage() {
  let handler: Handler = () => Promise.resolve();
  const page = {
    route: (_: string, h: Handler) => {
      handler = h;
      return Promise.resolve();
    },
  };
  const request = async (fails: boolean) => {
    const route: FakeRoute = {
      fetch: () =>
        fails
          ? Promise.reject(new Error("Target page, context or browser has been closed"))
          : Promise.resolve({ json: () => Promise.resolve({ ticker: "the server's" }) }),
      fulfill: (o) => {
        route.handed = o.json;
        return Promise.resolve();
      },
      abort: () => {
        route.aborted = true;
        return Promise.resolve();
      },
    };
    await handler(route);
    return route;
  };
  return { page, request };
}

const never = (ms = 50) => new Promise((resolve) => setTimeout(() => resolve("still open"), ms));

describe("a page handed its states", () => {
  const change = (s: object) => ({ ...s, ticker: "handed" });

  it("hands the page the changed state", async () => {
    const { page, request } = fakePage();
    await handStates(page, () => Promise.resolve(), change);
    expect((await request(false)).handed).toEqual({ ticker: "handed" });
  });

  it("fails the view on a state that cannot be handed", async () => {
    const { page, request } = fakePage();
    const { unhanded } = await handStates(page, () => Promise.resolve(), change);
    await request(true);
    await expect(unhanded).rejects.toThrow(/^the state handed to the page: Target page/);
  });

  it("does not fail the view on a request the view's own close cut short", async () => {
    const { page, request } = fakePage();
    const { unhanded, close } = await handStates(page, () => Promise.resolve(), change);
    await close();
    expect((await request(true)).aborted).toBe(true);
    expect(await Promise.race([unhanded, never()])).toBe("still open");
  });

  it("holds while a closed view's strip runs a page of its own (stage-surge's nested view)", async () => {
    const outer = fakePage();
    const inner = fakePage();
    const strip = await handStates(outer.page, () => Promise.resolve(), change);
    // The strip closes its page, then shows the state before on a new one, while the closed
    // page's last state request is still in flight and fails.
    const shown = async () => {
      await strip.close();
      const before = await handStates(inner.page, () => Promise.resolve(), change);
      await outer.request(true);
      await inner.request(false);
      await before.close();
      return "shot";
    };
    expect(await Promise.race([shown(), strip.unhanded])).toBe("shot");
  });
});
