/**
 * The Schedule page's window editor and "what plays at…" (#267, plan #190 S3–S4, S10–S11; mockup
 * 09): the editor only for holders of `screen.content.write`, with the event's zones, playlists,
 * layouts and run-of-show items and each window as the API answers it (its revision for the 409);
 * "what plays at…" for every reader, answered by simulate, with why the winner won. The harness's
 * event has no dates and runs in UTC; its clock is Thursday 2026-01-01 12:00.
 */
import { withTenant } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAgendaEvent } from "../src/content/agenda.js";
import { DATABASE_URL, SESSIONS, call, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("studio schedule editor", () => {
  let h: Harness;
  let loopWindow = "";
  let menuWindow = "";
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
    expect(body).toContain('data-window-new type="button"');
    expect(body).toContain("Add window");
    const editor = editorOf(body);
    expect(editor).toContain('<option value="main">Main</option>');
    expect(editor).toContain('<option value="cafe">Café</option>');
    expect(editor).toContain(">Welcome loop</option>");
    expect(editor).toContain(">Menu</option>");
    // A break playlist interrupts; no window plays it.
    expect(editor).not.toContain(">Partners</option>");
    expect(editor).toContain('<option value="">The zone\'s own layout</option>');
    expect(editor).toContain('<option value="pulse">Pulse</option>');
    // Run-of-show items: the public one by title; a crew item not at all without agenda.crew.read.
    expect(editor).toMatch(/<option value="it_dinner">Dinner · Thu 1 Jan 18:00<\/option>/);
    expect(editor).not.toContain("Crew briefing");
    expect(editor).toContain('name="revision"');
    expect(editor).toMatch(
      /data-confirm="[^"]+"[^>]*data-window-delete|data-window-delete[^>]*data-confirm/,
    );
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(editor).toContain(`>${day}</label>`);
    }
    // Each window as GET /api/screen/schedules answers it, so a save sends the revision read.
    const windows = windowsOf(body);
    expect(windows?.schedules.map((w) => [w.id, w.revision]).sort()).toEqual(
      [
        [loopWindow, 1],
        [menuWindow, 1],
      ].sort(),
    );
    // A weekly block drags; a bound one moves with its item, so it only opens the editor.
    expect(body).toMatch(new RegExp(`data-window="${loopWindow}"[^>]*data-drag`));
    expect(body).toMatch(new RegExp(`data-window="${menuWindow}"`));
    expect(body).not.toMatch(new RegExp(`data-window="${menuWindow}"[^>]*data-drag`));
    expect(body).toContain("Edit window");
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

    it("offers the question to every reader, with the zone shown and the time now", async () => {
      const c = card(await at(""));
      expect(c).toContain("What plays at…");
      expect(c).toContain('<form method="get" action="/admin/screen/schedule"');
      expect(c).toContain('name="at" type="datetime-local" value="2026-01-01T12:00"');
      expect(c).toContain('<option value="main" selected>Main</option>');
      expect(c).not.toContain("plays at Thu");
    });

    it("answers the winner and that nothing else plays then", async () => {
      const c = card(await at("at=2026-01-01T10:00"));
      expect(c).toContain("Thu 1 Jan 10:00 in Main");
      expect(c).toContain("<strong>Welcome loop</strong> plays");
      expect(c).toContain("prio 10 · every Thu 09:00–17:00");
      expect(c).toContain("No other window wants this time.");
      expect(c).toContain("Next change: Thu 1 Jan 13:00");
    });

    it("says why the winner won over each window it beat", async () => {
      const c = card(await at("at=2026-01-01T13:30"));
      expect(c).toContain("<strong>Menu</strong> plays");
      expect(c).toContain("prio 50 · while a crew item runs");
      expect(c).toContain("It wins over Welcome loop (lower priority).");
      expect(c).toContain("Next change: Thu 1 Jan 14:00");
      const crew = card(await at("at=2026-01-01T13:30", "crewwriter"));
      expect(crew).toContain("prio 50 · while “Crew briefing” runs");
    });

    it("says when nothing is scheduled, and when nothing changes within a day", async () => {
      const c = card(await at("at=2026-01-01T20:00"));
      expect(c).toContain("Nothing scheduled: the hero shows its idle view.");
      expect(c).toContain("Nothing changes for a day after this.");
    });

    it("asks again for a time it cannot read, rather than failing the page", async () => {
      const res = await page("/admin/screen/schedule?zone=main&at=yesterday", "content");
      expect(res.statusCode).toBe(200);
      expect(card(tight(res.body))).toContain("Pick a day and a time.");
    });

    it("asks about one zone, the default one, while the page shows every zone", async () => {
      const res = await page("/admin/screen/schedule?zone=all&at=2026-01-01T10:00", "content");
      const c = card(tight(res.body));
      expect(c).toContain("<strong>Welcome loop</strong> plays");
      expect(c).toContain('<select class="canccu-input" id="canccu-sched-at-zone" name="at_zone">');
      expect(c).toContain('<option value="main" selected>Main</option>');
      // The calendar stays on every zone.
      expect(c).toContain('<input type="hidden" name="zone" value="all"');
      const cafe = await page(
        "/admin/screen/schedule?zone=all&at_zone=cafe&at=2026-01-01T10:00",
        "content",
      );
      expect(card(tight(cafe.body))).toContain("Nothing scheduled: the hero shows its idle view.");
    });
  });
});
