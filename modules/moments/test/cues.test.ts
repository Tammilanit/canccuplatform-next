/** Cues on a real Postgres: a moment's picture and sound, the log, the budget and the queue. */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Event } from "@canccu/kit";
import { emergencyRequest } from "../src/content.js";
import { tickTenant } from "../src/tick.js";
import { DATABASE_URL, T0, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";

const live = DATABASE_URL ? describe : describe.skip;

live("cues", () => {
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
      `TRUNCATE moments, moment_overrides, moment_placements, moments_zones, moments_history,
        moments_outbox, moments_cues, moments_sound_settings, moments_sound_zones,
        moments_sound_sources, moments_sound_log, moments_sounds`,
    );
    w = world(pool);
    w.now = T0;
    for (const z of ["main", "cafe"])
      await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ($1)`, [z]));
  });

  const sounds = (): Event[] => w.events("demo").filter((e) => e.type === "moments.sound.played");
  const log = async () =>
    (
      await pool.query(
        `SELECT zone_key, cue, outcome, reason, detail FROM moments_sound_log ORDER BY seq`,
      )
    ).rows as { zone_key: string; cue: string; outcome: string; reason: string; detail: string }[];

  const pizza = (n: number, at: Date) =>
    w.tx("demo", (c) =>
      w.engine.request(
        c,
        {
          class: "announcement",
          template: "pizza_placed",
          content: { seq: n },
          origin: "rule",
          rule_id: "pizza",
          why: "rule: pizza.order.placed",
          zones: ["main"],
          source: { module: "pizza", event_id: null, ref: `o${String(n)}` },
          dedupe_key: `pizza:o${String(n)}`,
          cue: "pizza.placed",
        },
        at,
      ),
    );

  it("a moment's cue sounds on each of its zones together, and its box gets an effect", async () => {
    await pizza(1, T0);
    const s = sounds();
    expect(s.map((e) => e.data.zone_key)).toEqual(["main"]);
    const play = s[0]?.data.sound as Record<string, unknown>;
    expect(play.cue).toBe("pizza.placed");
    expect(play.play_at).toBe(new Date(T0.getTime() + 400).toISOString());
    expect(String(play.url)).toMatch(/^\/api\/moments\/sounds\/pack\/(bicycle-bell|ding)\.ogg$/);
    expect(play.volume).toBeCloseTo(0.8 * 0.8);
    const started = w.events("demo").find((e) => e.type === "moments.override.started");
    const effect = (started?.data.override as Record<string, unknown>).effect as Record<
      string,
      unknown
    >;
    expect(["pop", "ripple"]).toContain(effect.name);
    expect(effect.hold_seconds).toBe(60);
    expect(effect.fade_seconds).toBe(10);
    expect(await log()).toEqual([
      { zone_key: "main", cue: "pizza.placed", outcome: "played", reason: "free", detail: null },
    ]);
  });

  it("an edit or a renewal never sounds again", async () => {
    await pizza(1, T0);
    await w.tx("demo", (c) =>
      w.engine.request(
        c,
        {
          class: "announcement",
          template: "pizza_placed",
          content: { seq: 1, state: "arrived" },
          origin: "rule",
          rule_id: "pizza",
          why: "rule: pizza.order.arrived",
          zones: ["main"],
          dedupe_key: "pizza:o1",
          cue: "pizza.placed",
        },
        w.at(30),
      ),
    );
    expect(sounds()).toHaveLength(1);
  });

  it("a burst of 50 triggers in a minute plays 3 and logs why for the other 47 (E14)", async () => {
    for (let n = 0; n < 50; n++) {
      const at = new Date(T0.getTime() + n * 1150);
      await w.tx("demo", (c) => tickTenant(c, w.engine, at));
      await pizza(n, at);
    }
    await w.tx("demo", (c) => tickTenant(c, w.engine, w.at(70)));
    const rows = await log();
    const played = rows.filter((r) => r.outcome === "played");
    expect(played.length).toBe(3);
    expect(sounds()).toHaveLength(3);
    // Every trigger has its final line in the log, with a reason code.
    const finals = rows.filter((r) => r.outcome !== "queued");
    expect(finals).toHaveLength(50);
    expect(finals.every((r) => r.reason.length > 0)).toBe(true);
    expect(rows.some((r) => r.reason === "flood_minute")).toBe(true);
    expect(rows.some((r) => r.reason === "coalesced")).toBe(true);
  }, 30_000);

  it("the hourly budget holds across the minutes, and urgent passes it", async () => {
    await w.tx("demo", (c) =>
      c.query(`INSERT INTO moments_sound_settings (settings, revision) VALUES ($1, 1)`, [
        JSON.stringify({ hourly_budget: 2 }),
      ]),
    );
    for (let n = 0; n < 4; n++) await pizza(n, new Date(T0.getTime() + n * 61_000));
    const reasons = (await log()).map((r) => r.reason);
    expect(reasons).toEqual(["free", "free", "budget", "budget"]);
    const actor = { user_id: "u_admin", name: "Demo admin" };
    await w.tx("demo", (c) =>
      w.engine.request(
        c,
        emergencyRequest({ zones: ["main"] }, actor, "test", w.at(300)),
        w.at(300),
      ),
    );
    const last = (await log()).at(-1);
    expect([last?.cue, last?.outcome, last?.reason]).toEqual([
      "emergency.start",
      "played",
      "urgent_passes",
    ]);
  });

  it("a calm zone lets only the essential categories through; a quiet one only urgent", async () => {
    w.zoneStatus.set("main", { energy: "calm", device: w.soundScreen });
    w.zoneStatus.set("cafe", { energy: "quiet", device: w.soundScreen });
    await w.tx("demo", (c) =>
      w.cues.fire(c, { cue: "photo.showcase", zones: [], key: "photo:p1", source: "p1" }, T0),
    );
    await w.tx("demo", (c) =>
      w.cues.fire(c, { cue: "announce.attention", zones: [], key: "a1", source: null }, w.at(10)),
    );
    expect((await log()).map((r) => [r.zone_key, r.cue, r.reason])).toEqual([
      ["cafe", "photo.showcase", "quiet"],
      ["main", "photo.showcase", "calm"],
      ["cafe", "announce.attention", "quiet"],
      ["main", "announce.attention", "free"],
    ]);
  });

  it("a sound screen offline or locked misses the sound, with catch-up, and the log says so", async () => {
    w.zoneStatus.set("main", { energy: "lively", device: { ...w.soundScreen, online: false } });
    w.zoneStatus.set("cafe", {
      energy: "lively",
      device: { ...w.soundScreen, audio_unlocked: false },
    });
    w.zoneStatus.set("hall", { energy: "lively", device: null });
    await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ('hall')`));
    await w.tx("demo", (c) =>
      w.cues.fire(c, { cue: "announce.attention", zones: [], key: "a1", source: null }, T0),
    );
    expect((await log()).map((r) => [r.zone_key, r.outcome, r.reason])).toEqual([
      ["cafe", "missed", "audio_locked"],
      ["hall", "suppressed", "no_sound_screen"],
      ["main", "missed", "device_offline"],
    ]);
    // Sent anyway: the screen plays it late if it comes back within the window (E13).
    expect(sounds().map((e) => e.data.zone_key)).toEqual(["cafe", "main"]);
  });

  it("a waiting sound plays when the one before it ends, from the tick", async () => {
    await w.tx("demo", (c) =>
      w.cues.fire(c, { cue: "tournament.post", zones: ["main"], key: "m1", source: "m1" }, T0),
    );
    await w.tx("demo", (c) =>
      w.cues.fire(
        c,
        { cue: "announce.attention", zones: ["main"], key: "a1", source: null },
        w.at(1),
      ),
    );
    expect(sounds()).toHaveLength(1);
    const first = sounds()[0]?.data.sound as { length_ms?: number; play_at: string };
    const ends = Date.parse(first.play_at) + 4000;
    await w.tx("demo", (c) => tickTenant(c, w.engine, new Date(ends + 100)));
    // The drum roll (3.98 s) ends at 4.38 s; the attention cue waited from 1 s.
    expect(sounds()).toHaveLength(2);
    expect((await log()).map((r) => [r.cue, r.outcome, r.reason])).toEqual([
      ["tournament.post", "played", "free"],
      ["announce.attention", "queued", "waited"],
      ["announce.attention", "played", "waited"],
    ]);
  });

  it("a sound check plays on the chosen zones, past every gate but the master", async () => {
    w.zoneStatus.set("main", { energy: "quiet", device: w.soundScreen });
    await w.tx("demo", (c) => w.cues.check(c, ["main"], "pack.gong", T0));
    const play = sounds()[0]?.data.sound as Record<string, unknown>;
    expect(play.cue).toBe("sound_check");
    expect(play.url).toBe("/api/moments/sounds/pack/gong.ogg");
    expect((await log()).map((r) => [r.outcome, r.reason])).toEqual([["played", "sound_check"]]);
  });
});
