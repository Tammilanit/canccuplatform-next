/// <reference lib="dom" />
/**
 * The brand kit's screen preview in Chromium: it gates Publish, so it must show what Publish will
 * show (#551). Screen's API and its virtual screen are stood in for as the screen module answers
 * them; the stand-in player keeps what the Studio posts it, and acknowledges it only when told to.
 */
import type { Page, Route } from "playwright-core";
import { describe, expect, it } from "vitest";
import { png } from "./drafting.js";
import { demoZip } from "./packaging.js";
import { browser, studioSuite } from "./studio-page.js";

const area = (column: number, row: number, columns: number, rows: number) => ({
  column,
  row,
  columns,
  rows,
});

const region = (id: string, at: ReturnType<typeof area>, widgets: unknown[]) => ({
  id,
  role: id,
  area: at,
  layer: 0,
  rotation: "sequence",
  order: widgets.map((_, i) => i),
  cycle_started_at: "2026-01-01T00:00:00Z",
  idle: "logo",
  idle_view: null,
  widgets,
  claim: null,
});

const view = (fields: Record<string, unknown>, empty = false) => ({
  ...fields,
  qr: null,
  stale: false,
  empty,
});

/** A zone's state as screen serves it, its theme the published one. */
function zoneState(name: string, logoUrl: string | null, regions: unknown[]) {
  return {
    state_version: 3,
    time: new Date().toISOString(),
    tenant: { id: "local", name: "Demo Event", time_zone: "UTC", status: "live" },
    device: { id: "mirror", name, mirror: true },
    zone: { key: name.toLowerCase(), name, epoch: "e1" },
    theme: {
      revision: 1,
      tokens_css_url: "/theming/a/tokens.css",
      css_url: null,
      logo_url: logoUrl,
      templates: [],
      layouts: [],
    },
    layout: {
      id: "pulse",
      name: "Pulse",
      aspect: "16:9",
      grid: { columns: 12, rows: 12 },
      regions: [
        { id: "header", area: area(1, 1, 12, 1), widgets: [{ widget: "logo" }] },
        { id: "hero", area: area(1, 2, 8, 10), widgets: [{ widget: "embed", embed: "drift" }] },
      ],
    },
    regions,
  };
}

type Posted = { type: string; id: unknown; state: Record<string, unknown> & { regions: never[] } };

