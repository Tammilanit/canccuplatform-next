/// <reference lib="dom" />
/**
 * The sandbox in a real browser (contracts/theming.md, The sandbox): what the headers promise,
 * Chromium enforces. The host page is an event page on the same hostname, as the screen will be.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright-core";
import type { Browser, Frame, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embedWidget } from "@canccu/ui";
import { DATABASE_URL, demoEmbed, harness, seedEmbeds } from "./helpers.js";
import type { Harness } from "./helpers.js";

/** The bundled Chromium where Playwright installed one, else the runner's Chrome; in CI one must run. */
async function launch(): Promise<Browser | undefined> {
  for (const options of [{}, { channel: "chrome" }]) {
    try {
      return await chromium.launch(options);
    } catch {
      // Try the next one.
    }
  }
  if (process.env.CI) throw new Error("no Chromium or Chrome for the sandbox browser tests");
  return undefined;
}

const browser = DATABASE_URL ? await launch() : undefined;

const BROKEN = {
  entry: "embeds/broken/index.html",
  files: {
    "embeds/broken/index.html": Buffer.from('<!doctype html><script src="boom.js"></script>'),
    "embeds/broken/boom.js": Buffer.from('throw new Error("boom");'),
  },
};
const LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#3ddcff"/></svg>',
);
const UI_CSS = await readFile(new URL("../node_modules/@canccu/ui/ui.css", import.meta.url));

