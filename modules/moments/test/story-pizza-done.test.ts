/**
 * Pizza orders ready (preset 21) and `pizza.order.done` (#643; step 5, D3): the story may end on the
 * order's done as well as on its count, so the hall stops calling people once everyone got theirs;
 * and a `done` the timer made (nobody marked it arrived or handed out) starts nothing. Pizza order
 * open ends, its finale too, once the order is called in or cancelled (#771).
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleTenantEvent } from "../src/consumer.js";
import { FIXTURES, event } from "./fixtures.js";
import { DATABASE_URL, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { TABLES, kit, preset, story } from "./story-kit.js";

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

  it("ends Pizza orders ready once everyone got theirs, before its count runs out", async () => {
    await k.setup([preset("pizza_arrived")]);
    await deliver(0, FIXTURES.arrived());
    await k.run(1, 30, 5);
    expect((await k.runs())[0]).toMatchObject({ story_key: "pizza_arrived", status: "live" });
    await deliver(40, FIXTURES.done());
    await k.run(41, 400, 5);
    const [run] = await k.runs();
    expect(run?.status).toBe("ended");
    // Its three rounds come five minutes apart: the done ended it after the first.
    expect(run?.rounds_played).toBe(1);
  });

  it("plays on to its count when the order is not done", async () => {
    await k.setup([preset("pizza_arrived")]);
    await deliver(0, FIXTURES.arrived());
    await k.run(1, 400, 5);
    expect((await k.runs())[0]).toMatchObject({ status: "live", rounds_played: 2 });
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
