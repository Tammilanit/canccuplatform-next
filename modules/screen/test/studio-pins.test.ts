/**
 * The Pins page and the frozen banner (#265; plan #190 S9–S11): what is in effect and pinned, who
 * pinned it and until when, "Freeze for the event" and Unfreeze only for `screen.bundle.write`,
 * and, while frozen, one plain banner on every Studio page.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ThemeNow } from "../src/compose/sources.js";
import { DATABASE_URL, SESSIONS, call, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

const NOON = Date.parse("2026-01-01T12:00:00Z");
const ENDS = "2026-01-04T16:00:00.000Z";

const theme = (revision: number): ThemeNow => ({
  revision,
  tokens_css_url: `/theming/r/${revision}/tokens.css`,
  css_url: null,
  logo_url: null,
  layouts: [],
  templates: [],
});

describe.skipIf(!DATABASE_URL)("studio pins", () => {
  let h: Harness;
  const page = (url: string, session: string) =>
    call(h, "GET", url, { host: "alpha.test", session });
  const put = (body: unknown) =>
    call(h, "PUT", "/api/screen/pin", { host: "alpha.test", session: "admin", body });

  beforeAll(async () => {
    SESSIONS.zoner = ["screen.zones.write"];
    h = await harness();
    h.sources.theme = theme(5);
    h.sources.revisions = { 5: theme(5) };
  });
  afterAll(async () => {
    Reflect.deleteProperty(SESSIONS, "zoner");
    await h.close();
  });
  beforeEach(async () => {
    h.clock.now = NOON;
    h.publicEvents["alpha.test"] = {
      id: "alpha",
      name: "Demo Party",
      status: "live",
      ends_at: ENDS,
    };
    await put({ bundle_version: null, theme_revision: null });
  });

  it("shows what is in effect and pinned, to every Studio reader, under its own tab", async () => {
    for (const session of ["crew", "content", "bundler"]) {
      const res = await page("/admin/screen/pins", session);
      expect(res.statusCode, session).toBe(200);
      expect(res.body).toContain("Bundle test");
      expect(res.body).toContain("Theme revision 5");
      expect(res.body).toContain("Follows the platform version");
      expect(res.body).toContain("Follows the published theme");
      expect(res.body).toMatch(/<nav class="canccu-tabs"[^>]*>.*>Pins<.*<\/nav>/s);
    }
    for (const session of ["nobody", "ticker", "zoner"]) {
      expect((await page("/admin/screen/pins", session)).statusCode, session).toBe(403);
    }
    expect((await page("/admin/screen/", "bundler")).headers.location).toBe("/admin/screen/pins");
  });

  it("offers Freeze for the event, until its end, only to screen.bundle.write", async () => {
    const admin = (await page("/admin/screen/pins", "admin")).body;
    expect(admin).toContain("Freeze for the event");
    expect(admin).toContain(
      `data-body="${JSON.stringify({ freeze: true, until: ENDS }).replace(/"/g, "&quot;")}"`,
    );
    expect(admin).toContain('data-url="/api/screen/pin"');
    expect(admin).toContain("data-confirm=");
    const crew = (await page("/admin/screen/pins", "crew")).body;
    expect(crew).not.toContain("Freeze for the event");
    expect(crew).toContain("Only someone who may pin bundles can freeze the screens.");
  });

  it("asks for the end when the event has none", async () => {
    h.publicEvents["alpha.test"] = { id: "alpha", status: "live", ends_at: null };
    const body = (await page("/admin/screen/pins", "admin")).body;
    expect(body).toContain("data-freeze");
    expect(body).toContain('type="datetime-local"');
    expect(body).toContain("The event has no end time. Freeze until:");
  });

  it("shows a plain banner on every Studio page while frozen, and Unfreeze on Pins", async () => {
    for (const url of ["live", "devices", "zones", "ticker", "pins"]) {
      expect((await page(`/admin/screen/${url}`, "admin")).body).not.toContain(
        "canccu-studio-frozen",
      );
    }
    expect((await put({ freeze: true, until: ENDS })).statusCode).toBe(200);
    const banner =
      "Screens are frozen on bundle test and theme revision 5 until Sun 4 Jan 16:00, by admin.";
    for (const url of ["live", "devices", "zones", "ticker", "pins"]) {
      const body = (await page(`/admin/screen/${url}`, "admin")).body;
      expect(body, url).toContain("canccu-studio-frozen");
      expect(body, url).toContain(banner);
    }
    // The banner says what GET /api/screen/pin says: never to someone without its read rights.
    expect((await page("/admin/screen/zones", "zoner")).body).not.toContain("canccu-studio-frozen");
    const pins = (await page("/admin/screen/pins", "admin")).body;
    expect(pins).toContain("Unfreeze");
    expect(pins).toContain(
      `data-body="${JSON.stringify({ freeze: false }).replace(/"/g, "&quot;")}"`,
    );
    expect(pins).toContain("Pinned by admin");
    expect(pins).not.toContain("Freeze for the event");
    expect((await page("/admin/screen/pins", "crew")).body).not.toContain("Unfreeze");
  });

  it("says only the bundle is frozen while no theme revision is published", async () => {
    h.sources.theme = theme(0);
    await put({ freeze: true, until: ENDS });
    const body = (await page("/admin/screen/live", "admin")).body;
    expect(body).toContain("Screens are frozen on bundle test until Sun 4 Jan 16:00, by admin.");
    // A publish after the freeze moves the theme: the banner still names only the bundle.
    h.sources.theme = theme(1);
    const later = (await page("/admin/screen/live", "admin")).body;
    expect(later).toContain("Screens are frozen on bundle test until Sun 4 Jan 16:00, by admin.");
    expect(later).toContain("The theme still changes when one is published.");
    expect(later).not.toContain("theme revision 1");
    h.sources.theme = theme(5);
  });

  it("says only the theme is frozen when the pin leaves the bundle to the platform", async () => {
    await put({ bundle_version: null, theme_revision: 5, until: ENDS });
    const body = (await page("/admin/screen/live", "admin")).body;
    expect(body).toContain(
      "Screens are frozen on theme revision 5 until Sun 4 Jan 16:00, by admin. The bundle follows the platform.",
    );
  });
});
