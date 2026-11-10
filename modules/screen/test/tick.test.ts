// The tick runner on Postgres: what each zone plays and its bookmarks are stored by the tick
// alone, one container per zone and second, and pushes expire by themselves.
import { tenantKey, withTenant } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readAssets } from "../src/assets/reader.js";
import { tickRunner } from "../src/tick/run.js";
import type { ZoneState } from "../src/tick/zone.js";
import { DATABASE_URL, TENANTS, call, events, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { seedAssets } from "./seed.js";

const as = (session: string, body?: unknown, host = "alpha.test") => ({ host, session, body });
const items = (...assets: string[]) =>
  assets.map((asset_id) => ({ asset_id, duration_seconds: 10 }));

describe.skipIf(!DATABASE_URL)("tick", () => {
  let h: Harness;
  let tick: () => Promise<void>;
  let day: string;
  let evening: string;
  const archived = new Set<string>();
  beforeAll(async () => {
    h = await harness();
    await pairDevice(h);
    await seedAssets(
      h,
      ...["as_1", "as_2", "as_3", "as_4"].map((id) => ({ id, kind: "image" as const })),
      { id: "as_9", kind: "image", tenant: "beta" },
    );
    await call(h, "GET", "/api/screen/zones", as("admin"));
    const make = async (body: Record<string, unknown>) =>
      (await call(h, "POST", "/api/screen/playlists", as("admin", body))).json<{ id: string }>().id;
    day = await make({ name: "Day", type: "regular", items: items("as_1", "as_2", "as_3") });
    evening = await make({ name: "Evening", type: "regular", items: items("as_4") });
    // 2026-01-01, the harness's day, is a Thursday (ISO 4); the event's time zone is UTC.
    await call(
      h,
      "POST",
      "/api/screen/schedules",
      as("admin", {
        zone_key: "main",
        playlist_id: day,
        priority: 1,
        days: [4],
        start_minute: 0,
        end_minute: 1440,
      }),
    );
    tick = tickRunner({
      db: h.db,
      kv: h.kv,
      bus: h.bus,
      audit: (entry) => {
        h.audits.push(entry);
        return Promise.resolve();
      },
      settings: { ensure: () => Promise.resolve(), get: (_key, fallback) => fallback },
      assets: readAssets,
      tenantById: (id) => {
        const ctx = Object.values(TENANTS).find((t) => t.tenant_id === id);
        if (ctx === undefined) return Promise.resolve(null);
        return Promise.resolve(archived.has(id) ? { ...ctx, status: "archived" as const } : ctx);
      },
      now: () => h.clock.now,
    });
  });
  afterAll(async () => {
    await h.close();
  });

  const state = async (tenant = "alpha", zone = "main") =>
    (
      await h.pool.query<{ state: ZoneState; updated_at: Date }>(
        "SELECT state, updated_at FROM screen_zone_playback WHERE tenant_id = $1 AND zone_key = $2",
        [tenant, zone],
      )
    ).rows[0];

  it("stores what the window plays, and its bookmark running from now", async () => {
    const start = h.clock.now;
    await tick();
    const row = await state();
    expect(row?.state.playing).toMatchObject({ source: "schedule", playlistId: day, since: start });
    expect(row?.state.bookmarks[day]).toMatchObject({ runningSince: start, offsetMs: 0 });
  });

  it("writes nothing when nothing changed", async () => {
    const before = await state();
    h.clock.now += 5000;
    await tick();
    expect((await state())?.updated_at).toEqual(before?.updated_at);
  });

  it("a push takes over at the next second, and the window's playlist keeps its place", async () => {
    h.clock.now += 10_000; // 15 s into the day playlist: its second item, 5 s in.
    const until = new Date(h.clock.now + 60_000).toISOString();
    const res = await call(
      h,
      "POST",
      "/api/screen/push",
      as("admin", { zones: ["main"], playlist_id: evening, until }),
    );
    const pushId = res.json<{ id: string }>().id;
    await tick();
    // The zone's step for this second was taken already: nothing more until the next one.
    await tick();
    let row = await state();
    expect(row?.state.playing).toMatchObject({ source: "push", pushId, playlistId: evening });
    const read = await call(h, "GET", `/api/screen/playlists/${day}`, as("admin"));
    const second = read.json<{ items: { id: string }[] }>().items[1]?.id;
    expect(row?.state.bookmarks[day]).toEqual({
      itemId: second,
      slideNumber: null,
      offsetMs: 5000,
      runningSince: null,
    });

    // Past `until` the tick ends the push as expired, with no actor, and the window plays on.
    h.clock.now += 61_000;
    await tick();
    expect(events(h, "screen.content.cleared").at(-1)).toEqual({
      push_id: pushId,
      reason: "expired",
      actor_user_id: null,
    });
    expect(h.audits.at(-1)).toMatchObject({
      action: "screen.content.cleared",
      actor_user_id: null,
      target: { id: pushId },
    });
    row = await state();
    expect(row?.state.playing).toMatchObject({ source: "schedule", playlistId: day });
    expect(row?.state.bookmarks[day]).toMatchObject({ offsetMs: 5000, runningSince: h.clock.now });
  });

  it("never writes a step older than the stored one", async () => {
    const before = await state();
    const until = new Date(h.clock.now + 60_000).toISOString();
    await call(
      h,
      "POST",
      "/api/screen/push",
      as("admin", { zones: ["main"], playlist_id: evening, until }),
    );
    // A slow container whose clock reads earlier than the last write, with the claim free.
    h.clock.now -= 5000;
    await withTenant("alpha", () => h.kv.del(tenantKey("screen", "tick", "main")));
    await tick();
    expect((await state())?.state).toEqual(before?.state);
    h.clock.now += 6000;
    await tick();
    expect((await state())?.state.playing).toMatchObject({ source: "push", playlistId: evening });
  });

  it("ticks only events with screens, and none while archived", async () => {
    const beta = (body: Record<string, unknown>) => as("admin", body, "beta.test");
    await call(h, "GET", "/api/screen/zones", as("admin", undefined, "beta.test"));
    const made = await call(
      h,
      "POST",
      "/api/screen/playlists",
      beta({ name: "B", type: "regular", items: items("as_9") }),
    );
    const playlist = made.json<{ id: string }>().id;
    const window = {
      zone_key: "main",
      playlist_id: playlist,
      priority: 1,
      days: [4],
      start_minute: 0,
      end_minute: 1440,
    };
    await call(h, "POST", "/api/screen/schedules", beta(window));
    h.clock.now += 1000;
    await tick();
    expect(await state("beta")).toBeUndefined();

    await h.pool.query(
      "INSERT INTO devices (id, name, current_tenant_id) VALUES ('dv_beta', 'B', 'beta')",
    );
    archived.add("beta");
    h.clock.now += 1000;
    await tick();
    expect(await state("beta")).toBeUndefined();

    // The event's context is read again a minute later, live once more.
    archived.delete("beta");
    h.clock.now += 61_000;
    await tick();
    expect((await state("beta"))?.state.playing).toMatchObject({ playlistId: playlist });
  });
});
