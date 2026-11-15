// The screen shots' pages (stack/screen-pages.mjs, #549): a view that fails closes the page it
// opened, so it stops polling as the device and the views after it run on their own.
import { describe, expect, it } from "vitest";
import { screenPages } from "./stack/screen-pages.mjs";

function fakeBrowser() {
  const contexts: { closed: number }[] = [];
  const browser = {
    newContext: () => {
      const context = {
        closed: 0,
        addCookies: () => Promise.resolve(),
        route: () => Promise.resolve(),
        unrouteAll: () => Promise.resolve(),
        close: () => {
          context.closed += 1;
          return Promise.resolve();
        },
        newPage: () => Promise.resolve({ unrouteAll: () => Promise.resolve() }),
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
});
