/**
 * Pizza orders ready (preset 21) and `pizza.order.done` (#643; step 5, D3): "Pizza is here" takes
 * the hero while the arrival is fresh and hands it back after its hold or on the order's done,
 * whichever comes first, so the hall stops calling people once everyone got theirs (#775);
 * and a `done` the timer made (nobody marked it arrived or handed out) starts nothing. Pizza order
 * open ends, its finale too, once the order is called in or cancelled (#771).
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleTenantEvent } from "../src/consumer.js";
import { FIXTURES, event } from "./fixtures.js";
import { DATABASE_URL, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { TABLES, kit, preset, step, story } from "./story-kit.js";
import { loadStories } from "../src/story/store.js";
import { takeStory } from "../src/story/triggers.js";
import type { Story } from "../src/story/model.js";

describe.skipIf(!DATABASE_URL)("pizza orders ready and the order's done", () => {
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
    await pool.query(`TRUNCATE ${TABLES}`);
    w = world(pool);
    k = kit(w);
  });

  const deliver = (s: number, e: ReturnType<typeof FIXTURES.arrived>) =>
    w.tx("demo", () =>
      handleTenantEvent(
        { db: w.db, engine: w.engine, flush: () => w.outbox.flush(), now: () => w.at(s) },
        e,
      ),
    );

  /** The order's arrival, with where to collect it (U4) when `pickup` is given. */
  const arrived = (pickup: string | null) => {
    const e = FIXTURES.arrived();
    const data = e.data as { order: Record<string, unknown> };
    return event(
      "pizza.order.arrived",
      { ...data, order: { ...data.order, seq: 3, pickup } },
      w.at(0).toISOString(),
    );
  };
  /** The stories' rounds on air: where each stands, and its card, the round's last step. */
  const onAir = () =>
    w.tx("demo", async (c) => {
      const { rows } = await c.query(
        `SELECT regions, steps->-1 AS card FROM moments
          WHERE ended_at IS NULL AND class = 'storyboard'`,
        [],
      );
      return (rows as { regions: string[]; card: Record<string, unknown> }[]).map((r) => ({
        regions: r.regions,
        template: r.card.template,
        content: r.card.content as Record<string, unknown>,
        duration_ms: r.card.duration_ms,
      }));
    });

  // #775: the hall's biggest food moment was a 20 s card, gone before most of the hall looked up.
  it("puts Pizza is here in the hero with the order and where to collect it, and its art", async () => {
    await k.setup([preset("pizza_arrived")]);
    await deliver(0, arrived("Entrance table"));
    await k.run(1, 10, 5);
    const [card] = await onAir();
    expect(card?.regions[0]).toBe("hero");
    expect(card?.template).toBe("title_card");
    expect(card?.content).toMatchObject({
      title: "Pizza is here",
      subtitle: "Order 3 · Collect at Entrance table",
    });
    expect(String(card?.content.image_url)).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  // #775: on the full screenshot run the stories shot before had spent the airtime cap, and the
  // arrival's round was deferred past the shot's wait; a busy hall must not delay the pizza.
  it("is not held back by the airtime cap when other stories used it up", async () => {
    const busy = story({
      key: "busy",
      round: {
        steps: [step({ message: true, duration_seconds: 115 })],
        repeat: null,
        hold_seconds: null,
      },
    });
    await k.setup([busy, preset("pizza_arrived")], { airtime_percent: 20 });
    await k.tx(async (c) => {
      const doc = await loadStories(c);
      const s = doc.stories.find((x) => x.key === "busy") as Story;
      await takeStory(
        { c, engine: w.engine, now: w.at(0), settings: doc.settings, event: doc.event },
        s,
        { item: null, variables: {}, actor: { user_id: "u_crew", name: "Demo Crew" }, test: null },
      );
    });
    await k.run(1, 120, 5);
    await deliver(125, arrived("Entrance table"));
    await k.run(126, 150, 5);
    expect((await onAir()).map((m) => m.content.title)).toContain("Pizza is here");
  });

  it("says where to collect it in general words when the holder gave no place", async () => {
    await k.setup([preset("pizza_arrived")]);
    await deliver(0, arrived(null));
    await k.run(1, 10, 5);
    expect((await onAir())[0]?.content.subtitle).toBe("Order 3 · Collect at the pickup point");
  });

  it("holds the hero for a few minutes while the arrival is fresh, then hands it back", async () => {
    await k.setup([preset("pizza_arrived")]);
    await deliver(0, arrived("Entrance table"));
    await k.run(1, 150, 5);
    expect((await onAir()).map((m) => m.content.title)).toEqual(["Pizza is here"]);
    await k.run(155, 600, 5);
    expect(await onAir()).toEqual([]);
    expect((await k.runs())[0]).toMatchObject({ status: "ended", rounds_played: 1 });
  });

  it("hands the hero back at once when everyone got theirs, mid-hold", async () => {
    await k.setup([preset("pizza_arrived")]);
    await deliver(0, arrived("Entrance table"));
    await k.run(1, 30, 5);
    expect((await k.runs())[0]).toMatchObject({ story_key: "pizza_arrived", status: "live" });
    await deliver(40, FIXTURES.done());
    expect(await onAir()).toEqual([]);
    await k.run(41, 400, 5);
    expect((await k.runs())[0]).toMatchObject({ status: "ended", rounds_played: 1 });
  });

  /** The order's event a second `s` after T0, its state as the type says. */
  const order = (type: string, state: string, s: number) => {
    const e = FIXTURES.placed();
    const data = e.data as { order: Record<string, unknown> };
    return event(type, { ...data, order: { ...data.order, state } }, w.at(s).toISOString());
  };
  /** The titles of the stories' moments on air (the `pizza` rule's own moment is not one). */
  const live = () =>
    w.tx("demo", async (c) => {
      const { rows } = await c.query(
        `SELECT content->>'title' AS title FROM moments WHERE ended_at IS NULL AND class = 'storyboard'`,
        [],
      );
      return rows.map((r) => r.title as string);
    });

  // #771: the hall's screen showed "Order closed" beside the called-in order, 5 s after the close.
  it("ends Pizza order open's finale once the order is called in: no 'Order closed' after it", async () => {
    await k.setup([preset("pizza_order_open")]);
    await deliver(0, order("pizza.order.opened", "open", 0));
    await k.run(1, 5);
    await deliver(10, order("pizza.order.closed", "closed", 10));
    expect(await live()).toContain("Order closed");
    await deliver(13, order("pizza.order.placed", "placed", 13));
    expect(await live()).not.toContain("Order closed");
    await k.run(14, 30);
    expect((await k.runs())[0]).toMatchObject({ status: "ended" });
    expect(await live()).toEqual([]);
  });

  it("ends Pizza order open without its finale when the order is cancelled", async () => {
    await k.setup([preset("pizza_order_open")]);
    await deliver(0, order("pizza.order.opened", "open", 0));
    await k.run(1, 5);
    await deliver(30, order("pizza.order.cancelled", "cancelled", 30));
    await k.run(31, 1000, 5);
    expect((await k.runs())[0]).toMatchObject({ status: "ended" });
    const h = await k.history();
    expect(h.map((r) => r.outcome)).not.toContain("finale");
    expect(await live()).toEqual([]);
  });

  it("starts a story on a done order, but never on one the timer closed", async () => {
    await k.setup([
      story({
        key: "all_fed",
        triggers: [{ kind: "domain", type: "pizza.order.done", final_only: false }],
      }),
    ]);
    await deliver(0, FIXTURES.done("timer"));
    expect(await k.runs()).toEqual([]);
    await deliver(10, FIXTURES.done("handed_out"));
    expect((await k.runs()).map((r) => r.story_key)).toEqual(["all_fed"]);
  });
});