describe.skipIf(browser === undefined)("the sandbox in Chromium", () => {
  let h: Harness;
  let origin: string;
  let page: Page;
  // A server that answers anyone, with CORS: what an embed would phone home to.
  const hits: string[] = [];
  const phoneHome = createServer((req, res) => {
    hits.push(req.url ?? "");
    res.setHeader("access-control-allow-origin", "*");
    if (req.url?.endsWith(".svg")) res.setHeader("content-type", "image/svg+xml");
    res.end(req.url?.endsWith(".svg") ? LOGO : "ok");
  }).on("upgrade", (req: IncomingMessage, socket: Duplex) => {
    hits.push(req.url ?? "");
    socket.destroy();
  });

  beforeAll(async () => {
    h = await harness();
    await seedEmbeds(
      h,
      "local",
      { revision: 1 },
      { drift: await demoEmbed("level-up", "drift"), broken: BROKEN },
    );
    await h.app.listen({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => phoneHome.listen(0, "127.0.0.1", resolve));
    origin = `http://localhost:${(h.app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await browser?.close();
    phoneHome.close();
    await h.close();
  });

  /** An event page framing `frameUrl` as the screen will: the event CSP, ui.css, a session cookie. */
  async function screen(frameUrl: string | undefined, reducedMotion = false): Promise<Page> {
    if (browser === undefined) throw new Error("the suite runs only with a browser");
    const context = await browser.newContext({
      viewport: { width: 640, height: 360 },
      reducedMotion: reducedMotion ? "reduce" : "no-preference",
    });
    await context.addCookies([{ name: "canccu_session", value: "secret", url: origin }]);
    page = await context.newPage();
    const body = embedWidget({ logoUrl: "/test/logo.svg", ...(frameUrl ? { frameUrl } : {}) });
    await page.route(`${origin}/test/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/test/ui.css") return route.fulfill({ body: UI_CSS, contentType: "text/css" });
      if (path === "/test/logo.svg")
        return route.fulfill({ body: LOGO, contentType: "image/svg+xml" });
      return route.fulfill({
        contentType: "text/html",
        headers: {
          "content-security-policy":
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
            `connect-src 'self'; frame-src ${origin}/theming/sandbox/; base-uri 'none'`,
        },
        body:
          '<!doctype html><html><head><link rel="stylesheet" href="/test/ui.css"></head>' +
          '<body class="canccu-page canccu-surface canccu-surface--screen">' +
          `<div id="w" style="width:640px;height:360px">${String(body)}</div></body></html>`,
      });
    });
    await page.goto(`${origin}/test/screen`);
    await page.evaluate(() => {
      localStorage.setItem("canccu_secret", "screen");
    });
    return page;
  }

  async function embedFrame(p: Page): Promise<Frame> {
    const handle = await p.waitForSelector("iframe.canccu-embed");
    const frame = await handle.contentFrame();
    if (frame === null) throw new Error("no frame");
    await frame.waitForLoadState("load");
    return frame;
  }

  const shot = (p: Page): Promise<Buffer> => p.locator(".canccu-widget--embed").screenshot();

  it("runs the level-up theme's drift embed", async () => {
    const p = await screen("/theming/sandbox/1/drift/index.html");
    const frame = await embedFrame(p);
    expect(await frame.evaluate(() => document.querySelector("canvas")?.width)).toBeGreaterThan(0);
    const first = await shot(p);
    await p.waitForTimeout(400);
    // It animates, so it is no still.
    expect(first.equals(await shot(p))).toBe(false);
  });

  it("gives the embed an opaque origin: no cookies, no storage", async () => {
    const frame = await embedFrame(await screen("/theming/sandbox/1/drift/index.html"));
    const result = await frame.evaluate(() => {
      const attempt = (fn: () => unknown): string => {
        try {
          return `ok:${String(fn())}`;
        } catch (err) {
          return (err as Error).name;
        }
      };
      return {
        origin: window.origin,
        cookie: attempt(() => document.cookie),
        local: attempt(() => localStorage.getItem("canccu_secret")),
        session: attempt(() => sessionStorage.length),
        indexedDb: attempt(() => indexedDB.open("x")),
      };
    });
    expect(result).toEqual({
      origin: "null",
      cookie: "SecurityError",
      local: "SecurityError",
      session: "SecurityError",
      indexedDb: "SecurityError",
    });
  });

  it("gives the embed no network, even to a server that would answer it", async () => {
    const frame = await embedFrame(await screen("/theming/sandbox/1/drift/index.html"));
    hits.length = 0;
    const result = await frame.evaluate(
      async (target) => {
        const fetched = await fetch(target).then(
          () => "reached",
          (err: unknown) => (err as Error).name,
        );
        const xhr = await new Promise<string>((resolve) => {
          const x = new XMLHttpRequest();
          x.onload = () => {
            resolve("reached");
          };
          x.onerror = () => {
            resolve("blocked");
          };
          x.open("GET", target);
          x.send();
        });
        const socket = await new Promise<string>((resolve) => {
          try {
            const ws = new WebSocket(target.replace("http", "ws"));
            ws.onopen = () => {
              resolve("reached");
            };
            ws.onerror = () => {
              resolve("blocked");
            };
          } catch (err) {
            resolve((err as Error).name);
          }
        });
        const image = await new Promise<string>((resolve) => {
          const img = new Image();
          img.onload = () => {
            resolve("reached");
          };
          img.onerror = () => {
            resolve("blocked");
          };
          img.src = `${target}.svg`;
        });
        navigator.sendBeacon(target, "screen contents");
        return { fetched, xhr, socket, image };
      },
      `http://127.0.0.1:${(phoneHome.address() as AddressInfo).port}/beacon`,
    );
    expect(result).toEqual({
      fetched: "TypeError",
      xhr: "blocked",
      socket: "blocked",
      image: "blocked",
    });
    await page.waitForTimeout(300);
    expect(hits).toEqual([]);
  });

  it("gives the embed no access to the page it is on", async () => {
    const frame = await embedFrame(await screen("/theming/sandbox/1/drift/index.html"));
    const result = await frame.evaluate(() => {
      const attempt = (fn: () => unknown): string => {
        try {
          return `ok:${String(fn())}`;
        } catch (err) {
          return (err as Error).name;
        }
      };
      return {
        document: attempt(() => window.parent.document.title),
        storage: attempt(() => window.parent.localStorage.length),
        location: attempt(() => window.top?.location.href),
        navigate: attempt(() => {
          if (window.top !== null) window.top.location.href = "/admin/settings";
        }),
      };
    });
    expect(result.document).toBe("SecurityError");
    expect(result.storage).toBe("SecurityError");
    expect(result.location).toBe("SecurityError");
    // Top navigation without allow-top-navigation: refused, the screen stays where it is.
    expect(page.url()).toBe(`${origin}/test/screen`);
  });

  it("lets no page on the hostname run an embed's script as its own", async () => {
    const p = await screen(undefined);
    const outcome = await p.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const script = document.createElement("script");
          script.src = "/theming/sandbox/1/drift/drift.js";
          script.onload = () => {
            resolve("ran");
          };
          script.onerror = () => {
            resolve("refused");
          };
          document.head.append(script);
        }),
    );
    expect(outcome).toBe("refused");
    // Chrome turns an empty 404 into its own error page and goto() into an error; the response
    // tells what the server answered either way.
    const entry = `${origin}/theming/sandbox/1/drift/index.html`;
    const answered = p.waitForResponse(entry);
    await p.goto(entry).catch(() => undefined);
    expect((await answered).status()).toBe(404);
  });

  describe("the still", () => {
    it("shows instead of the embed when the viewer asks for reduced motion", async () => {
      const still = await shot(await screen(undefined));
      const p = await screen("/theming/sandbox/1/drift/index.html", true);
      await p.waitForSelector("iframe.canccu-embed", { state: "attached" });
      expect(await p.locator("iframe.canccu-embed").isVisible()).toBe(false);
      expect((await shot(p)).equals(still)).toBe(true);
    });

    it.each([
      ["an embed the sandbox does not serve", "/theming/sandbox/1/gone/index.html"],
      ["an embed whose script fails before it paints", "/theming/sandbox/1/broken/index.html"],
    ])("shows through %s", async (_, frameUrl) => {
      const still = await shot(await screen(undefined));
      const p = await screen(frameUrl);
      await embedFrame(p);
      expect((await shot(p)).equals(still)).toBe(true);
    });
  });
});
