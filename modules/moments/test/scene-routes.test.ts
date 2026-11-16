/**
 * Scenes on a real Postgres (contracts/moments.md, Scenes): copied on first use (O7), a
 * `moments.scene.changed` per zone only when it changes, the crew button (U11, E7), the API with
 * its revision, reset and audit, the facts the conditions read, a restart, and clone (D22).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import type { Event, SqlClient } from "@canccu/kit";
import { handleTenantEvent } from "../src/consumer.js";
import { PRESETS } from "../src/scenes.js";
import { evaluateScenes, loadScenes } from "../src/scene-store.js";
import { lockSettings } from "../src/store.js";
import { SceneTicker, tickAll } from "../src/tick.js";
import { DATABASE_URL, freshDatabase } from "./helpers.js";
import { appWorld, errorOf, json } from "./app.js";
import type { AppWorld } from "./app.js";
import { event } from "./fixtures.js";

const run = DATABASE_URL ? describe : describe.skip;

const item = (id: string, kind: string, starts: string, ends: string | null) => ({
  id,
  kind,
  zone: null,
  visibility: "public",
  status: "scheduled",
  starts_at: starts,
  ends_at: ends,
});

run("scenes", () => {
  let pool: pg.Pool | undefined;
  let w: AppWorld;
  let agenda: { agenda_version: number; items: ReturnType<typeof item>[] };
  beforeEach(async () => {
    if (pool !== undefined) {
      await w.app.close();
      await pool.end();
    }
    pool = await freshDatabase();
    agenda = { agenda_version: 1, items: [] };
    w = await appWorld(pool, { agenda: () => Promise.resolve(agenda) });
    await w.tx("demo", (c) =>
      c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main'), ('stage')`),
    );
  });
  afterAll(async () => {
    await w.app.close();
    await pool?.end();
  });

  const consumer = () => ({
    db: w.db,
    engine: w.engine,
    flush: () => w.outbox.flush(),
    now: () => w.now,
    agenda: () => Promise.resolve(agenda),
  });
  const evaluate = () =>
    w.tx("demo", (c) => evaluateScenes(c, w.engine.outbox, { timeZone: "UTC", now: w.now }));
  const scenes = (tenant = "demo"): Event[] =>
    w.events(tenant).filter((e) => e.type === "moments.scene.changed");
  const last = (zone: string): Event | undefined =>
    scenes()
      .filter((e) => e.data.zone_key === zone)
      .at(-1);

  it("copies the presets on first use and tells each zone its scene once", async () => {
    expect(json(await w.call("reader", "GET", "/api/moments/scenes"))).toMatchObject({
      revision: 0,
      copied: false,
    });
    await evaluate();
    expect(
      scenes()
        .map((e) => e.data.zone_key)
        .sort(),
    ).toEqual(["main", "stage"]);
    expect(last("main")?.data).toMatchObject({
      zone_key: "main",
      scene: { key: "daytime", stage_mood: "build_up" },
      heartbeat_bpm: 8,
      why: "always",
      since: w.now.toISOString(),
    });
    await evaluate();
    expect(scenes()).toHaveLength(2);
    expect(json(await w.call("reader", "GET", "/api/moments/scenes"))).toMatchObject({
      revision: 0,
      copied: true,
      zones: [
        { zone_key: "main", scene_key: "daytime" },
        { zone_key: "stage", scene_key: "daytime" },
      ],
    });
    // A later platform version never changes an event's copy (O7).
    const stored = await w.tx("demo", (c) => loadScenes(c));
    expect(stored.scenes).toEqual(PRESETS);
  });

  it("follows the agenda, check-ins, presence and surges as they arrive", async () => {
    await evaluate();
    agenda = {
      agenda_version: 2,
      items: [item("ai_1", "doors", "2026-01-01T17:30:00Z", "2026-01-01T19:00:00Z")],
    };
    await w.tx("demo", () =>
      handleTenantEvent(consumer(), event("agenda.item.added", { agenda_version: 2 })),
    );
    expect(last("main")?.data).toMatchObject({ scene: { key: "doors" }, heartbeat_bpm: 10 });
    for (let i = 0; i < 10; i++) {
      await w.tx("demo", () =>
        handleTenantEvent(
          consumer(),
          event("notify.checkin.recorded", {
            user_id: `u_${i}`,
            purpose: "arrival",
            check_in_id: `ci_${i}`,
            checked_in_at: w.now.toISOString(),
          }),
        ),
      );
    }
    expect(last("main")?.data.heartbeat_bpm).toBe(12);
    await w.tx("demo", () =>
      handleTenantEvent(
        consumer(),
        event("bot.presence.counted", {
          counted_at: w.now.toISOString(),
          interval_seconds: 60,
          members: 400,
          online: 180,
          idle: 0,
          dnd: 0,
          in_voice: 20,
        }),
      ),
    );
    expect(last("main")?.data.heartbeat_bpm).toBe(15);
    const before = scenes().length;
    await w.tx("demo", () =>
      handleTenantEvent(
        consumer(),
        event("games.surge.started", {
          game: { id: "g_1", name: "Demo Game", cover_url: null },
          players: 12,
          threshold: 10,
        }),
      ),
    );
    // The presets read no surge: nothing changes.
    expect(scenes()).toHaveLength(before);
  });

  it("puts a scene on with the crew button and takes it off when pressed again", async () => {
    await evaluate();
    const off = await w.call("reader", "POST", "/api/moments/scenes/peak/take", {});
    expect(off.statusCode).toBe(403);
    const on = await w.call("crew", "POST", "/api/moments/scenes/peak/take", {});
    expect(on.statusCode).toBe(200);
    expect(json(on).crew).toMatchObject({
      scene_key: "peak",
      until: new Date(w.now.getTime() + 30 * 60_000).toISOString(),
    });
    expect(last("main")?.data).toMatchObject({
      scene: { key: "peak", motion: "livelier" },
      why: "the crew pressed it",
      actor_user_id: "u_crew",
    });
    expect(w.audit.at(-1)).toMatchObject({ action: "moments.scene.taken" });
    const noButton = await w.call("crew", "POST", "/api/moments/scenes/daytime/take", {});
    expect(errorOf(noButton).code).toBe("invalid_request");
    const again = await w.call("crew", "POST", "/api/moments/scenes/peak/take", {});
    expect(json(again).crew).toBeNull();
    expect(last("main")?.data.scene).toMatchObject({ key: "daytime" });
    expect(w.audit.at(-1)).toMatchObject({ action: "moments.scene.released" });
    // Its time ends by itself, on the zones it was pressed for.
    await w.call("crew", "POST", "/api/moments/scenes/peak/take", { zones: ["stage"] });
    expect(last("stage")?.data.scene).toMatchObject({ key: "peak" });
    expect(last("main")?.data.scene).toMatchObject({ key: "daytime" });
    w.now = new Date(w.now.getTime() + 30 * 60_000);
    await evaluate();
    expect(last("stage")?.data.scene).toMatchObject({ key: "daytime" });
  });

  it("saves the list with its revision, resets it to the presets, and audits both", async () => {
    const own = {
      ...PRESETS[4],
      key: "late",
      name: "Late",
      preset: null,
      when: [{ type: "time", from: "17:00", to: "03:00" }],
      then: { ...PRESETS[4]?.then, motion: "party", layouts: { main: "dashboard" } },
      hold_minutes: 20,
      blend_seconds: 30,
    };
    const list = [own, ...PRESETS];
    expect(
      (await w.call("crew", "PUT", "/api/moments/scenes", { scenes: list, revision: 0 }))
        .statusCode,
    ).toBe(403);
    const bad = await w.call("admin", "PUT", "/api/moments/scenes", {
      scenes: [{ ...own, key: "Bad" }],
      revision: 0,
    });
    expect(bad.statusCode).toBe(400);
    const ok = await w.call("admin", "PUT", "/api/moments/scenes", { scenes: list, revision: 0 });
    expect(ok.statusCode).toBe(200);
    expect(json(ok)).toMatchObject({ revision: 1, copied: true });
    expect(last("main")?.data.scene).toMatchObject({ key: "late", layout: "dashboard" });
    expect(last("stage")?.data.scene).toMatchObject({ key: "late", layout: null });
    expect(w.audit.at(-1)).toMatchObject({ action: "moments.scenes.changed" });
    const stale = await w.call("admin", "PUT", "/api/moments/scenes", {
      scenes: list,
      revision: 0,
    });
    expect(stale.statusCode).toBe(409);
    const reset = await w.call("admin", "POST", "/api/moments/scenes/reset", { revision: 1 });
    expect(json(reset)).toMatchObject({ revision: 2 });
    expect((json(reset).scenes as { key: string }[]).map((s) => s.key)).toEqual(
      PRESETS.map((s) => s.key),
    );
    expect(last("main")?.data.scene).toMatchObject({ key: "daytime" });
    expect(w.audit.at(-1)).toMatchObject({ action: "moments.scenes.reset" });
    const archived = await w.call(
      "admin",
      "PUT",
      "/api/moments/scenes",
      { scenes: list, revision: 0 },
      { host: "archived.test" },
    );
    expect(archived.statusCode).toBe(409);
  });

  it("finishes a save and a check-in pass that run at once, without a deadlock", async () => {
    await evaluate();
    let save: Promise<Awaited<ReturnType<AppWorld["call"]>>> | undefined;
    // The pass holds "scene-zones" until the save waits on a lock, then reads the scenes row.
    const holding = {
      ...consumer(),
      db: {
        global: w.db.global.bind(w.db),
        tenant: <T>(fn: (c: SqlClient) => Promise<T>) =>
          w.db.tenant(async (c) => {
            await lockSettings(c, "scene-zones");
            save = w.call("admin", "PUT", "/api/moments/scenes", {
              scenes: [PRESETS[4]],
              revision: 0,
            });
            await expect
              .poll(async () => {
                const { rows } = await w.pool.query(
                  `SELECT count(*)::int AS n FROM pg_stat_activity
                   WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'`,
                );
                return (rows[0] as { n: number }).n;
              })
              .toBe(1);
            return fn(c);
          }),
      },
    };
    await w.tx("demo", () =>
      handleTenantEvent(
        holding,
        event("notify.checkin.recorded", {
          user_id: "u_1",
          purpose: "arrival",
          check_in_id: "ci_1",
          checked_in_at: w.now.toISOString(),
        }),
      ),
    );
    const saved = await save;
    expect(saved?.statusCode).toBe(200);
    expect(json(saved as NonNullable<typeof saved>)).toMatchObject({ revision: 1 });
  });

  it("holds a scene across a restart and forgets a removed zone", async () => {
    await w.call("admin", "PUT", "/api/moments/scenes", {
      scenes: [
        {
          ...PRESETS[4],
          key: "busy",
          name: "Busy",
          preset: null,
          when: [{ type: "checkins", over: 0 }],
          hold_minutes: 20,
        },
        ...PRESETS,
      ],
      revision: 0,
    });
    await w.tx("demo", () =>
      handleTenantEvent(
        consumer(),
        event("notify.checkin.recorded", {
          user_id: "u_1",
          purpose: "arrival",
          check_in_id: "ci_1",
          checked_in_at: w.now.toISOString(),
        }),
      ),
    );
    expect(last("main")?.data.scene).toMatchObject({ key: "busy" });
    w.restart();
    w.now = new Date(w.now.getTime() + 61 * 60_000);
    await evaluate();
    expect(last("main")?.data.scene).toMatchObject({ key: "daytime" });
    w.now = new Date(w.now.getTime() + 60_000);
    await w.tx("demo", () =>
      handleTenantEvent(consumer(), event("screen.zone.removed", { zone_key: "stage" })),
    );
    const left = await w.tx("demo", (c) =>
      c.query(`SELECT zone_key FROM moments_scene_zones ORDER BY zone_key`),
    );
    expect(left.rows.map((r) => r.zone_key)).toEqual(["main"]);
  });

  it("puts every zone in its scene from the tick every 10 s, reading the agenda once", async () => {
    let reads = 0;
    agenda = {
      agenda_version: 3,
      items: [item("ai_1", "tournament", "2026-01-01T17:30:00Z", "2026-01-01T19:00:00Z")],
    };
    const deps = {
      db: w.db,
      engine: w.engine,
      flush: () => w.outbox.flush(),
      now: () => w.now,
      agenda: () => {
        reads += 1;
        return Promise.resolve(agenda);
      },
      timeZoneOf: () => Promise.resolve("UTC"),
      scenes: new SceneTicker(),
    };
    await tickAll(deps);
    expect(last("main")?.data.scene).toMatchObject({ key: "peak" });
    const sent = scenes().length;
    w.now = new Date(w.now.getTime() + 9_000);
    await tickAll(deps);
    w.now = new Date(w.now.getTime() + 1_000);
    await tickAll(deps);
    expect(reads).toBe(1);
    expect(scenes()).toHaveLength(sent);
  });

  it("copies the priorities, rules and scenes of the event it was cloned from", async () => {
    await w.call("admin", "PUT", "/api/moments/scenes", { scenes: [PRESETS[4]], revision: 0 });
    await w.call("admin", "PUT", "/api/moments/rules/pizza", {
      ...(
        json(await w.call("reader", "GET", "/api/moments/rules")).rules as { rule_id: string }[]
      ).find((r) => r.rule_id === "pizza"),
      enabled: false,
      revision: 0,
    });
    const cloned = {
      ...event("tenants.tenant.cloned", {
        source_tenant_id: "demo",
        shift_seconds: 86400,
        actor_user_id: "u_admin",
      }),
      tenant: "two",
    } as Event;
    // On the new event's own stream (contracts/events.md, Tenants); at least once.
    await w.tx("two", () => handleTenantEvent(consumer(), cloned));
    await w.tx("two", () => handleTenantEvent(consumer(), cloned));
    const two = await w.tx("two", (c) => loadScenes(c));
    expect(two).toMatchObject({ copied: true, revision: 0 });
    expect(two.scenes.map((s) => s.key)).toEqual(["daytime"]);
    const rules = json(
      await w.call("reader", "GET", "/api/moments/rules", undefined, { host: "two.test" }),
    );
    expect(
      (rules.rules as { rule_id: string; enabled: boolean }[]).find((r) => r.rule_id === "pizza")
        ?.enabled,
    ).toBe(false);
  });
});
