/**
 * Storyboards against the other moments, on a fake clock (SO4): the story's sound cap and its
 * flood source per run, a video paused by an emergency and resumed where it stopped with other
 * sound held, the airtime cap, a quiet scene (calm and silent, and `quiet: skip`), the phase
 * hand-over, and one match shown and sounded once with a rule, a preset and a widget on (WD1, SD6).
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleTenantEvent } from "../src/consumer.js";
import { evaluateScenes } from "../src/scene-store.js";
import { lockMoment } from "../src/store.js";
import { loadStories } from "../src/story/store.js";
import { takeStory } from "../src/story/triggers.js";
import type { Story } from "../src/story/model.js";
import { FIXTURES, event } from "./fixtures.js";
import { DATABASE_URL, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { TABLES, kit, preset, rounds, step, story } from "./story-kit.js";

const CREW = { user_id: "u_crew", name: "Demo Crew" };

describe.skipIf(!DATABASE_URL)("storyboards among the other moments", () => {
  let pool: pg.Pool;
  let w: World;
  let k: ReturnType<typeof kit>;
  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${TABLES}, moments_scenes`);
    w = world(pool);
    k = kit(w);
  });

  const take = (key: string, at: Date) =>
    k.tx(async (c) => {
      const doc = await loadStories(c);
      const s = doc.stories.find((x) => x.key === key) as Story;
      return takeStory(
        { c, engine: w.engine, now: at, settings: doc.settings, event: doc.event },
        s,
        {
          item: null,
          variables: {},
          actor: CREW,
          test: null,
        },
      );
    });
  const emergency = (at: Date) =>
    k.tx((c) =>
      w.engine.request(
        c,
        {
          class: "emergency",
          template: "announcement",
          content: { title: "Leave", level: "emergency" },
          origin: "emergency",
          why: "test",
          ttl_seconds: null,
        },
        at,
      ),
    );
  const endAll = (at: Date, cls: string) =>
    k.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT id FROM moments WHERE class = $1 AND ended_at IS NULL`,
        [cls],
      );
      for (const r of rows) {
        const m = await lockMoment(c, r.id as string);
        if (m !== null) await w.engine.end(c, m, "cleared", null, at);
      }
    });

  it("keeps a story within 2 sounds a round, and one sound per 10 s per run (fix 7)", async () => {
    const cued = (cue: string, o = {}) => step({ cue, duration_seconds: 20, ...o });
    await k.setup([
      story({
        round: {
          steps: [
            step({
              template: "sting",
              content: { text: "Hey" },
              duration_seconds: 3,
              cue: "announce.attention",
            }),
            cued("announce.result", { message: true }),
            cued("nowplaying.start"),
            cued("photo.showcase"),
          ],
          repeat: null,
          hold_seconds: null,
        },
      }),
    ]);
    await take("test", w.at(0));
    await k.place("main", [[k.started()[0]?.id as string, "hero"]], w.at(0));
    for (const at of [1, 4, 24, 44]) await k.tick(w.at(at));
    expect((await k.soundLog()).map((s) => `${s.cue} ${s.outcome} ${s.reason}`)).toEqual([
      "announce.attention played free",
      "announce.result suppressed flood_source",
      "nowplaying.start played free",
      "photo.showcase suppressed story_cap",
    ]);
  });

  it("pauses a video for an emergency, resumes it where it stopped and holds other sound while it plays", async () => {
    const film = {
      asset_id: "as_film",
      kind: "video",
      url: "/api/screen/files/abc.mp4",
      duration_ms: 120_000,
      title: "Last year",
    };
    await k.setup([
      story({
        round: {
          steps: [
            step({ message: true, duration_seconds: 15 }),
            step({ template: "video", content: film }),
            step({ duration_seconds: 15 }),
          ],
          repeat: null,
          hold_seconds: null,
        },
      }),
    ]);
    await take("test", w.at(0));
    await k.tick(w.at(14));
    const video = k.started()[1] as Record<string, unknown>;
    expect(video).toMatchObject({
      template: "video",
      regions: ["full"],
      expires_at: w.at(135).toISOString(),
    });
    expect(video.content).toMatchObject({
      url: film.url,
      started_at: w.at(15).toISOString(),
      paused_at: null,
      muted_zones: [],
    });
    expect((await k.soundLog()).map((s) => `${s.cue} ${s.outcome}`)).toEqual([
      "story.video played",
    ]);
    await k.tx((c) =>
      w.engine.fireCue(
        c,
        { cue: "announce.attention", zones: ["main"], key: "x", source: "x" },
        w.at(20),
      ),
    );
    expect((await k.soundLog()).at(-1)).toMatchObject({
      cue: "announce.attention",
      reason: "video",
    });
    await emergency(w.at(30));
    await k.tick(w.at(31));
    const paused = await k.tx((c) => lockMoment(c, String(video.id).replace(/\.main$/, "")));
    expect(paused?.content.paused_at).toBe(w.at(31).toISOString());
    await endAll(w.at(60), "emergency");
    await k.tick(w.at(61));
    const resumed = await k.tx((c) => lockMoment(c, String(video.id).replace(/\.main$/, "")));
    expect(resumed?.content).toMatchObject({ started_at: w.at(45).toISOString(), paused_at: null });
    expect(resumed?.expires_at?.toISOString()).toBe(w.at(165).toISOString());
    // #605: the zone's video hold moves with the pause too, so no other sound plays over its end.
    await k.tx((c) =>
      w.engine.fireCue(
        c,
        { cue: "announce.attention", zones: ["main"], key: "y", source: "y" },
        w.at(140),
      ),
    );
    expect((await k.soundLog()).at(-1)).toMatchObject({
      cue: "announce.attention",
      reason: "video",
    });
    await k.tick(w.at(165));
    expect(k.started().filter((o) => o.rank === 60)[2]?.starts_at).toBe(w.at(165).toISOString());
  });

  it("plays a round a deprecated airtime cap would have deferred: no cap (#777)", async () => {
    const long = {
      steps: [1, 2, 3, 4, 5].map((i) =>
        step({ content: { title: `Card ${String(i)}` }, message: i === 1 }),
      ),
      repeat: null,
      hold_seconds: null,
    };
    await k.setup(
      [
        story({ key: "long", round: long }),
        story({
          key: "short",
          round: {
            steps: [step({ message: true, duration_seconds: 30 })],
            repeat: null,
            hold_seconds: null,
          },
        }),
      ],
      { airtime_percent: 20 },
    );
    await take("long", w.at(0));
    await take("short", w.at(110));
    for (const at of [120, 180, 240]) await k.tick(w.at(at));
    expect(k.started()).toHaveLength(2);
    expect(rounds(await k.history()).filter((r) => r.includes("skipped"))).toEqual([]);
  });

  it("plays calm and silent in a quiet scene, and a `quiet: skip` story does not fire there (E11)", async () => {
    await k.setup([
      story({
        key: "calm",
        round: {
          steps: [step({ message: true, cue: "announce.attention" })],
          repeat: null,
          hold_seconds: null,
        },
      }),
      story({ key: "skip", conditions: { ...story().conditions, quiet: "skip" } }),
    ]);
    await k.tx((c) =>
      c.query(
        `INSERT INTO moments_scene_zones (zone_key, scene_key, since, why, sent) VALUES ('main', 'quiet', now(), 'test', $1)`,
        [JSON.stringify({ scene: { key: "quiet", name: "Quiet", quiet: true } })],
      ),
    );
    w.zoneStatus.set("main", { energy: "quiet", device: w.soundScreen });
    await take("calm", w.at(0));
    await k.place("main", [[k.started()[0]?.id as string, "hero"]], w.at(0));
    await k.tick(w.at(1));
    expect((await k.soundLog()).map((s) => s.reason)).toEqual(["quiet"]);
    await take("skip", w.at(5));
    expect(k.started()).toHaveLength(1);
    expect((await k.history()).at(-1)).toMatchObject({
      action: "not_fired",
      outcome: "not fired: not in quiet (main)",
    });
  });

  it("hands a zone over to its new scene after the story's round, at most 30 s later (SD9)", async () => {
    await k.setup([
      story({
        round: {
          steps: [step({ message: true, duration_seconds: 60 }), step({ duration_seconds: 40 })],
          repeat: null,
          hold_seconds: null,
        },
      }),
    ]);
    const scenes = (at: number) =>
      k.tx((c) => evaluateScenes(c, w.outbox, { timeZone: "UTC", now: w.at(at) }));
    const changed = () =>
      w
        .events("demo")
        .filter((e) => e.type === "moments.scene.changed")
        .map((e) => (e.data.scene as { key: string } | null)?.key);
    await scenes(0);
    expect(changed()).toEqual(["daytime"]);
    await k.agenda([
      {
        id: "it_quiet",
        title: "Quiet hours",
        kind: "quiet_hours",
        visibility: "public",
        status: "scheduled",
        starts_at: "2026-01-01T18:00:10Z",
        ends_at: "2026-01-02T06:00:00Z",
      },
    ]);
    await take("test", w.at(5));
    await scenes(12);
    expect(changed()).toEqual(["daytime"]);
    await scenes(41);
    expect(changed()).toEqual(["daytime"]);
    await scenes(42);
    expect(changed()).toEqual(["daytime", "quiet"]);
  });

  it("shows and sounds one match once with the rule, the preset and the widget on (WD1, SD6)", async () => {
    await k.setup([preset("match_called")]);
    const deps = { db: w.db, engine: w.engine, flush: () => w.outbox.flush(), now: () => w.at(0) };
    const called = FIXTURES.called();
    await w.tx("demo", () => handleTenantEvent(deps, called));
    // Events come at least once: a second delivery changes nothing.
    await w.tx("demo", () => handleTenantEvent(deps, called));
    const started = k.started();
    expect(started.map((o) => o.rank)).toEqual([60]);
    await k.place("main", [[started[0]?.id as string, "hero"]], w.at(0));
    await k.tick(w.at(1));
    expect((await k.soundLog()).filter((s) => s.outcome === "played").map((s) => s.cue)).toEqual([
      "tournament.start",
    ]);
    // The safety net: a second voice for the same happening is refused while the first plays.
    const second = await k.tx((c) =>
      w.engine.request(
        c,
        {
          class: "tournament",
          template: "match_called",
          content: {},
          origin: "rule",
          why: "test",
          happening: "tournament.match.called:tm_1",
        },
        w.at(2),
      ),
    );
    expect(second.status).toBe("refused");
    // Its domain end event: the match starts, and the loop ends (Match called has no finale).
    await w.tx("demo", () =>
      handleTenantEvent({ ...deps, now: () => w.at(30) }, FIXTURES.started()),
    );
    expect((await k.history()).at(-1)).toMatchObject({
      action: "loop_ended",
      outcome: "ended: tournament.match.started",
    });
  });

  it("plays the video of a round after its steps in a story a domain event started (WD1 ignores the run's own moments)", async () => {
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
    const deps = { db: w.db, engine: w.engine, flush: () => w.outbox.flush(), now: () => w.at(0) };
    const opened = event("tournament.registration.opened", {
      session: { id: "ts_1", name: "Heat", game: { id: "g_1", name: "Demo Game" } },
    });
    await w.tx("demo", () => handleTenantEvent(deps, opened));
    await k.tick(w.at(14));
    expect(k.started().map((o) => o.template)).toEqual(["title_card", "video"]);
    expect(rounds(await k.history()).some((x) => x.includes("one owner per happening"))).toBe(
      false,
    );
  });

  it("applies a loop's domain end that arrives while the tick holds the run's row", async () => {
    await k.setup([preset("match_called")]);
    const deps = { db: w.db, engine: w.engine, flush: () => w.outbox.flush(), now: () => w.at(0) };
    await w.tx("demo", () => handleTenantEvent(deps, FIXTURES.called()));
    const locker = await pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query(`SELECT id FROM moments_story_runs WHERE status = 'live' FOR UPDATE`);
      let done = false;
      const ending = w
        .tx("demo", () => handleTenantEvent({ ...deps, now: () => w.at(30) }, FIXTURES.started()))
        .then(() => {
          done = true;
        });
      await new Promise((r) => setTimeout(r, 300));
      expect(done).toBe(false);
      await locker.query("COMMIT");
      await ending;
    } finally {
      locker.release();
    }
    expect((await k.history()).at(-1)).toMatchObject({
      action: "loop_ended",
      outcome: "ended: tournament.match.started",
    });
  });
});
