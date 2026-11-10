// `/api/screen/schedules…` and simulate. Ported from the legacy signage
// `admin-api-schedules.test.ts` (a malformed body is refused, a window is created, a bad delete is
// refused), with the contract's revision conflicts (G4), zones and bound windows added.
import { withTenant } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAgendaEvent } from "../src/content/agenda.js";
import { DATABASE_URL, call, code, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Schedule {
  id: string;
  zone_key: string;
  playlist_id: string;
  priority: number;
  revision: number;
  changed_by: string | null;
  changed_at: string | null;
  days?: number[];
  agenda_item_id: string | null;
}

const as = (session: string, body?: unknown, host = "alpha.test") => ({ host, session, body });

describe.skipIf(!DATABASE_URL)("schedules", () => {
  let h: Harness;
  let playlist: string;
  let other: string;
  let ads: string;
  beforeAll(async () => {
    h = await harness();
    await call(h, "GET", "/api/screen/zones", as("admin"));
    await call(h, "POST", "/api/screen/zones", as("admin", { key: "cafe", name: "Café" }));
    const make = async (body: Record<string, unknown>) =>
      (await call(h, "POST", "/api/screen/playlists", as("admin", body))).json<{ id: string }>().id;
    playlist = await make({ name: "Main", type: "regular", priority: 10, items: [] });
    other = await make({ name: "Evening", type: "regular", items: [] });
    ads = await make({
      name: "Ads",
      type: "break",
      items: [],
      break: { period_seconds: 60, break_seconds: 5 },
    });
  });
  afterAll(async () => {
    await h.close();
  });

  const post = (body: unknown, session = "admin") =>
    call(h, "POST", "/api/screen/schedules", as(session, body));
  const weekly = () => ({
    zone_key: "main",
    playlist_id: playlist,
    priority: 5,
    days: [4],
    start_minute: 540,
    end_minute: 1020,
  });

  it("refuses a malformed body", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/screen/schedules",
      headers: {
        host: "alpha.test",
        "x-forwarded-for": "10.0.0.5",
        cookie: "canccu_session=admin",
        "content-type": "application/json",
      },
      payload: "{not-json",
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates a weekly window with who changed it, audited", async () => {
    const res = await post(weekly());
    expect(res.statusCode).toBe(201);
    const made = res.json<Schedule>();
    expect(made).toMatchObject({
      ...weekly(),
      layout_id: null,
      agenda_item_id: null,
      revision: 1,
      changed_by: "u_admin",
    });
    expect(made.changed_at).toBe(new Date(h.clock.now).toISOString());
    expect(h.audits.at(-1)).toMatchObject({
      action: "screen.schedule.created",
      target: { type: "schedule", id: made.id },
    });
    const list = await call(h, "GET", "/api/screen/schedules?zone=main", as("content"));
    expect(list.json<{ schedules: Schedule[] }>().schedules.map((s) => s.id)).toEqual([made.id]);
    expect((await call(h, "GET", "/api/screen/schedules?zone=cafe", as("content"))).json()).toEqual(
      { schedules: [] },
    );
  });

  it("creates a bound window without weekly fields", async () => {
    const res = await post({
      zone_key: "cafe",
      playlist_id: other,
      priority: 50,
      agenda_item_id: "it_8",
    });
    expect(res.statusCode).toBe(201);
    const made = res.json<Schedule>();
    expect(made.agenda_item_id).toBe("it_8");
    expect("days" in made).toBe(false);
  });

  it("checks the zone, the playlist and the right", async () => {
    expect(code(await post({ ...weekly(), zone_key: "stage" }))).toBe("unknown_zone");
    expect(code(await post({ ...weekly(), playlist_id: "pl_none" }))).toBe("invalid_request");
    expect(code(await post({ ...weekly(), playlist_id: ads }))).toBe("invalid_request");
    expect((await post(weekly(), "content")).statusCode).toBe(403);
  });

  it("replaces a window with the revision read, else 409", async () => {
    const made = (await post(weekly())).json<Schedule>();
    const put = (revision: unknown) =>
      call(
        h,
        "PUT",
        `/api/screen/schedules/${made.id}`,
        as("admin", { ...weekly(), priority: 9, revision }),
      );
    expect(
      code(await call(h, "PUT", `/api/screen/schedules/${made.id}`, as("admin", weekly()))),
    ).toBe("invalid_request");
    const saved = await put(1);
    expect(saved.json<Schedule>()).toMatchObject({ priority: 9, revision: 2 });
    expect(h.audits.at(-1)).toMatchObject({
      action: "screen.schedule.changed",
      changes: { priority: { from: 5, to: 9 } },
    });
    expect(code(await put(1))).toBe("version_conflict");
    expect(
      (
        await call(
          h,
          "PUT",
          "/api/screen/schedules/sc_none",
          as("admin", { ...weekly(), revision: 1 }),
        )
      ).statusCode,
    ).toBe(404);
  });

  it("deletes a window, refusing a stale revision", async () => {
    const made = (await post(weekly())).json<Schedule>();
    expect(
      code(await call(h, "DELETE", `/api/screen/schedules/${made.id}?revision=7`, as("admin"))),
    ).toBe("version_conflict");
    expect(
      code(await call(h, "DELETE", `/api/screen/schedules/${made.id}?revision=x`, as("admin"))),
    ).toBe("invalid_request");
    expect(
      (await call(h, "DELETE", `/api/screen/schedules/${made.id}?revision=1`, as("admin")))
        .statusCode,
    ).toBe(204);
    expect(h.audits.at(-1)).toMatchObject({ action: "screen.schedule.deleted" });
    expect(
      (await call(h, "DELETE", `/api/screen/schedules/${made.id}`, as("admin"))).statusCode,
    ).toBe(404);
  });

  it("keeps a zone that windows name", async () => {
    expect(code(await call(h, "DELETE", "/api/screen/zones/cafe", as("admin")))).toBe(
      "zone_in_use",
    );
  });

  describe("simulate", () => {
    const simulate = (query: string) =>
      call(h, "GET", `/api/screen/schedules/simulate?${query}`, as("content"));

    it("answers the winning window and when it changes", async () => {
      // 2026-01-01 is a Thursday (ISO day 4); the windows above run 09:00–17:00 there.
      const res = await simulate("zone=main&at=2026-01-01T12:00:00Z");
      expect(res.statusCode).toBe(200);
      const sim = res.json<Record<string, unknown>>();
      expect(sim).toMatchObject({
        zone_key: "main",
        playlist_id: playlist,
        layout_id: "pulse",
        in_break: false,
      });
      expect(sim.next_change_at).toBe("2026-01-01T17:00:00.000Z");
      const night = await simulate("zone=main&at=2026-01-01T20:00:00Z");
      expect(night.json()).toMatchObject({ schedule_id: null, playlist_id: null });
    });

    it("follows a bound window's item, delays included", async () => {
      const item = {
        id: "it_8",
        starts_at: "2026-01-01T18:00:00Z",
        ends_at: "2026-01-01T19:00:00Z",
        status: "scheduled",
        revision: 1,
      };
      await withTenant("alpha", () =>
        applyAgendaEvent(h.db, {
          id: "e1",
          type: "agenda.item.added",
          version: 1,
          time: "",
          source: "agenda",
          tenant: "alpha",
          data: { item, agenda_version: 1 },
        }),
      );
      const res = await simulate("zone=cafe&at=2026-01-01T18:30:00Z");
      expect(res.json()).toMatchObject({
        playlist_id: other,
        next_change_at: "2026-01-01T19:00:00.000Z",
      });
    });

    it("refuses an unknown zone or time", async () => {
      expect(code(await simulate("zone=stage&at=2026-01-01T12:00:00Z"))).toBe("unknown_zone");
      expect(code(await simulate("zone=main&at=noon"))).toBe("invalid_request");
      expect(
        (
          await call(
            h,
            "GET",
            "/api/screen/schedules/simulate?zone=main&at=2026-01-01T12:00:00Z",
            as("crew"),
          )
        ).statusCode,
      ).toBe(403);
    });
  });
});