describe.skipIf(browser === undefined)(
  "the screen preview in Chromium",
  { timeout: 30_000 },
  () => {
    const s = studioSuite();
    const { api, draft, context } = s;

    /** A draft from the defaults, with `images/logo.png` as its brand's logo. */
    async function draftWithLogo(): Promise<void> {
      await api("POST", "/api/theming/draft", { from: "defaults" });
      const q = `path=${encodeURIComponent("images/logo.png")}&draft_version=${(await draft()).draft_version}`;
      const put = await fetch(`${s.origin}/api/theming/draft/file?${q}`, {
        method: "PUT",
        headers: {
          cookie: "canccu_session=embedder",
          origin: s.origin,
          "content-type": "image/png",
        },
        body: new Uint8Array(await png("#ff7a45", 32)),
      });
      expect(put.status).toBe(200);
      const brand = await api("PUT", "/api/theming/draft/brand", {
        draft_version: ((await put.json()) as { draft_version: number }).draft_version,
        primary: "#ff7a45",
        accent: "#f59e0b",
        scheme: "dark",
        logo: "images/logo.png",
      });
      expect(brand.status).toBe(200);
    }

    /**
     * The Studio with screen's zones answered by `states` (a zone's key to its state, or a route
     * handler for it); `ack` makes the stand-in player confirm each state it is posted.
     */
    async function studio(
      states: Record<string, unknown>,
      o: { ack?: boolean; names?: Record<string, string> } = {},
    ): Promise<{ page: Page; posted: (zone: string) => Promise<Posted | undefined> }> {
      const page = await (await context()).newPage();
      const keys = Object.keys(states);
      await page.route("**/api/screen/zones", (r) =>
        r.fulfill({ json: { zones: keys.map((key) => ({ key, name: o.names?.[key] ?? key })) } }),
      );
      for (const key of keys) {
        const answer = states[key];
        await page.route(`**/api/screen/zones/${key}/state`, (r: Route) =>
          typeof answer === "function"
            ? (answer as (r: Route) => Promise<void>)(r)
            : r.fulfill({ json: answer }),
        );
        const ack = o.ack
          ? `e.source.postMessage({ type: "canccu-screen-preview-drawn", id: e.data.id }, e.origin);`
          : "";
        await page.route(`**/screen/zones/${key}`, (r) =>
          r.fulfill({
            contentType: "text/html",
            body: `<body><script>addEventListener("message", (e) => { window.posted = e.data; ${ack} });</script></body>`,
          }),
        );
      }
      await page.goto(`${s.origin}/theming/studio/yours`);
      const posted = (zone: string) =>
        page
          .frame({ url: new RegExp(`/screen/zones/${zone}$`) })
          ?.evaluate(() => (window as { posted?: Posted }).posted) ?? Promise.resolve(undefined);
      return { page, posted };
    }

    const widgetsOf = (p: Posted | undefined) =>
      (p?.state.regions ?? []).flatMap(
        (r: { widgets: { widget: string; view: Record<string, unknown> }[] }) => r.widgets,
      );

    it("shows the draft's logo where nothing published has one", async () => {
      await draftWithLogo();
      const state = zoneState("Main", null, [
        region("header", area(1, 1, 12, 1), [
          { widget: "logo", dwell_seconds: 15, view: view({}, true) },
        ]),
        region("hero", area(1, 2, 8, 10), [
          {
            widget: "embed",
            dwell_seconds: 15,
            view: view({ frame_url: "/theming/sandbox/1/drift/index.html", logo_url: null }),
          },
        ]),
      ]);
      const { posted } = await studio({ main: state });
      await expect.poll(() => posted("main")).toBeDefined();
      const sent = await posted("main");
      const logo = (sent?.state.theme as { logo_url: string }).logo_url;
      expect(logo).toMatch(/^\/theming\/draft\/[0-9a-f]{64}\.png$/);
      const [shown, embed] = widgetsOf(sent);
      expect(shown?.view).toMatchObject({ url: logo, name: "Demo Event", empty: false });
      expect(embed?.view).toMatchObject({ logo_url: logo, empty: false });
    });

    it("blanks the published logo when the draft has none", async () => {
      await api("POST", "/api/theming/draft", { from: "defaults" });
      const old = "/theming/a/old.png";
      const state = zoneState("Main", old, [
        region("header", area(1, 1, 12, 1), [
          { widget: "logo", dwell_seconds: 15, view: view({ url: old, name: "Demo Event" }) },
        ]),
        region("hero", area(1, 2, 8, 10), [
          {
            widget: "embed",
            dwell_seconds: 15,
            view: view({ frame_url: "/theming/sandbox/1/drift/index.html", logo_url: old }),
          },
        ]),
      ]);
      const { posted } = await studio({ main: state });
      await expect.poll(() => posted("main")).toBeDefined();
      const sent = await posted("main");
      expect((sent?.state.theme as { logo_url: unknown }).logo_url).toBeNull();
      const [shown, embed] = widgetsOf(sent);
      expect(shown?.view).toMatchObject({ empty: true });
      expect(shown?.view.url).toBeUndefined();
      expect(embed?.view).toMatchObject({ logo_url: null });
      expect(JSON.stringify(sent)).not.toContain(old);
    });

    it("draws the draft's layouts, keeping a box the zone placed itself", async () => {
      await api("POST", "/api/theming/draft", { from: "defaults" });
      const layout = {
        id: "pulse",
        name: "Pulse, taller header",
        aspect: "16:9",
        grid: { columns: 12, rows: 12 },
        regions: [
          { id: "header", area: area(1, 1, 12, 2), widgets: [{ widget: "logo" }] },
          { id: "hero", area: area(1, 3, 12, 10), widgets: [{ widget: "clock" }] },
        ],
      };
      const v = (await draft()).draft_version;
      const put = await api("PUT", `/api/theming/draft/layouts/pulse?draft_version=${v}`, layout);
      expect(put.status).toBe(200);
      // The header sits where the published layout put it; the hero where the zone moved it.
      const state = zoneState("Main", null, [
        region("header", area(1, 1, 12, 1), []),
        region("hero", area(5, 2, 8, 10), []),
      ]);
      const { posted } = await studio({ main: state });
      await expect.poll(() => posted("main")).toBeDefined();
      const sent = await posted("main");
      expect(sent?.state.layout).toEqual(layout);
      expect((sent?.state.theme as { layouts: unknown }).layouts).toEqual([layout]);
      const areas = Object.fromEntries(
        (sent?.state.regions ?? []).map((r: { id: string; area: unknown }) => [r.id, r.area]),
      );
      expect(areas).toEqual({ header: area(1, 1, 12, 2), hero: area(5, 2, 8, 10) });
    });

    it("draws the parts of a split box where the draft puts the box", async () => {
      // Screen splits a header and a box with the hub QR into parts `<id>`, `<id>-2` by default.
      await api("POST", "/api/theming/draft", { from: "defaults" });
      const layout = {
        id: "pulse",
        name: "Pulse, wider rail",
        aspect: "16:9",
        grid: { columns: 12, rows: 12 },
        regions: [
          { id: "header", area: area(1, 1, 12, 2), widgets: [{ widget: "logo" }] },
          { id: "hero", area: area(1, 3, 6, 9), widgets: [{ widget: "clock" }] },
          { id: "venue_rail", area: area(7, 3, 6, 10), widgets: [{ widget: "clock" }] },
          { id: "rail", area: area(1, 12, 1, 1), widgets: [{ widget: "clock" }] },
        ],
      };
      const v = (await draft()).draft_version;
      const put = await api("PUT", `/api/theming/draft/layouts/pulse?draft_version=${v}`, layout);
      expect(put.status).toBe(200);
      const state = zoneState("Main", null, [
        region("header", area(1, 1, 6, 1), [{ widget: "logo", view: view({}, true) }]),
        region("header-2", area(7, 1, 6, 1), [{ widget: "clock", view: view({}) }]),
        region("hero", area(1, 2, 8, 10), []),
        region("venue_rail", area(9, 2, 2, 10), [{ widget: "agenda_now", view: view({}) }]),
        region("venue_rail-2", area(11, 2, 2, 10), [{ widget: "qr", view: view({}) }]),
        // The draft's rail is one column: too narrow for two parts, so screen draws it whole.
        region("rail", area(1, 12, 1, 1), [{ widget: "clock", view: view({}) }]),
        region("rail-2", area(2, 12, 1, 1), [{ widget: "qr", view: view({}) }]),
      ]);
      (state.layout.regions as unknown[]).push(
        { id: "venue_rail", area: area(9, 2, 4, 10), widgets: [] },
        { id: "rail", area: area(1, 12, 2, 1), widgets: [] },
      );
      const { posted } = await studio({ main: state });
      await expect.poll(() => posted("main")).toBeDefined();
      const regions = ((await posted("main"))?.state.regions ?? []) as {
        id: string;
        area: unknown;
        widgets: { widget: string }[];
        order: number[];
      }[];
      expect(Object.fromEntries(regions.map((r) => [r.id, r.area]))).toEqual({
        header: area(1, 1, 6, 2),
        "header-2": area(7, 1, 6, 2),
        hero: area(1, 3, 6, 9),
        venue_rail: area(7, 3, 3, 10),
        "venue_rail-2": area(10, 3, 3, 10),
        rail: area(1, 12, 1, 1),
      });
      const rail = regions.find((r) => r.id === "rail");
      expect(rail?.widgets.map((w) => w.widget)).toEqual(["clock", "qr"]);
      expect(rail).toMatchObject({ order: [0, 1] });
    });

    it("shows the zone picked last, however late an earlier zone's state answers", async () => {
      await api("POST", "/api/theming/draft", { from: "defaults" });
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      const slow = async (r: Route) => {
        await held;
        await r.fulfill({ json: zoneState("Main", null, []) });
      };
      const { page, posted } = await studio(
        { main: slow, cafe: zoneState("Cafe", null, []) },
        { names: { main: "Main hall", cafe: "Café" } },
      );
      const frame = page.locator("iframe[data-screen-preview]");
      await expect.poll(() => page.locator(".canccu-studio-zones").isVisible()).toBe(true);
      await page.selectOption(".canccu-studio-zones", "cafe");
      await expect.poll(() => frame.getAttribute("src")).toBe("/screen/zones/cafe");
      await expect.poll(() => posted("cafe")).toBeDefined();
      release();
      await page.waitForTimeout(500);
      expect(await frame.getAttribute("src")).toBe("/screen/zones/cafe");
      expect(await page.textContent(".canccu-studio-zone")).toContain("Café");
      expect((await posted("cafe"))?.state.device).toMatchObject({ name: "Cafe" });
    });

    /** A draft whose CSS differs from what is published, so Publish waits for its previews. */
    async function heldDraft(): Promise<void> {
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
    }

    const surfacesShown = (page: Page) =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLIFrameElement>("iframe[data-preview]")]
          .filter((f) => !f.hasAttribute("data-screen-preview"))
          .every((f) => f.contentDocument?.querySelector(".canccu-surface") != null),
      );

    it("keeps Publish locked while the player has not drawn the draft", async () => {
      await heldDraft();
      const { page, posted } = await studio({ main: zoneState("Main", null, []) });
      const publish = page.locator('.canccu-pagehead [data-action="publish"]');
      await expect.poll(() => posted("main")).toBeDefined();
      await expect.poll(() => surfacesShown(page)).toBe(true);
      await page.waitForTimeout(1000);
      expect(await publish.isDisabled()).toBe(true);
      // A player that never answers (one that refused the state, or a pinned bundle from before
      // the answer) gives way to the Studio's sample screen, so Publish is never held for good.
      const frame = page.locator("iframe[data-screen-preview]");
      await expect
        .poll(() => frame.getAttribute("src"), { timeout: 15_000 })
        .toMatch(/^\/theming\/studio\/preview\/screen\?canccu_theme=draft/);
      await expect.poll(() => publish.isDisabled()).toBe(false);
      expect(await page.textContent(".canccu-studio-zone")).toBe("");
    });

    it("keeps Publish held after a save the previews do not show, whatever draws next", async () => {
      await heldDraft();
      const family = ((await draft()).manifest.fonts as { family: string }[])[0]?.family ?? "";
      const { page, posted } = await studio(
        { main: zoneState("Main", null, []), cafe: zoneState("Cafe", null, []) },
        { ack: true },
      );
      const publish = page.locator('.canccu-pagehead [data-action="publish"]');
      await expect.poll(() => publish.isDisabled()).toBe(false);
      // The font saves, the refused colour keeps the page: the previews still show the old version.
      const primary = page.locator('input[name="primary"]');
      await primary.fill("abc");
      await primary.blur();
      await expect.poll(() => page.isVisible(".canccu-studio-notice")).toBe(true);
      await page.selectOption('select[name="body"]', family);
      await expect.poll(() => publish.isDisabled()).toBe(true);
      // Another zone drawn and confirmed does not release it.
      await page.selectOption(".canccu-studio-zones", "cafe");
      await expect.poll(() => posted("cafe")).toBeDefined();
      await page.waitForTimeout(500);
      expect(await publish.isDisabled()).toBe(true);
      expect(await page.textContent(".canccu-studio-publish-hint")).toContain(
        "Put the colour right",
      );
    });

    it("releases Publish once the colour is put right and its save is drawn", async () => {
      await heldDraft();
      const family = ((await draft()).manifest.fonts as { family: string }[])[0]?.family ?? "";
      const { page } = await studio({ main: zoneState("Main", null, []) }, { ack: true });
      const publish = page.locator('.canccu-pagehead [data-action="publish"]');
      await expect.poll(() => publish.isDisabled()).toBe(false);
      const primary = page.locator('input[name="primary"]');
      await primary.fill("abc");
      await primary.blur();
      await page.selectOption('select[name="body"]', family);
      await expect.poll(() => publish.isDisabled()).toBe(true);
      // Put right, it saves: the page then draws that version, and the frames show it.
      await primary.fill("#ff7a45");
      await primary.blur();
      await expect
        .poll(async () => ((await draft()).manifest.brand as { primary?: string }).primary)
        .toBe("#ff7a45");
      await expect.poll(() => publish.isDisabled(), { timeout: 15_000 }).toBe(false);
    });

    it("unlocks Publish once the player confirms it drew the draft", async () => {
      await heldDraft();
      const { page } = await studio({ main: zoneState("Main", null, []) }, { ack: true });
      const publish = page.locator('.canccu-pagehead [data-action="publish"]');
      await expect.poll(() => publish.isDisabled()).toBe(false);
    });
  },
);
