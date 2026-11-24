/**
 * Edge cases step 4's reviews found (#654): an archived event's photo, a clone after the first
 * tick, an agenda read that failed, a presence count with a bad time, a removed zone's claims
 * mark, a tenants module that never answers, and a refused video round.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Event } from "@canccu/kit";
import { handleTenantEvent } from "../src/consumer.js";
import { lockMoment } from "../src/store.js";
import { ensureStories, loadStories, writeStories, DEFAULT_SETTINGS } from "../src/story/store.js";
import { SceneTicker, StatusTicker, tickAll } from "../src/tick.js";
import { event } from "./fixtures.js";
import { DATABASE_URL, claims, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { TABLES, kit, step, story } from "./story-kit.js";

describe.skipIf(!DATABASE_URL)("edge cases from step 4's reviews", () => {
  let pool: pg.Pool;
  let w: World;
  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(
      `TRUNCATE ${TABLES}, moments_claims_marks, moments_rule_retries, moments_scenes`,
    );
    w = world(pool);
    await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main')`));
  });

  const deps = (o: object = {}) => ({
    db: w.db,
    engine: w.engine,
    flush: () => w.outbox.flush(),
    now: () => w.now,
    ...o,
  });
  const deliver = (e: Event, o: object = {}) =>
    w.tx(e.tenant ?? "demo", () => handleTenantEvent(deps(o), e));
  const rows = async (sql: string, tenant = "demo") =>
    (await w.tx(tenant, (c) => c.query(sql, []))).rows;
  const crewMoment = (ttl = 600) =>
    w.tx("demo", (c) =>
      w.engine.request(
        c,
        {
          class: "spotlight",
          template: "title_card",
          content: { title: "Hello" },
          origin: "crew",
          why: "test",
          ttl_seconds: ttl,
        },
        w.now,
      ),
    );

  it("plays no photo's sound and starts no story on an archived event (E10)", async () => {
    await kit(w).setup([
      story({ triggers: [{ kind: "domain", type: "screen.photo.added", final_only: false }] }),
    ]);
    await pool.query(`UPDATE moments_tenants SET archived_at = now() WHERE tenant_id = 'demo'`);
    await deliver(event("screen.photo.added", { photo_id: "ph_1" }));
    expect(await rows(`SELECT 1 FROM moments_sound_log`)).toEqual([]);
    expect(await rows(`SELECT 1 FROM moments_story_runs`)).toEqual([]);
  });

  it("copies the source's stories over the presets a tick copied before the clone came", async () => {
    await w.tx("demo", (c) =>
      writeStories(c, [story({ key: "own", name: "Our own" })], DEFAULT_SETTINGS, 1),
    );
    await w.tx("two", (c) => ensureStories(c));
    const cloned = {
      ...event("tenants.tenant.cloned", { source_tenant_id: "demo", shift_seconds: 0 }),
      tenant: "two",
    } as Event;
    await deliver(cloned);
    const two = await w.tx("two", (c) => loadStories(c));
    expect(two.stories.map((s) => s.key)).toEqual(["own"]);
    // An event that saved its own stories keeps them.
    await w.tx("demo", (c) => writeStories(c, [story({ key: "later" })], DEFAULT_SETTINGS, 2));
    await deliver(cloned);
    expect((await w.tx("two", (c) => loadStories(c))).stories.map((s) => s.key)).toEqual(["own"]);
  });

  it("reads the agenda again on the tick when its read on an agenda event failed", async () => {
    let reads = 0;
    let fails = false;
    const agenda = () => {
      reads += 1;
      return fails
        ? Promise.reject(new Error("timeout"))
        : Promise.resolve({ agenda_version: 1, items: [] });
    };
    const scenes = new SceneTicker();
    const o = { agenda, scenes, timeZoneOf: () => Promise.resolve("UTC") };
    await tickAll(deps(o));
    expect(reads).toBe(1);
    fails = true;
    await deliver(event("agenda.item.added", { agenda_version: 2 }), o);
    expect(reads).toBe(2);
    fails = false;
    w.now = w.at(10);
    await tickAll(deps(o));
    expect(reads).toBe(3);
  });

  it("takes a presence count whose time does not parse at the event's time", async () => {
    const counted = event("bot.presence.counted", { counted_at: "soon", online: 42 });
    await deliver(counted);
    expect(await rows(`SELECT data FROM moments_sources WHERE kind = 'presence'`)).toEqual([
      { data: { online: 42, counted_at: new Date(counted.time).toISOString() } },
    ]);
  });

  // #657: a check-in's own time that does not parse would fail the event on every delivery.
  it("takes an arrival check-in whose time does not parse at the event's time", async () => {
    const checkIn = event("notify.checkin.recorded", {
      check_in_id: "ci_1",
      purpose: "arrival",
      checked_in_at: "soon",
    });
    await deliver(checkIn);
    expect(await rows(`SELECT check_in_id, at FROM moments_checkins`)).toEqual([
      { check_in_id: "ci_1", at: new Date(checkIn.time) },
    ]);
  });

  // #657: every container gets every event; only one decides and logs a new photo's sound.
  it("logs a new photo's sound once, however many containers get it", async () => {
    const photo = event("screen.photo.added", { photo_id: "ph_1" });
    const first = deps();
    w.restart();
    await w.tx("demo", () => handleTenantEvent(first, photo));
    await deliver(photo);
    expect(await rows(`SELECT zone_key, outcome FROM moments_sound_log`)).toEqual([
      { zone_key: "main", outcome: "played" },
    ]);
  });

  it("logs a new photo's sound on the retry of a run that failed", async () => {
    const photo = event("screen.photo.added", { photo_id: "ph_1" });
    const screen = w.screen;
    const zoneSound = screen.zoneSound.bind(screen);
    screen.zoneSound = () => Promise.reject(new Error("Screen fell over"));
    await expect(deliver(photo)).rejects.toThrow("Screen fell over");
    screen.zoneSound = zoneSound;
    await deliver(photo);
    expect(await rows(`SELECT zone_key, outcome FROM moments_sound_log`)).toEqual([
      { zone_key: "main", outcome: "played" },
    ]);
  });

  it("forgets a removed zone's newest claims report", async () => {
    const r = await crewMoment();
    if (r.status === "refused") throw new Error("refused");
    await deliver(
      event("screen.claims.changed", claims("main", [[`${r.moment.id}.main`, "hero"]])),
    );
    expect(await rows(`SELECT zone_key FROM moments_claims_marks`)).toEqual([{ zone_key: "main" }]);
    await deliver(event("screen.zone.removed", { zone_key: "main" }));
    expect(await rows(`SELECT zone_key FROM moments_claims_marks`)).toEqual([]);
  });

  it("goes on with the tick when the tenants module never answers the status read", async () => {
    const r = await crewMoment(5);
    if (r.status === "refused") throw new Error("refused");
    const statuses = new StatusTicker(() => new Promise<string | null>(() => undefined), 50);
    w.now = w.at(6);
    await tickAll(deps({ statuses }));
    expect((await w.tx("demo", (c) => lockMoment(c, r.moment.id)))?.end_reason).toBe("expired");
  });

  // #605: a refused video round sounds nothing: no count, no hold over the zone's other sounds.
  it("holds no sound for a video round that one owner per happening refuses", async () => {
    const k = kit(w);
    const film = {
      asset_id: "as_film",
      kind: "video",
      url: "/api/screen/files/abc.mp4",
      duration_ms: 60_000,
      title: "Last year",
    };
    await k.setup([
      story({
        triggers: [{ kind: "domain", type: "tournament.registration.opened", final_only: false }],
        round: {
          steps: [
            step({ message: true, duration_seconds: 15 }),
            step({ template: "video", content: film }),
          ],
          repeat: null,
          hold_seconds: null,
        },
      }),
    ]);
    w.now = w.at(0);
    const opened = event("tournament.registration.opened", {
      session: { id: "ts_1", name: "Heat", game: { id: "g_1", name: "Demo Game" } },
    });
    await w.tx("demo", () => handleTenantEvent(deps(), opened));
    const run = await k.tx(async (c) => {
      const { rows } = await c.query(`SELECT id, facts FROM moments_story_runs`, []);
      return rows[0] as { id: string; facts: Record<string, string> };
    });
    await k.tx((c) =>
      w.engine.request(
        c,
        {
          class: "spotlight",
          template: "title_card",
          content: { title: "Ours" },
          origin: "crew",
          why: "test",
          // Beside the run's own title card, which owns the happening too.
          happening: run.facts["@happening"] ?? null,
          happening_run: run.id,
        },
        w.at(5),
      ),
    );
    await k.tick(w.at(14));
    expect(k.started().map((o) => o.template)).not.toContain("video");
    expect((await k.soundLog()).filter((s) => s.cue === "story.video")).toEqual([]);
    await k.tx((c) =>
      w.engine.fireCue(
        c,
        { cue: "announce.attention", zones: ["main"], key: "z", source: "z" },
        w.at(20),
      ),
    );
    expect((await k.soundLog()).at(-1)).toMatchObject({ cue: "announce.attention" });
    expect((await k.soundLog()).at(-1)?.reason).not.toBe("video");
  });
});
