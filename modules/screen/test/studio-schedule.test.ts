/**
 * The Studio's schedule page (#190, plan S2–S3, S10–S11; mockup 09): its right and tab, the
 * calendar drawn from the calendar answer on the hours that matter, a crew item's title only for
 * crew readers, one zone first and the zone picker, the phone's day switch and the places under
 * the page's nonce. The harness's event has no dates, so the page shows the week from today
 * (2026-01-01, a Thursday, 12:00 UTC).
 */
import { withTenant } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAgendaEvent } from "../src/content/agenda.js";
import { DATABASE_URL, SESSIONS, call, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("studio schedule page", () => {
  let h: Harness;
  let device = "";
  const assign = async (zone: string) => {
    const res = await call(h, "PUT", `/api/screen/devices/${device}/assignment`, {
      host: "alpha.test",
      session: "admin",
      body: { zone_key: zone },
    });
    expect(res.statusCode).toBe(200);
  };
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
    // A screen in the main zone: the page opens on it, though Café comes first in the zone list.
    device = (await pairDevice(h)).id;
    await assign("main");
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

  // Whitespace between tags and text is the templates' formatting, not the page's.
  const tight = (body: string) => body.replace(/>\s+/g, ">").replace(/\s+</g, "<");
  const count = (body: string, needle: string) => body.split(needle).length - 1;

  it("draws one zone's week: a block per window, where it loses, the breaks, the key and now", async () => {
    const res = await page("/admin/screen/schedule", "content");
    expect(res.statusCode).toBe(200);
    const body = tight(res.body);
    expect(body).toContain("Thu 1 Jan");
    expect(body).toContain("Wed 7 Jan");
    expect(body).not.toContain("Thu 8 Jan");
    // The first zone with a screen opens; "All zones" stays a choice.
    expect(body).toMatch(/aria-current="page">Main[^<]*<\/a>/);
    expect(body).toContain(
      'href="/admin/screen/schedule?zone=all&amp;from=2026-01-01">All zones</a>',
    );
    expect(body).not.toContain("canccu-sched__lane-names");
    // One line per block, a second when there is room, the rest in its popover.
    expect(body).toContain(
      '<strong>Welcome loop</strong><span class="canccu-sched__time">09:00–17:00</span>',
    );
    expect(body).toContain('<span class="canccu-sched__line canccu-sched__more">prio 10</span>');
    expect(body).toContain("<strong>Menu</strong>");
    expect(body).toMatch(
      /<span id="canccu-sched-\d+" class="canccu-sched__lose">loses to Menu<\/span>/,
    );
    expect(body).toMatch(/popovertarget="canccu-sched-\d+-about"/);
    expect(body).toMatch(/<div id="canccu-sched-\d+-about" class="canccu-sched__about" popover>/);
    expect(body).toContain("<li>13:00–14:00: loses to Menu (lower priority)</li>");
    // The key above the grid.
    expect(body).toContain("Window, plays");
    expect(body).toContain("Window, loses to another");
    expect(body).toContain("Breaks may interrupt");
    // The hours that matter: an hour before the first window (09:00) to the breaks' end (22:00).
    expect(body).toContain('<div aria-hidden="true"><span>08:00</span>');
    expect(body).toContain("<span>21:00</span></div>");
    expect(body).not.toContain("<span>22:00</span>");
    // One now line and one badge, in the gutter.
    expect(count(body, 'class="canccu-sched__now"')).toBe(1);
    expect(body).toMatch(
      /<span id="canccu-sched-\d+" class="canccu-sched__now-badge">now 12:00<\/span>/,
    );
    // The side panel.
    expect(body).toContain("13:00–14:00: Welcome loop loses to Menu (lower priority)");
    expect(body).toContain("Partners · every 60 min · 45 s · 12:00–22:00");
    expect(body).toContain("Welcome loop plays until 13:00");
    expect(body).toContain("Next: Menu at 13:00");
    // Every string is a message: no key reaches the page.
    expect(body).not.toMatch(/>[^<]*\bschedule\.[a-z_.]+/);
  });

  it("shows every zone on request: lane names in the day's header, still one now line", async () => {
    const body = tight((await page("/admin/screen/schedule?zone=all", "content")).body);
    const names = /<p class="canccu-sched__lane-names">(.*?)<\/p>/.exec(body)?.[1] ?? "";
    expect(names).toContain("<span>Café</span>");
    expect(names).toMatch(/<span>Main[^<]*<\/span>/);
    expect(body).toContain("canccu-sched__grid canccu-sched__grid--lanes");
    expect(count(body, 'class="canccu-sched__now"')).toBe(1);
    expect(count(body, "canccu-sched__now-badge")).toBe(1);
  });

  it("gives a phone one day at a time: today, or the day picked in the day switch", async () => {
    const today = tight((await page("/admin/screen/schedule", "content")).body);
    expect(today).toContain('<nav class="canccu-cluster canccu-sched__switch" aria-label="Day">');
    expect(today).toContain(
      '<a class="canccu-button canccu-button--primary" href="/admin/screen/schedule?zone=main&amp;from=2026-01-01&amp;day=2026-01-01" aria-current="page">Thu 1 Jan</a>',
    );
    expect(today.match(/<section id="canccu-sched-\d+" class="canccu-sched__day">/g)).toHaveLength(
      1,
    );
    expect(today.match(/class="canccu-sched__day canccu-sched__day--off"/g)).toHaveLength(6);
    const saturday = tight(
      (await page("/admin/screen/schedule?zone=main&from=2026-01-01&day=2026-01-03", "content"))
        .body,
    );
    expect(saturday).toMatch(/aria-current="page">Sat 3 Jan<\/a>/);
    // The now badge belongs to Thursday, which the phone does not show.
    expect(saturday).toContain("canccu-sched__now-badge canccu-sched__now-badge--off");
  });

  it("places everything in a style block under the page's nonce, never in inline styles", async () => {
    const res = await page("/admin/screen/schedule", "content");
    const nonce = /'nonce-([^']+)'/.exec(String(res.headers["content-security-policy"]))?.[1];
    expect(nonce).toBeDefined();
    const quoted = (nonce ?? "").replace(/[+/=]/g, (ch) => `\\${ch}`);
    const style =
      new RegExp(`<style nonce="${quoted}">([^<]*)</style>`).exec(res.body)?.[1]?.trim() ?? "";
    expect(style).toMatch(
      /^#canccu-sched-0\{--canccu-sched-hours:14\}(#canccu-sched-\d+\{(top:[\d.-]+%(;height:[\d.]+%)?(;left:[\d.]+%;width:[\d.]+%)?|--canccu-sched-across:\d+)\})+$/,
    );
    // 09:00 is an hour into the axis of 14 (08:00–22:00); Welcome loop and Menu share the width.
    expect(style).toContain(`{top:${((60 / 840) * 100).toFixed(4)}%;height:`);
    expect(style).toContain(";left:0.0000%;width:50.0000%}");
    expect(style).toContain(";left:50.0000%;width:50.0000%}");
    // Thursday makes room for its two windows side by side; the other days for one.
    expect(style.match(/--canccu-sched-across:2\}/g)).toHaveLength(1);
    expect(style.match(/--canccu-sched-across:1\}/g)).toHaveLength(6);
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

  it("picks one zone, and opens the default zone for a zone the event has not", async () => {
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

  it("opens on the first zone that has screens", async () => {
    await assign("cafe");
    const body = (await page("/admin/screen/schedule", "content")).body;
    expect(body).toMatch(/aria-current="page">Café<\/a>/);
    expect(body).not.toContain("Welcome loop");
  });
});
