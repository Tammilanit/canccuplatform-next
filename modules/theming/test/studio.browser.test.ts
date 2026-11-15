/// <reference lib="dom" />
/**
 * The Studio pages in Chromium: static/studio.js turns their controls into calls of the JSON API,
 * and holds Publish until the preview of the draft's version has loaded when its CSS changed
 * (plan issue-185 D10), all under the admin page policy the pages send. The brand kit's and the
 * tokens' saves are studio-brand.browser.test.ts.
 */
import type { Route } from "playwright-core";
import { describe, expect, it } from "vitest";
import { demoZip } from "./packaging.js";
import { browser, studioSuite } from "./studio-page.js";

describe.skipIf(browser === undefined)("the Studio in Chromium", { timeout: 30_000 }, () => {
  const s = studioSuite();
  const { open, api, draft, act, change, context } = s;

  it("starts a draft from a starting point", async () => {
    const page = await open("/theming/studio/");
    await act(page, '[data-action="starter"][data-starter="level-up"]');
    expect(await page.getAttribute(".canccu-studio", "data-draft-version")).toBe("1");
    expect((await draft()).manifest.mode).toBe("advanced");
  });

  it("holds Publish until the preview of changed CSS has loaded, then publishes", async () => {
    const res = await fetch(`${s.origin}/api/theming/draft/package`, {
      method: "PUT",
      headers: {
        cookie: "canccu_session=embedder",
        origin: s.origin,
        "content-type": "application/zip",
      },
      body: new Uint8Array(await demoZip("terminal")),
    });
    expect(res.status).toBe(200);
    const held: Route[] = [];
    const page = await (await context()).newPage();
    await page.route("**/theming/studio/preview/**", (route) => {
      held.push(route);
    });
    await page.goto(`${s.origin}/theming/studio/`, { waitUntil: "domcontentloaded" });
    // Both Publish buttons, the title row's and the phone row's, wait for the previews.
    const publish = page.locator('.canccu-pagehead [data-action="publish"]');
    const phonePublish = page.locator('.canccu-studio-pendbar [data-action="publish"]');
    await expect.poll(() => held.length).toBe(4);
    expect(await publish.isDisabled()).toBe(true);
    await Promise.all(held.slice(0, 3).map((r) => r.continue()));
    await page.waitForTimeout(200);
    expect(await publish.isDisabled()).toBe(true);
    await held[3]?.continue();
    await expect.poll(() => publish.isDisabled()).toBe(false);
    expect(await phonePublish.isDisabled()).toBe(false);

    // The reload after publishing loads its previews unheld.
    await page.unroute("**/theming/studio/preview/**");
    await act(page, '.canccu-pagehead [data-action="publish"]');
    expect(await page.textContent(".canccu-pagehead__desc")).toContain(
      "Screens show the published theme",
    );
  });

  it("draws the real player of a zone with the draft's look", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const v = (await draft()).draft_version;
    const page = await (await context()).newPage();
    // Screen's API and its virtual screen, as the screen module answers them; the page keeps
    // what the Studio posts it.
    await page.route("**/api/screen/zones", (r) =>
      r.fulfill({
        json: {
          zones: [
            { key: "cafe", name: "Café" },
            { key: "main", name: "Main hall" },
          ],
        },
      }),
    );
    const state = {
      state_version: 3,
      time: new Date().toISOString(),
      tenant: { id: "local", name: "Demo Event", time_zone: "UTC", status: "live" },
      device: { id: "mirror", name: "Main hall", mirror: true },
      theme: {
        revision: 0,
        tokens_css_url: "/theming/a/tokens.css",
        css_url: null,
        logo_url: null,
      },
      regions: [
        {
          id: "header",
          widgets: [{ widget: "logo", view: { url: "/theming/a/old.png", name: "Demo Event" } }],
          idle_view: null,
        },
      ],
    };
    await page.route("**/api/screen/zones/main/state", (r) => r.fulfill({ json: state }));
    await page.route("**/screen/zones/main", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: `<body><script>addEventListener("message", (e) => { window.posted = e.data; });</script></body>`,
      }),
    );
    await page.goto(`${s.origin}/theming/studio/`);
    await expect
      .poll(() => page.locator("iframe[data-screen-preview]").getAttribute("src"))
      .toBe("/screen/zones/main");
    const posted = () =>
      page
        .frame({ url: /\/screen\/zones\/main$/ })
        ?.evaluate(() => (window as { posted?: unknown }).posted);
    await expect.poll(posted).toMatchObject({
      type: "canccu-screen-preview",
      state: {
        state_version: 3,
        theme: { tokens_css_url: `/theming/studio/draft/tokens.css?v=${v}`, css_url: null },
      },
    });
    expect(await page.textContent(".canccu-studio-zone")).toContain("Main hall");
    expect(await page.locator(".canccu-studio-zones option").count()).toBe(2);
  });

  it("puts the preview first on a phone, one at a time, and Publish above the bottom bar", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const page = await open("/theming/studio/");
    await page.setViewportSize({ width: 390, height: 844 });
    const top = (sel: string) =>
      page
        .locator(sel)
        .first()
        .evaluate((el) => el.getBoundingClientRect().top);
    expect(await top(".canccu-studio-preview--screen")).toBeLessThan(
      await top('form[data-action="brand"]'),
    );
    expect(await page.locator(".canccu-pagehead [data-action='publish']").isVisible()).toBe(false);
    expect(await page.locator(".canccu-studio-pendbar [data-action='publish']").isVisible()).toBe(
      true,
    );
    expect(await page.locator(".canccu-studio-preview--hub").isVisible()).toBe(false);
    await page.click('.canccu-studio-surfaces input[value="hub"]');
    expect(await page.locator(".canccu-studio-preview--hub").isVisible()).toBe(true);
    expect(await page.locator(".canccu-studio-preview--screen").isVisible()).toBe(false);
    await page.click('.canccu-studio-surfaces input[value="screen"]');
    // The way to full size sits under the thumbnail, never over the screen it shows (#406).
    const thumbEnd = await page
      .locator(".canccu-studio-preview--screen .canccu-studio-preview__box")
      .evaluate((el) => el.getBoundingClientRect().bottom);
    expect(await top(".canccu-studio-tap")).toBeGreaterThanOrEqual(thumbEnd);
    await page.click(".canccu-studio-tap");
    expect(
      await page.locator(".canccu-studio-preview--screen.canccu-studio-preview--full").isVisible(),
    ).toBe(true);
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
    await page.goto(`${s.origin}/theming/studio/`);
    await change(page, () => page.check('input[name="scheme"][value="light"]'));
    await page.goto(`${s.origin}/theming/studio/advanced`);
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
    await change(page, () => page.check('input[name="scheme"][value="light"]'));
    const notice = page.locator(".canccu-studio-notice");
    expect(await notice.isVisible()).toBe(true);
    expect(await notice.textContent()).toContain("changed by someone else");
    expect(await page.getAttribute(".canccu-studio", "data-draft-version")).toBe(String(v + 1));
  });

  it("discards the draft", async () => {
    await api("POST", "/api/theming/draft", { from: "defaults" });
    const page = await open("/theming/studio/");
    // Discard asks first, in the page's own dialog.
    await page.click('[data-action="discard-ask"]');
    expect(await page.locator("#canccu-studio-discard").isVisible()).toBe(true);
    await act(page, '[data-action="discard"]');
    expect(await page.getAttribute(".canccu-studio", "data-draft-version")).toBeNull();
    expect((await api("GET", "/api/theming/draft")).status).toBe(404);
  });
});
