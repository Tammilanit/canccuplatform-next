/**
 * The pizza app on a port for Chromium, behind a stand-in for Caddy: `/pizza/…` is the module's
 * own path, as `handle_path` strips it, so the pages' links, forms and redirects work as deployed.
 * Chromium reaches `demo.test` at this machine, so the event resolves by its hostname.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser, BrowserContext } from "playwright-core";
import type { World } from "./helpers.js";

export interface Served {
  origin: string;
  close(): Promise<void>;
}

export async function serve(w: World): Promise<Served> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/pizza/") === true) req.url = req.url.slice("/pizza".length);
    w.app.routing(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://demo.test:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** A context signed in as `who`, at phone or desk width. */
export async function signedIn(
  browser: Browser,
  s: Served,
  who: string,
  width = 390,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    // A phone is touch only, so its pages' `(any-pointer: fine)` rules do not apply (H2).
    hasTouch: width < 600,
    isMobile: width < 600,
  });
  await context.addCookies([{ name: "canccu_session", value: who, url: s.origin }]);
  return context;
}

/** Chromium's flag that sends demo.test to this machine. */
export const HOSTS = ["--host-resolver-rules=MAP demo.test 127.0.0.1"];
