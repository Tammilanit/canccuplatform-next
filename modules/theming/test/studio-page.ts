/// <reference lib="dom" />
/**
 * The Studio's browser suites (studio*.browser.test.ts): the app listening on a port with an empty
 * theme per test, its pages in Chromium signed in as a session, and the API as that session calls
 * it. Every page `open` opens runs under the pages' own policy, which nothing may violate.
 */
import type { AddressInfo } from "node:net";
import type { BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";
import { withTenant } from "@canccu/kit";
import { launch } from "./chromium.js";
import type { DraftBody } from "./drafting.js";
import { DATABASE_URL, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

export const browser = DATABASE_URL ? await launch() : undefined;

/** Registers the suite's hooks; call it inside the suite's `describe`. */
export function studioSuite() {
  let h: Harness;
  let origin = "";
  const contexts: BrowserContext[] = [];
  const violations: string[] = [];

  beforeAll(async () => {
    h = await harness();
    await h.app.listen({ host: "127.0.0.1", port: 0 });
    origin = `http://localhost:${(h.app.server.address() as AddressInfo).port}`;
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await h.close();
  });
  beforeEach(async () => {
    violations.length = 0;
    await withTenant("local", () =>
      h.db.tenant(async (c) => {
        for (const table of [
          "theming_drafts",
          "theming_revisions",
          "theming_file_refs",
          "theming_package_files",
          "theming_embed_files",
          "theming_files",
        ]) {
          await c.query(`DELETE FROM ${table}`);
        }
      }),
    );
  });
  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((c) => c.close()));
    // The pages run under their own policy: nothing they do may be refused by it.
    expect(violations).toEqual([]);
  });

  /** A browser context signed in as `session`, closed after the test. */
  async function context(session = "embedder"): Promise<BrowserContext> {
    if (browser === undefined) throw new Error("the suite runs only with a browser");
    const made = await browser.newContext();
    contexts.push(made);
    await made.addCookies([{ name: "canccu_session", value: session, url: origin }]);
    return made;
  }

  async function open(path: string, session = "embedder"): Promise<Page> {
    const page = await (await context(session)).newPage();
    page.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    await page.goto(origin + path);
    return page;
  }

  /** The API as the browser's session would call it. */
  async function api(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(origin + path, {
      method,
      headers: {
        cookie: "canccu_session=embedder",
        origin,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const draft = async (): Promise<DraftBody & { manifest: Record<string, unknown> }> =>
    (await (await api("GET", "/api/theming/draft")).json()) as DraftBody & {
      manifest: Record<string, unknown>;
    };

  /** Clicks a control that reloads the page when its call is done. */
  async function act(page: Page, selector: string): Promise<void> {
    await Promise.all([page.waitForEvent("load"), page.click(selector)]);
  }

  /** A change the brand kit saves at once (it has no Save), and the reload that follows. */
  async function change(page: Page, edit: () => Promise<unknown>): Promise<void> {
    await Promise.all([page.waitForEvent("load"), edit()]);
  }
  /** Types a hex colour; leaving the field is what saves it. */
  const typeHex = (page: Page, name: string, value: string) =>
    change(page, async () => {
      const field = page.locator(`input[name="${name}"]`);
      await field.fill(value);
      await field.blur();
    });

  return {
    /** The app's address, once the suite has started. */
    get origin() {
      return origin;
    },
    context,
    open,
    api,
    draft,
    act,
    change,
    typeHex,
  };
}
