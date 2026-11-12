// `GET /api/screen/schedules/calendar` (contracts/screen.md, Schedule windows; G3): the right, the
// range rules, the zone filter and a crew-only item's id withheld from callers without
// `agenda.crew.read`. The calendar's own rules are pinned in calendar.test.ts.
import { withTenant } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAgendaEvent } from "../src/content/agenda.js";
import { DATABASE_URL, SESSIONS, call, code, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

const as = (session: string) => ({ host: "alpha.test", session });
const RANGE = "from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z";

describe.skipIf(!DATABASE_URL)("schedule calendar", () => {
  let h: Harness;
  let main: string;
  let crewWindow: string;
  beforeAll(async () => {
    SESSIONS.crewlead = ["screen.content.read", "agenda.crew.read"];
    h = await harness();
    const admin = (method: "POST", url: string, body: unknown) =>
      call(h, method, url, { host: "alpha.test", session: "admin", body });
    await call(h, "GET", "/api/screen/zones", as("admin"));
    await admin("POST", "/api/screen/zones", { key: "cafe", name: "Café" });
    const playlist = await admin("POST", "/api/screen/playlists", {
      name: "Main",
      type: "regular",
      items: [],
    });
    main = playlist.json<{ id: string }>().id;
    // 2026-01-01 is a Thursday (ISO 4).
    await admin("POST", "/api/screen/schedules", {
      zone_key: "main",
      playlist_id: main,
      priority: 5,
      days: [4],
      start_minute: 540,
      end_minute: 1020,
    });
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
            starts_at: "2026-01-01T12:00:00Z",
            ends_at: "2026-01-01T13:00:00Z",
            status: "scheduled",
            revision: 1,
          },
          agenda_version: 1,
        },
      }),
    );
    const bound = await admin("POST", "/api/screen/schedules", {
      zone_key: "main",
      playlist_id: main,
      priority: 50,
      agenda_item_id: "it_brief",
    });
    crewWindow = bound.json<{ id: string }>().id;
  });
  afterAll(async () => {
    delete SESSIONS.crewlead;
    await h.close();
  });

  const calendar = (query: string, session = "content") =>
    call(h, "GET", `/api/screen/schedules/calendar?${query}`, as(session));

  it("answers every zone's windows, segments and breaks in the event's time zone", async () => {
    const res = await calendar(RANGE);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ zones: { zone_key: string; segments: unknown[] }[] }>();
    expect(body).toMatchObject({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
      time_zone: "UTC",
    });
    expect(body.zones.map((z) => z.zone_key)).toEqual(["cafe", "main"]);
    const mainZone = body.zones.find((z) => z.zone_key === "main");
    expect(mainZone?.segments).toEqual([
      expect.objectContaining({ starts_at: "2026-01-01T09:00:00.000Z", losers: [] }),
      expect.objectContaining({
        starts_at: "2026-01-01T12:00:00.000Z",
        winner: crewWindow,
        losers: [expect.objectContaining({ lost_on: "priority" })],
      }),
      expect.objectContaining({ starts_at: "2026-01-01T13:00:00.000Z" }),
    ]);
  });

  it("answers one zone with `zone`, and refuses a zone the event has not", async () => {
    const one = await calendar(`${RANGE}&zone=cafe`);
    expect(one.json<{ zones: unknown[] }>().zones).toEqual([
      { zone_key: "cafe", windows: [], segments: [], breaks: [] },
    ]);
    const res = await calendar(`${RANGE}&zone=nowhere`);
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe("unknown_zone");
  });

  it("refuses a range that is missing, backwards or longer than 31 days", async () => {
    for (const query of [
      "from=2026-01-01T00:00:00Z",
      "from=nonsense&to=2026-01-02T00:00:00Z",
      "from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z",
      "from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:01Z",
    ]) {
      const res = await calendar(query);
      expect(res.statusCode, query).toBe(400);
      expect(code(res)).toBe("invalid_request");
    }
    expect((await calendar("from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z")).statusCode).toBe(
      200,
    );
  });

  it("withholds a crew-only item's id unless the caller holds agenda.crew.read", async () => {
    const windowOf = async (session: string) =>
      (await calendar(`${RANGE}&zone=main`, session))
        .json<{ zones: { windows: { schedule_id: string }[] }[] }>()
        .zones[0]?.windows.find((w) => w.schedule_id === crewWindow);
    expect(await windowOf("content")).toMatchObject({
      agenda_item_id: null,
      agenda_item_crew: true,
    });
    expect(await windowOf("crewlead")).toMatchObject({
      agenda_item_id: "it_brief",
      agenda_item_crew: true,
    });
  });

  it("needs screen.content.read: 403 without it, 401 signed out", async () => {
    const refused = await calendar(RANGE, "crew");
    expect(refused.statusCode).toBe(403);
    const signedOut = await h.app.inject({
      method: "GET",
      url: `/api/screen/schedules/calendar?${RANGE}`,
      headers: { host: "alpha.test" },
    });
    expect(signedOut.statusCode).toBe(401);
  });
});
