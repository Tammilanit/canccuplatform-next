/**
 * The preset catalogue among the other moments, on a fake clock (#602; the storyboards plan,
 * Ownership and Phase hand-over): one pizza order shown and sounded once with the `pizza` rule,
 * Pizza orders ready and the pizza widget on (WD1, WD2), and Quiet hours soon's finale calm and
 * silent as quiet hours start, then the quiet scene within the hand-over time (SD9).
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleTenantEvent } from "../src/consumer.js";
import { evaluateScenes } from "../src/scene-store.js";
import { FIXTURES } from "./fixtures.js";
import { DATABASE_URL, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { TABLES, kit, preset, rounds } from "./story-kit.js";

/** 19:00, quiet hours start: T0 is 18:00. */
const T = 3600;

describe.skipIf(!DATABASE_URL)("the preset catalogue among the other moments", () => {
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

  it("shows and sounds one pizza order once with the pizza rule, Pizza orders ready and the widget on (WD1)", async () => {
    await k.setup([preset("pizza_arrived")]);
    const deps = (s: number) => ({
      db: w.db,
      engine: w.engine,
      flush: () => w.outbox.flush(),
      now: () => w.at(s),
    });
    // The rule keeps its placed order (WD2): its moment shows it.
    await w.tx("demo", () => handleTenantEvent(deps(0), FIXTURES.placed()));
    const placed = k.started();
    expect(placed.map((o) => [o.rank, o.template])).toEqual([[80, "pizza_placed"]]);
    await k.place("main", [[placed[0]?.id as string, "rail"]], w.at(0));
    // The arrived order is the preset's: one round, and the rule's older voice steps aside.
    const arrived = FIXTURES.arrived();
    await w.tx("demo", () => handleTenantEvent(deps(60), arrived));
    // Events come at least once: a second delivery changes nothing.
    await w.tx("demo", () => handleTenantEvent(deps(61), arrived));
    const started = k.started().slice(1);
    expect(started.map((o) => [o.rank, o.template])).toEqual([[65, "sting"]]);
    const ended = w
      .events("demo")
      .filter((e) => e.type === "moments.override.ended")
      .map((e) => [e.data.override_id, e.data.reason]);
    expect(ended).toEqual([[placed[0]?.id, "source_ended"]]);
    await k.place("main", [[started[0]?.id as string, "hero"]], w.at(60));
    await k.tick(w.at(61));
    // The safety net: a second voice for the arrived order is refused while the round plays.
    const second = await k.tx((c) =>
      w.engine.request(
        c,
        {
          class: "announcement",
          template: "pizza_placed",
          content: {},
          origin: "rule",
          why: "test",
          happening: "pizza.order.arrived:po_1",
        },
        w.at(62),
      ),
    );
    expect(second.status).toBe("refused");
    await k.tick(w.at(90));
    const played = (await k.soundLog()).filter((s) => s.outcome === "played").map((s) => s.cue);
    // The placed order's sound, then the arrived one's: each once.
    expect(played).toEqual(["pizza.placed", "pizza.placed"]);
    const steps = (started[0]?.steps ?? []) as { content: Record<string, unknown> }[];
    expect(steps[1]?.content).toMatchObject({ subtitle: "Order 1 · Collect at the pickup point" });
  });

  it("plays Quiet hours soon's finale calm and silent as quiet hours start, then the quiet scene within the hand-over (SD9)", async () => {
    await k.setup([preset("quiet_hours_soon")]);
    const scenes = (at: number) =>
      k.tx((c) => evaluateScenes(c, w.outbox, { timeZone: "UTC", now: w.at(at) }));
    const changed = () =>
      w
        .events("demo")
        .filter((e) => e.type === "moments.scene.changed")
        .map((e) => (e.data.scene as { key: string } | null)?.key);
    await k.agenda([
      {
        id: "it_quiet",
        title: "Quiet hours",
        kind: "quiet_hours",
        visibility: "public",
        status: "scheduled",
        starts_at: "2026-01-01T19:00:00Z",
        ends_at: "2026-01-02T07:00:00Z",
      },
    ]);
    for (const at of [T - 900, T - 300]) {
      await k.tick(w.at(at));
      await k.place("main", [[k.started().at(-1)?.id as string, "hero"]], w.at(at));
      await k.tick(w.at(at + 1));
      await k.tick(w.at(at + 30));
      await scenes(at + 30);
    }
    expect(changed().at(-1)).not.toBe("quiet");
    // Quiet hours start: the finale takes the hero, and the quiet scene waits for it.
    await k.tick(w.at(T));
    const finale = k.started().at(-1) as Record<string, unknown>;
    expect(finale).toMatchObject({
      template: "title_card",
      content: { title: "Good night" },
      starts_at: w.at(T).toISOString(),
    });
    const steps = finale.steps as { transition: string; effect: unknown; sound: unknown }[];
    expect(steps).toMatchObject([{ transition: "fade", effect: null, sound: null }]);
    await k.place("main", [[finale.id as string, "hero"]], w.at(T));
    await scenes(T);
    await k.tick(w.at(T + 1));
    await scenes(T + 5);
    expect(changed().at(-1)).not.toBe("quiet");
    let quietAt: number | null = null;
    for (let s = T + 6; s <= T + 30 && quietAt === null; s += 1) {
      await k.tick(w.at(s));
      await scenes(s);
      if (changed().at(-1) === "quiet") quietAt = s;
    }
    // Within the hand-over time (30 s): as the finale's 10 s end.
    expect(quietAt).toBe(T + 10);
    // The finale was silent: the first round's chime is the story's only sound.
    const played = (await k.soundLog()).filter((s) => s.outcome === "played").map((s) => s.cue);
    expect(played).toEqual(["story.chime"]);
    expect(rounds(await k.history())).toEqual([
      "round_started round 1 of 2",
      "round_started round 2 of 2",
      "round_started finale",
      "loop_ended ended: the item started",
    ]);
  });
});
