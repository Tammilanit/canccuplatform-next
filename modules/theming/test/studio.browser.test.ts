/// <reference lib="dom" />
/**
 * The Studio pages in Chromium: static/studio.js turns their controls into calls of the JSON API,
 * and holds Publish until the preview of the draft's version has loaded when its CSS changed
 * (plan issue-185 D10), all under the admin page policy the pages send.
 */
import type { AddressInfo } from "node:net";
import type { BrowserContext, Page, Route } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import { launch } from "./chromium.js";
import { SCRIPTED, png } from "./drafting.js";
import type { DraftBody } from "./drafting.js";
import { DATABASE_URL, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { demoZip } from "./packaging.js";

const browser = DATABASE_URL ? await launch() : undefined;

describe.skipIf(browser === undefined)("the Studio in Chromium", { timeout: 30_000 }, () => {
  let h: Harness;
  let origin: string;
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

  async function open(path: string, session = "embedder"): Promise<Page> {
    if (browser === undefined) throw new Error("the suite runs only with a browser");
    const context = await browser.newContext();
    contexts.push(context);
    await context.addCookies([{ name: "canccu_session", value: session, url: origin }]);
    const page = await context.newPage();
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

  it("starts a draft from a starting point", async () => {
    const page = await open("/theming/studio/");
    await act(page, '[data-action="starter"][data-starter="level-up"]');
    expect(await page.getAttribute(".canccu-studio", "data-draft-version")).toBe("1");
    expect((await draft()).manifest.mode).toBe("advanced");
  });

  it("saves the brand kit with a new logo, keeping what it does not show", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const page = await open("/theming/studio/");
    await page.setInputFiles('input[name="logo_file"]', {
      name: "Our Logo.PNG",
      mimeType: "image/png",
      buffer: await png("#ff7a45", 32),
    });
    await page.fill('input[name="primary"]', "#ff7a45");
    await page.check('input[name="scheme"][value="light"]');
    await act(page, '[data-action="brand"] button[type="submit"]');
    const saved = await draft();
    expect(saved.manifest.brand).toEqual({
      primary: "#ff7a45",
      accent: "#f59e0b",
      scheme: "light",
    });
    expect(saved.manifest.images).toEqual({ logo: "images/logo.png" });
    expect(await page.locator("img.canccu-studio-logo").count()).toBe(1);

    // Saving again without a new file keeps the logo.
    await page.fill('input[name="accent"]', "#7c5cff");
    await act(page, '[data-action="brand"] button[type="submit"]');
    expect((await draft()).manifest.images).toEqual({ logo: "images/logo.png" });
  });

  it("takes a refused logo out of the draft again and says why", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const page = await open("/theming/studio/");
    await page.setInputFiles('input[name="logo_file"]', {
      name: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: SCRIPTED,
    });
    await act(page, '[data-action="brand"] button[type="submit"]');
    expect(await page.textContent(".canccu-studio-notice")).toContain("images/logo.svg");
    const after = await draft();
    expect((after.files ?? []).map((f) => f.path)).not.toContain("images/logo.svg");
    expect(after.problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("holds Publish until the preview of changed CSS has loaded, then publishes", async () => {
    const res = await fetch(`${origin}/api/theming/draft/package`, {
      method: "PUT",
      headers: { cookie: "canccu_session=embedder", origin, "content-type": "application/zip" },
      body: new Uint8Array(await demoZip("terminal")),
    });
    expect(res.status).toBe(200);
    const held: Route[] = [];
    if (browser === undefined) throw new Error("no browser");
    const context = await browser.newContext();
    contexts.push(context);
    await context.addCookies([{ name: "canccu_session", value: "embedder", url: origin }]);
    const page = await context.newPage();
    await page.route("**/theming/studio/preview/**", (route) => {
      held.push(route);
    });
    await page.goto(`${origin}/theming/studio/`, { waitUntil: "domcontentloaded" });
    const publish = page.locator('[data-action="publish"]');
    await expect.poll(() => held.length).toBe(4);
    expect(await publish.isDisabled()).toBe(true);
    await Promise.all(held.slice(0, 3).map((r) => r.continue()));
    await page.waitForTimeout(200);
    expect(await publish.isDisabled()).toBe(true);
    await held[3]?.continue();
    await expect.poll(() => publish.isDisabled()).toBe(false);

    // The reload after publishing loads its previews unheld.
    await page.unroute("**/theming/studio/preview/**");
    await act(page, '[data-action="publish"]');
    expect(await page.textContent(".canccu-studio-status")).toContain(
      "Revision 1 is on every screen",
    );
  });

  it("restores a revision in one click", async () => {
    for (let i = 0; i < 2; i++) {
      await api("POST", "/api/theming/draft", { from: "defaults" });
      const v = (await draft()).draft_version;
      expect((await api("POST", "/api/theming/draft/publish", { draft_version: v })).status).toBe(
        201,
      );
    }
    const page = await open("/theming/studio/history");
    await act(page, '[data-action="restore"][data-revision="1"]');
    expect(await page.getAttribute(".canccu-studio", "data-current-revision")).toBe("3");
    expect(await page.textContent(".canccu-studio-revisions")).toContain("restored from 1");
  });

  it("saves only the tokens that changed", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const page = await open("/theming/studio/advanced");
    await page.fill('input[name="sizes.radius"]', "0px");
    await act(page, '[data-action="tokens"] button[type="submit"]');
    const saved = await draft();
    expect(saved.manifest.mode).toBe("advanced");
    expect((saved.manifest.tokens as { sizes?: unknown }).sizes).toEqual({ radius: "0px" });
    expect((saved.manifest.tokens as { fonts?: unknown }).fonts).toBeUndefined();
  });

  it("uploads a package and goes back to simple", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const page = await open("/theming/studio/advanced");
    await page.setInputFiles('input[name="package"]', {
      name: "theme.zip",
      mimeType: "application/zip",
      buffer: await demoZip("terminal"),
    });
    await act(page, '[data-action="package"] button[type="submit"]');
    expect((await draft()).manifest.mode).toBe("advanced");
    // The colours of simple mode come from a brand, which the terminal theme has none of.
    await page.goto(`${origin}/theming/studio/`);
    await act(page, '[data-action="brand"] button[type="submit"]');
    await page.goto(`${origin}/theming/studio/advanced`);
    await page.click('[data-action="simple"] >> xpath=ancestor::details/summary');
    await act(page, '[data-action="simple"] button[type="submit"]');
    expect((await draft()).manifest.mode).toBe("simple");
  });

  it("says why when the API refuses, after reading the draft again", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const page = await open("/theming/studio/");
    // Someone else changes the draft meanwhile.
    const v = (await draft()).draft_version;
    await api("PATCH", "/api/theming/draft/tokens", {
      draft_version: v,
      tokens: { motion: "calm" },
    });
    await act(page, '[data-action="brand"] button[type="submit"]');
    const notice = page.locator(".canccu-studio-notice");
    expect(await notice.isVisible()).toBe(true);
    expect(await notice.textContent()).toContain("changed by someone else");
    expect(await page.getAttribute(".canccu-studio", "data-draft-version")).toBe(String(v + 1));
  });

  it("discards the draft", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const page = await open("/theming/studio/");
    await page.click(".canccu-studio-confirm summary");
    await act(page, '[data-action="discard"]');
    expect(await page.getAttribute(".canccu-studio", "data-draft-version")).toBeNull();
    expect((await api("GET", "/api/theming/draft")).status).toBe(404);
  });
});
