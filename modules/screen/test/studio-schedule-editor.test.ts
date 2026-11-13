/**
 * The Schedule page's window editor and "what plays at…" (#267, plan #190 S3–S4, S10–S11; mockup
 * 09): the editor only for holders of `screen.content.write`, with the event's zones, playlists,
 * layouts and run-of-show items and each window as the API answers it (its revision for the 409);
 * "what plays at…" for every reader, answered by simulate region by region, with why the winner won. The harness's
 * event has no dates and runs in UTC; its clock is Thursday 2026-01-01 12:00.
 */
import { withTenant } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAgendaEvent } from "../src/content/agenda.js";
import { DATABASE_URL, SESSIONS, call, harness, pairDevice } from "./helpers.js";
import { seedAssets } from "./seed.js";
import type { Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("studio schedule editor", () => {
  let h: Harness;
  let loopWindow = "";
  let menuWindow = "";
  let eveningWindow = "";
  const item = (id: string, title: string, visibility: string, from: string, to: string) => ({
    id: `e_${id}`,
    type: "agenda.item.added",
    version: 1,
    time: "",
    source: "agenda",
    tenant: "alpha",
    data: {
      item: {
        id,
        title,
        visibility,
        starts_at: from,
        ends_at: to,
        status: "scheduled",
        revision: 1,
      },
      agenda_version: 1,
    },
  });
  beforeAll(async () => {
    SESSIONS.crewwriter = ["screen.content.read", "screen.content.write", "agenda.crew.read"];
    h = await harness();
    const admin = (method: "POST" | "GET" | "PUT", url: string, body?: unknown) =>
      call(h, method, url, { host: "alpha.test", session: "admin", body });
    await admin("GET", "/api/screen/zones");
    await admin("POST", "/api/screen/zones", { key: "cafe", name: "Café" });
    const make = async (name: string, extra: Record<string, unknown> = {}) =>
      (
        await admin("POST", "/api/screen/playlists", { name, type: "regular", items: [], ...extra })
      ).json<{ id: string }>().id;
    await seedAssets(h, { id: "im_1", kind: "image" }, { id: "im_2", kind: "image" }, { id: "im_3", kind: "image" }); // prettier-ignore
    const evening = await make("Evening", {
      items: ["im_1", "im_2", "im_3"].map((asset_id) => ({ asset_id, duration_seconds: 60 })),
    });
    const loop = await make("Welcome loop");
    const menu = await make("Menu");
    await make("Partners", { type: "break", break: { period_seconds: 3600, break_seconds: 45 } });
    await withTenant("alpha", async () => {
      await applyAgendaEvent(h.db, item("it_brief", "Crew briefing", "crew", "2026-01-01T13:00:00Z", "2026-01-01T14:00:00Z")); // prettier-ignore
      await applyAgendaEvent(h.db, item("it_dinner", "Dinner", "public", "2026-01-01T18:00:00Z", "2026-01-01T19:00:00Z")); // prettier-ignore
    });
    const window = async (body: Record<string, unknown>) =>
      (await admin("POST", "/api/screen/schedules", body)).json<{ id: string }>().id;
    loopWindow = await window({ zone_key: "main", playlist_id: loop, priority: 10, days: [4], start_minute: 540, end_minute: 1020 }); // prettier-ignore
    eveningWindow = await window({ zone_key: "main", playlist_id: evening, priority: 20, days: [4], start_minute: 900, end_minute: 960 }); // prettier-ignore
    menuWindow = await window({ zone_key: "main", playlist_id: menu, priority: 50, agenda_item_id: "it_brief" }); // prettier-ignore
    const device = (await pairDevice(h)).id;
    await admin("PUT", `/api/screen/devices/${device}/assignment`, { zone_key: "main" });
  });
  afterAll(async () => {
    Reflect.deleteProperty(SESSIONS, "crewwriter");
    await h.close();
  });

  const page = async (url: string, session: string) =>
    call(h, "GET", url, { host: "alpha.test", session });
  // Whitespace between tags and text is the templates' formatting, not the page's.
  const tight = (body: string) => body.replace(/>\s+/g, ">").replace(/\s+</g, "<");
  const editorOf = (body: string) =>
    /<dialog[^>]*id="canccu-sched-editor".*?<\/dialog>/s.exec(body)?.[0] ?? "";
  const windowsOf = (body: string) =>
    JSON.parse(
      /<script type="application\/json" id="canccu-sched-windows">(.*?)<\/script>/s.exec(
        body,
      )?.[1] ?? "null",
    ) as { schedules: { id: string; revision: number; agenda_item_id: string | null }[] } | null;

  it("gives a writer the editor: the button, the form and each window with its revision", async () => {
    const body = tight((await page("/admin/screen/schedule", "editor")).body);
    expect(body).toMatch(/data-window-new\s+type="button"/);
    expect(body).toContain("Add window");
    const editor = editorOf(body);
    // A new window starts in the zone shown.
    expect(editor).toContain('<option value="main" selected>Main</option>');
    expect(editor).toContain('<option value="cafe">Café</option>');
    expect(editor).toContain(">Welcome loop</option>");
    expect(editor).toContain(">Menu</option>");
    // A break playlist interrupts; no window plays it.
    expect(editor).not.toContain(">Partners</option>");
    expect(editor).toMatch(
      /<option value="" selected>The zone(&#39;|&#x27;|')s own layout<\/option>/,
    );
    expect(editor).toContain('<option value="pulse">Pulse</option>');
    // Run-of-show items: the public one by title; a crew item not at all without agenda.crew.read.
    expect(editor).toMatch(/<option value="it_dinner">Dinner · Thu 1 Jan 18:00<\/option>/);
    expect(editor).not.toContain("Crew briefing");
    expect(editor).toContain('name="revision"');
    expect(editor).toMatch(
      /data-confirm="[^"]+"[^>]*data-window-delete|data-window-delete[^>]*data-confirm/,
    );
    // The days as seven chips in one row, each a checkbox the form still reads.
    const chips = /<div class="canccu-studio-days">(.*?)<\/div>/s.exec(editor)?.[1] ?? "";
    const days = [...chips.matchAll(/name="days" value="(\d)"[^>]*><span\s*>(\w+)<\/span/g)];
    expect(days.map((m) => [m[1], m[2]])).toEqual([
      ["1", "Mon"], ["2", "Tue"], ["3", "Wed"], ["4", "Thu"], ["5", "Fri"], ["6", "Sat"], ["7", "Sun"],
    ]); // prettier-ignore
    // A sheet: Close in its head, then the form, then Delete apart from Cancel and Save, hidden
    // until a window is opened, as the shell's quiet danger link, never a filled red button.
    expect(editor).toMatch(/canccu-studio-sheet__head.*data-close>.*Close<\/button>/s);
    const foot = /<div class="canccu-studio-sheet__foot">(.*?)<\/div>/s.exec(editor)?.[1] ?? "";
    expect(foot).toMatch(
      /class="canccu-studio-danger-link"[^>]*data-window-delete[^>]*hidden\s*>Delete window…<\/button>.*>Cancel<\/button\s*>.*type="submit">Save<\/button>/s,
    );
    expect(editor).not.toContain("canccu-button--danger");
    // Each window as GET /api/screen/schedules answers it, so a save sends the revision read.
    const windows = windowsOf(body);
    expect(windows?.schedules.map((w) => [w.id, w.revision]).sort()).toEqual(
      [
        [loopWindow, 1],
        [menuWindow, 1],
        [eveningWindow, 1],
      ].sort(),
    );
    // A weekly block drags; a bound one moves with its item, so it only opens the editor.
    expect(body).toMatch(new RegExp(`data-window="${loopWindow}"[^>]*data-drag`));
    expect(body).toMatch(new RegExp(`data-window="${menuWindow}"`));
    expect(body).not.toMatch(new RegExp(`data-window="${menuWindow}"[^>]*data-drag`));
    expect(body).toContain("Edit window");
    expect(body).toContain('<script type="module" src="/admin/screen/static/studio-schedule.js">');
    // The script, the helpers it imports, and its words in the event's language.
    for (const name of ["studio-schedule.js", "studio-schedule-edit.js"]) {
      const file = await call(h, "GET", `/admin/screen/static/${name}`, { host: "alpha.test" });
      expect(file.statusCode).toBe(200);
      expect(file.headers["content-type"]).toContain("text/javascript");
    }
    expect(body).toContain('"window.conflict":"This window was changed by someone else.');
  });

  it("names a crew item in the picker only to crew readers; others see it as a crew item when bound", async () => {
    const crew = editorOf(tight((await page("/admin/screen/schedule", "crewwriter")).body));
    expect(crew).toMatch(/<option value="it_brief">Crew briefing · Thu 1 Jan 13:00<\/option>/);
    const plain = editorOf(tight((await page("/admin/screen/schedule", "editor")).body));
    expect(plain).toContain('<option value="it_brief" hidden>A crew item</option>');
  });

  it("keeps the editor from readers: no button, no form, no window data, no drag", async () => {
    const body = tight((await page("/admin/screen/schedule", "content")).body);
    expect(body).not.toContain("data-window-new");
    expect(editorOf(body)).toBe("");
    expect(windowsOf(body)).toBeNull();
    expect(body).not.toContain("data-drag");
    expect(body).not.toContain("Edit window");
    expect(body).not.toContain("studio-schedule.js");
  });

  describe("what plays at…", () => {
    const at = async (query: string, session = "content") =>
      tight((await page(`/admin/screen/schedule?zone=main&${query}`, session)).body);
    const card = (body: string) =>
      /<section class="canccu-card" id="canccu-sched-at">.*?<\/section>/s.exec(body)?.[0] ?? "";
    const regions = (c: string) =>
      [...(/<ul class="canccu-sched__regions">(.*?)<\/ul>/s.exec(c)?.[1] ?? "").matchAll(/<li>(.*?)<\/li>/g)].map(
        (m) => m[1],
      ); // prettier-ignore

    it("offers a day of the event and a 24 h time, with the zone shown and the time now", async () => {
      const c = card(await at(""));
      expect(c).toContain("What plays at…");
      expect(c).toContain('<form method="get" action="/admin/screen/schedule"');
      expect(c).toMatch(/<select class="canccu-input" id="canccu-sched-at-day" name="at_day">/);
      expect(c).toContain('<option value="2026-01-01" selected>Thu 1 Jan</option>');
      expect(c).toMatch(
        /name="at" value="12:00" inputmode="numeric" pattern="\(\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]"/,
      );
      // The browser's own picker would write the time its way ("01/01/2026, 12:00 PM").
      expect(c).not.toContain("datetime-local");
      expect(c).toContain('<option value="main" selected>Main</option>');
      expect(c).not.toContain("canccu-sched__regions");
    });

    it("answers region by region: the hero's playlist, the rail and the ticker, then why", async () => {
      const c = card(await at("at_day=2026-01-01&at=10:00"));
      expect(c).toContain("Thu 1 Jan 10:00 in Main");
      // Pulse, the zone's layout, has a hero, a rail and a ticker. A past time has no item.
      expect(regions(c)).toEqual([
        "Hero:<strong>Welcome loop</strong>",
        "Rail: the run of show could not be read",
        "Ticker: no line",
      ]);
      expect(c).toContain("prio 10 · every Thu 09:00–17:00");
      expect(c).toContain("No other window wants this time.");
      expect(c).toContain("Next change: Thu 1 Jan 13:00");
      expect(c).toMatch(
        /<a class="canccu-sched__virtual" href="\/screen\/zones\/main"[^>]*>See it on a virtual screen/,
      );
    });

    it("counts the hero's item from where its window begins", async () => {
      const c = card(await at("at_day=2026-01-01&at=15:02"));
      // Three one-minute items from 15:00: two minutes in, the third plays.
      expect(regions(c)[0]).toBe("Hero:<strong>Evening</strong>, item 3 of 3");
      expect(c).toContain("It wins over Welcome loop (lower priority).");
      const empty = card(await at("at_day=2026-01-01&at=13:30"));
      expect(regions(empty)[0]).toBe("Hero:<strong>Menu</strong>, which has nothing to play yet");
    });

    it("says why the winner won over each window it beat", async () => {
      const c = card(await at("at_day=2026-01-01&at=13:30"));
      expect(c).toContain("prio 50 · while a crew item runs");
      expect(c).toContain("It wins over Welcome loop (lower priority).");
      expect(c).toContain("Next change: Thu 1 Jan 14:00");
      const crew = card(await at("at_day=2026-01-01&at=13:30", "crewwriter"));
      expect(crew).toContain("prio 50 · while “Crew briefing” runs");
    });

    it("reads the rail and the ticker as the screens would then, and what a delay moved", async () => {
      const item = (id: string, title: string, from: string, to: string, extra = {}) => ({
        id, title, kind: "other", starts_at: from, ends_at: to, delay_minutes: 0, location: null,
        visibility: "public", status: "scheduled", zone: null, ...extra,
      }); // prettier-ignore
      h.sources.agendaItems = [
        item("it_lunch", "Lunch", "2026-01-01T13:00:00Z", "2026-01-01T14:00:00Z"),
        item("it_semis", "Semis", "2026-01-01T14:30:00Z", "2026-01-01T16:00:00Z"),
        item("it_other", "Elsewhere", "2026-01-01T13:00:00Z", "2026-01-01T14:30:00Z", { zone: "cafe" }), // prettier-ignore
        // The bound item ran 15 minutes over its planned end.
        item("it_brief", "Crew briefing", "2026-01-01T13:00:00Z", "2026-01-01T14:00:00Z", {
          visibility: "crew",
          planned_ends_at: "2026-01-01T13:45:00Z",
        }),
      ];
      try {
        const now = card(await at("at_day=2026-01-01&at=13:30"));
        expect(regions(now)[1]).toBe("Rail: now “Lunch”, next “Semis” at 14:30");
        expect(now).toMatch(
          /<strong>Menu<\/strong>\s*plays while a crew item runs, until 14:00, moved \+15 by the run of show\./,
        );
        const after = card(await at("at_day=2026-01-01&at=14:10"));
        expect(regions(after)[1]).toBe("Rail: nothing now, next “Semis” at 14:30");
        expect(after).toMatch(
          /<strong>Menu<\/strong>\s*ended at 14:00 with a crew item, moved \+15 by the run of show\./,
        );
        const crew = card(await at("at_day=2026-01-01&at=14:10", "crewwriter"));
        expect(crew).toContain("ended at 14:00 with “Crew briefing”, moved +15");
        // Nothing moved what plays at 10:00.
        expect(card(await at("at_day=2026-01-01&at=10:00"))).not.toContain("by the run of show");
        await call(h, "PUT", "/api/screen/ticker", {
          host: "alpha.test",
          session: "admin",
          body: { text: "Pizza orders close at 20:00", until: "2026-01-01T20:00:00Z" },
        });
        const ticker = card(await at("at_day=2026-01-01&at=13:30"));
        expect(regions(ticker)[2]).toBe(
          "Ticker: “Pizza orders close at 20:00” (Set in Studio, until 20:00)",
        );
        expect(regions(card(await at("at_day=2026-01-01&at=20:30")))[2]).toBe("Ticker: no line");
      } finally {
        h.sources.agendaItems = null;
        await call(h, "DELETE", "/api/screen/ticker", { host: "alpha.test", session: "admin" });
      }
    });

    it("says when nothing is scheduled, and when nothing changes within a day", async () => {
      const c = card(await at("at_day=2026-01-01&at=20:00"));
      expect(regions(c)[0]).toBe("Hero: nothing scheduled, so it shows its idle view");
      expect(c).toContain("Nothing changes for a day after this.");
    });

    it("asks again for a time it cannot read, rather than failing the page", async () => {
      for (const query of ["at=yesterday", "at=24:00", "at_day=soon&at=10:00"]) {
        const res = await page(`/admin/screen/schedule?zone=main&${query}`, "content");
        expect(res.statusCode).toBe(200);
        expect(card(tight(res.body))).toContain("Pick a day and a time.");
      }
    });

    it("asks about one zone, the default one, while the page shows every zone", async () => {
      const res = await page(
        "/admin/screen/schedule?zone=all&at_day=2026-01-01&at=10:00",
        "content",
      );
      const c = card(tight(res.body));
      expect(regions(c)[0]).toBe("Hero:<strong>Welcome loop</strong>");
      expect(c).toContain('<select class="canccu-input" id="canccu-sched-at-zone" name="at_zone">');
      expect(c).toContain('<option value="main" selected>Main</option>');
      // The calendar stays on every zone.
      expect(c).toContain('<input type="hidden" name="zone" value="all"');
      const cafe = await page(
        "/admin/screen/schedule?zone=all&at_zone=cafe&at_day=2026-01-01&at=10:00",
        "content",
      );
      expect(regions(card(tight(cafe.body)))[0]).toBe("Hero: nothing scheduled, so it shows its idle view"); // prettier-ignore
    });
  });
});
