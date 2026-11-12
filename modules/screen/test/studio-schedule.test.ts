/**
 * The Studio's schedule page (#190, plan S2–S3, S10–S11): its right and tab, the calendar drawn
 * from the calendar answer, a crew item's title only for crew readers, the zone filter, the week
 * paging and the block places under the page's nonce. The harness's event has no dates, so the
 * page shows the week from today (2026-01-01, a Thursday).
 */
import { withTenant } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAgendaEvent } from "../src/content/agenda.js";
import { DATABASE_URL, SESSIONS, call, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("studio schedule page", () => {
  let h: Harness;
  beforeAll(async () => {
    SESSIONS.crewlead = ["screen.content.read", "agenda.crew.read"];
    h = await harness();
    const admin = (method: "POST" | "GET", url: string, body?: unknown) =>
      call(h, method, url, { host: "alpha.test", session: "admin", body });
    await admin("GET", "/api/screen/zones");
    await admin("POST", "/api/screen/zones", { key: "cafe", name: "Café" });
    const make = async (name: string, extra: Record<string, unknown> = {}) =>
      (
        await admin("POST", "/api/screen/playlists", { name, type: "regular", items: [], ...extra })
      ).json<{ id: string }>().id;
    const loop = await make("Welcome loop");
    const menu = await make("Menu");
    await make("Partners", {
      type: "break",
      break: { period_seconds: 3600, break_seconds: 45, window_start_minute: 720, window_end_minute: 1320 },
    }); // prettier-ignore
    const window = (body: Record<string, unknown>) => admin("POST", "/api/screen/schedules", body);
    await window({ zone_key: "main", playlist_id: loop, priority: 10, days: [4], start_minute: 540, end_minute: 1020 }); // prettier-ignore
    await withTenant("alpha", () =>
      applyAgendaEvent(h.db, {
        id: "e_brief",
        type: "agenda.item.added",
        version: 1,
        time: "",
        source: "agenda",
        tenant: "alpha",
        data: {
          item: {
            id: "it_brief",
            title: "Crew briefing",
            visibility: "crew",
            starts_at: "2026-01-01T13:00:00Z",
            ends_at: "2026-01-01T14:00:00Z",
            status: "scheduled",
            revision: 1,
          },
          agenda_version: 1,
        },
      }),
    );
    await window({ zone_key: "main", playlist_id: menu, priority: 50, agenda_item_id: "it_brief" });
  });
  afterAll(async () => {
    Reflect.deleteProperty(SESSIONS, "crewlead");
    await h.close();
  });

  const page = (url: string, session?: string) =>
    call(h, "GET", url, { host: "alpha.test", ...(session ? { session } : {}) });

  it("needs screen.content.read: signed out goes to sign in, without the right it is refused", async () => {
    const out = await page("/admin/screen/schedule");
    expect(out.statusCode).toBe(303);
    expect(out.headers.location).toBe("/admin/sign-in?next=%2Fadmin%2Fscreen%2Fschedule");
    const refused = await page("/admin/screen/schedule", "crew");
    expect(refused.statusCode).toBe(403);
    expect(refused.body).not.toContain("screen.content.read");
    expect((await page("/admin/screen/schedule", "ticker")).statusCode).toBe(403);
  });

  it("shows the Schedule tab only to holders of screen.content.read, and opens on it for them", async () => {
    const tabs = (body: string) =>
      [...body.matchAll(/<nav class="canccu-tabs"[^>]*>(.*?)<\/nav>/g)][0]?.[1] ?? "";
    expect(tabs((await page("/admin/screen/live", "admin")).body)).toContain(">Schedule<");
    expect(tabs((await page("/admin/screen/live", "crew")).body)).not.toContain(">Schedule<");
    expect((await page("/admin/screen/", "content")).headers.location).toBe(
      "/admin/screen/schedule",
    );
  });

  it("draws the week from the calendar: winner on top, the loser greyed, breaks and the now line", async () => {
    const res = await page("/admin/screen/schedule", "content");
    expect(res.statusCode).toBe(200);
    // Whitespace between tags and text is the templates' formatting, not the page's.
    const body = res.body.replace(/>\s+/g, ">").replace(/\s+</g, "<");
    expect(body).toContain("Thu 1 Jan");
    expect(body).toContain("Wed 7 Jan");
    expect(body).not.toContain("Thu 8 Jan");
    expect(body).toContain('<p class="canccu-sched__name">Welcome loop</p>');
    expect(body).toContain('<p class="canccu-sched__name">Menu</p>');
    expect(body).toContain('<p class="canccu-sched__loser">Welcome loop · lower priority</p>');
    expect(body).toContain("13:00–14:00: Welcome loop loses to Menu (lower priority)");
    expect(body).toContain("Partners · every 60 min · 45 s · 12:00–22:00");
    expect(body).toContain('class="canccu-sched__now"');
    expect(body).toContain("Welcome loop plays until 13:00");
    expect(body).toContain("Next: Menu at 13:00");
    // Two zones: one lane each, named.
    expect(body).toContain('<p class="canccu-sched__lane-name">Café</p>');
    // Every string is a message: no key reaches the page.
    expect(body).not.toMatch(/>[^<]*\bschedule\.[a-z_.]+/);
  });

  it("places blocks in a style block under the page's nonce, never in inline styles", async () => {
    const res = await page("/admin/screen/schedule", "content");
    const nonce = /'nonce-([^']+)'/.exec(String(res.headers["content-security-policy"]))?.[1];
    expect(nonce).toBeDefined();
    const quoted = (nonce ?? "").replace(/[+/=]/g, (ch) => `\\${ch}`);
    const style =
      new RegExp(`<style nonce="${quoted}">([^<]*)</style>`).exec(res.body)?.[1]?.trim() ?? "";
    expect(style).toMatch(/^(#canccu-sched-\d+\{top:[\d.]+%(;height:[\d.]+%)?\})+$/);
    // 09:00 is 37.5 % of the day.
    expect(style).toContain("{top:37.5000%;height:");
    expect(res.body).not.toMatch(/ style="/);
    expect(res.body).toContain('href="/admin/screen/static/studio-schedule.css"');
    expect(res.body).not.toContain("studio-schedule.js");
    const css = await call(h, "GET", "/admin/screen/static/studio-schedule.css", {
      host: "alpha.test",
    });
    expect(css.statusCode).toBe(200);
  });

  it("names a crew item only to crew readers", async () => {
    const content = (await page("/admin/screen/schedule", "content")).body;
    expect(content).toContain("while a crew item runs");
    expect(content).not.toContain("Crew briefing");
    const crew = (await page("/admin/screen/schedule", "crewlead")).body;
    expect(crew).toContain("while “Crew briefing” runs");
  });

  it("filters to one zone, and shows every zone for a zone the event has not", async () => {
    const cafe = (await page("/admin/screen/schedule?zone=cafe", "content")).body;
    expect(cafe).toMatch(
      /<a class="canccu-button canccu-button--primary" href="\/admin\/screen\/schedule\?zone=cafe&amp;from=2026-01-01" aria-current="page">Café<\/a>/,
    );
    expect(cafe).not.toContain("Welcome loop");
    expect(cafe).toContain("Nothing scheduled on these days");
    const unknown = await page("/admin/screen/schedule?zone=nowhere", "content");
    expect(unknown.statusCode).toBe(200);
    expect(unknown.body).toContain("Welcome loop");
  });
});
