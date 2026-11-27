/**
 * Food as hero moments (#787 D8, sheet 02): the `pizza` rule's order open, last call and on the
 * way, each in the hero first, then the food box, then the ticker, one at a time and each covering
 * the food box, so no other box repeats it (D7).
 */
import { afterAll, beforeEach, expect, it } from "vitest";
import type pg from "pg";
import type { Event } from "@canccu/kit";
import { handleTenantEvent } from "../src/consumer.js";
import { tickTenant } from "../src/tick.js";
import { DATABASE_URL, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { event } from "./fixtures.js";

const run = DATABASE_URL ? it : it.skip;

const order = (state: string, over: Record<string, unknown> = {}) => ({
  id: "po_7",
  seq: 7,
  state,
  pizzeria: { id: "pz_1", name: "Demo Pizzeria" },
  target_at: "2026-01-01T18:30:00Z",
  closes_at: "2026-01-01T18:30:00Z",
  estimate_at: null,
  holder: { user_id: "u_1", name: "Demo Player" },
  pizza_count: 9,
  people_count: 6,
  revision: 3,
  ...over,
});
const at = "2026-01-01T18:18:00Z";
const opened = () =>
  event("pizza.order.opened", { order: order("open"), actor_user_id: "u_1" }, at);
const closing = () =>
  event("pizza.order.closing", { order: order("open"), closes_at: "2026-01-01T18:30:00Z" }, at);
const closed = () =>
  event("pizza.order.closed", { order: order("closed"), actor_user_id: null }, at);
const placed = (estimate = "2026-01-01T18:52:00Z") =>
  event(
    "pizza.order.placed",
    { order: order("placed", { estimate_at: estimate }), actor_user_id: "u_1" },
    at,
  );
const changed = () =>
  event(
    "pizza.order.changed",
    {
      order: order("placed", { estimate_at: "2026-01-01T19:05:00Z" }),
      changed: ["estimate_at"],
      actor_user_id: "u_1",
    },
    at,
  );
const arrived = () =>
  event("pizza.order.arrived", { order: order("arrived"), user_ids: ["u_1"], people: [] }, at);
const cancelled = () =>
  event("pizza.order.cancelled", { order: order("cancelled"), reason: "cancelled", user_ids: [], people: [], actor_user_id: "u_1" }, at); // prettier-ignore

let pool: pg.Pool | undefined;
let w: World;
beforeEach(async () => {
  if (pool !== undefined) await pool.end();
  pool = await freshDatabase();
  w = world(pool);
  w.now = new Date(at);
  await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main')`));
});
afterAll(async () => {
  await pool?.end();
});

const deliver = (e: Event) =>
  w.tx("demo", async () => {
    await handleTenantEvent(
      { db: w.db, engine: w.engine, flush: () => w.outbox.flush(), now: () => w.now },
      e,
    );
  });
const overrides = () =>
  w
    .events("demo")
    .filter((e) => e.type.startsWith("moments.override."))
    .map((e): Record<string, unknown> => ({
      type: e.type,
      reason: e.data.reason,
      ...(e.data.override as Record<string, unknown>),
    }));
/** The evening moves on: the hero's floor and the gap between holders pass (#777, D7). */
const later = async (seconds: number) => {
  // Every 30 s, as the tick passes every zone each second.
  for (let t = 30; t <= seconds; t += 30) {
    w.now = new Date(w.now.getTime() + 30_000);
    await w.tx("demo", (c) => tickTenant(c, w.engine, w.now));
  }
};
const running = () =>
  w.tx("demo", async (c) =>
    Number((await c.query(`SELECT count(*) AS n FROM moments WHERE ended_at IS NULL`)).rows[0]?.n),
  );
const titled = (title: string) =>
  overrides().filter((o) => (o.content as { title?: string } | undefined)?.title === title);

run(
  "puts an open order in the hero with its words and the food box covered, until it closes",
  async () => {
    await deliver(opened());
    const [open] = titled("Pizza order open");
    expect(open).toMatchObject({
      type: "moments.override.started",
      template: "pizza_placed",
      regions: ["hero", "venue_rail", "ticker"],
      covers: ["food_status"],
      content: {
        state: "open",
        seq: 7,
        pizzeria_name: "Demo Pizzeria",
        closes_at: "2026-01-01T18:30:00Z",
      },
    });
    // It holds until the close: its time on the screens is the order's own.
    expect(Date.parse(open?.expires_at as string)).toBeGreaterThanOrEqual(
      Date.parse("2026-01-01T18:30:00Z"),
    );
    await deliver(closed());
    expect(overrides().at(-1)).toMatchObject({
      type: "moments.override.ended",
      reason: "source_ended",
    });
  },
);

run("gives the last call its own hero moment and sound, in place of the open order's", async () => {
  await deliver(opened());
  // Minutes later: the open order has stepped down to the food box.
  await later(420);
  await deliver(closing());
  const ended = overrides().filter((o) => o.type === "moments.override.ended");
  expect(ended).toHaveLength(1);
  const [last] = titled("Last call");
  expect(last).toMatchObject({
    type: "moments.override.started",
    template: "pizza_placed",
    regions: ["hero", "venue_rail", "ticker"],
    covers: ["food_status"],
  });
  await deliver(closed());
  expect(overrides().filter((o) => o.type === "moments.override.ended")).toHaveLength(2);
  const cues = w
    .events("demo")
    .filter((e) => e.type === "moments.sound.played")
    .map((e) => (e.data.sound as { cue: string }).cue);
  expect(cues).toEqual(["pizza.open", "pizza.last_call"]);
});

run(
  "counts down to the estimate while on the way, updated in place, and leaves for Pizza is here",
  async () => {
    await deliver(placed());
    const [way] = titled("On the way");
    expect(way).toMatchObject({
      type: "moments.override.started",
      regions: ["hero", "venue_rail", "ticker"],
      covers: ["food_status"],
      content: { state: "placed", estimate_at: "2026-01-01T18:52:00Z" },
    });
    await deliver(changed());
    expect(overrides().at(-1)).toMatchObject({
      type: "moments.override.changed",
      content: { title: "On the way", estimate_at: "2026-01-01T19:05:00Z" },
    });
    await deliver(arrived());
    const here = overrides().find((o) => o.template === "announcement");
    expect(here).toMatchObject({ covers: ["food_status"], content: { title: "Pizza is here" } });
    expect(overrides().filter((o) => o.type === "moments.override.ended")).toHaveLength(1);
  },
);

run("ends what an order shows when it is cancelled", async () => {
  await deliver(opened());
  await later(420);
  await deliver(closing());
  await deliver(cancelled());
  expect(await running()).toBe(0);
});
