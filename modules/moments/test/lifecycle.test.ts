/**
 * The edges of a moment's and an event's life: the longest TTL, the spotlight's bracket and photo,
 * archiving through `tenants.status.changed` (E10), and the history kept for the event's life and
 * deleted 30 days after archiving (D21).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { handleTenantEvent } from "../src/consumer.js";
import { endAll, upkeep } from "../src/tick.js";
import { DATABASE_URL, freshDatabase } from "./helpers.js";
import { appWorld, json } from "./app.js";
import type { AppWorld } from "./app.js";
import { FIXTURES, event } from "./fixtures.js";

const run = DATABASE_URL ? describe : describe.skip;
const DAY = 86_400_000;

run("a moment's and an event's life", () => {
  let pool: pg.Pool | undefined;
  let w: AppWorld;
  beforeEach(async () => {
    // The world of the test before, if any: both are set together.
    if (pool !== undefined) {
      await w.app.close();
      await pool.end();
    }
    pool = await freshDatabase();
    w = await appWorld(pool);
  });
  afterAll(async () => {
    await w.app.close();
    await pool?.end();
  });

  const deps = () => ({
    db: w.db,
    engine: w.engine,
    flush: () => w.outbox.flush(),
    now: () => w.now,
  });

  it("lives at most 7200 s", async () => {
    const long = { show: "message", title: "Long", duration_seconds: 7200 };
    expect((await w.call("crew", "POST", "/api/moments/spotlight", long)).statusCode).toBe(201);
    const longer = await w.call("crew", "POST", "/api/moments/spotlight", {
      ...long,
      duration_seconds: 7201,
    });
    expect(longer.statusCode).toBe(400);
  });

  it("spotlights a session's bracket, live as its matches finish, and a photo", async () => {
    await w.tx("demo", () => handleTenantEvent(deps(), FIXTURES.called()));
    const r = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "bracket",
      session_id: "ts_1",
    });
    expect(json(r).content).toMatchObject({
      title: "Demo Game",
      session: { id: "ts_1", game_name: "Demo Game" },
      matches: [{ label: "Heat 1", state: "called", results: [] }],
      from_crew: true,
    });
    await w.tx("demo", () => handleTenantEvent(deps(), FIXTURES.finished(false)));
    const changed = w
      .events("demo")
      .filter((e) => e.type === "moments.override.changed")
      .at(-1);
    expect((changed?.data.override as { content: unknown }).content).toMatchObject({
      matches: [{ results: [{ rank: 1, names: ["Demo Player 2"], points: 38 }, { rank: 2 }] }],
    });
    const photo = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "photo",
      photo_url: "/screen/files/demo/photo.jpg",
      caption: "The team",
    });
    expect(json(photo)).toMatchObject({
      template: "photo",
      content: {
        url: "/screen/files/demo/photo.jpg",
        caption: "The team",
        tiles: [{ caption: "The team" }],
      },
    });
  });

  it("ends every moment when the event is archived, and deletes its history 30 days later", async () => {
    await w.call("admin", "POST", "/api/moments/emergency", {});
    const archived = event("tenants.status.changed", {
      from: "live",
      to: "archived",
      actor_user_id: null,
    });
    await w.tx("demo", () => handleTenantEvent(deps(), archived));
    const ended = w.events("demo").filter((e) => e.type === "moments.override.ended");
    expect(ended.map((e) => e.data.reason)).toEqual(["source_ended"]);
    const rows = async () =>
      (await w.tx("demo", (c) => c.query(`SELECT 1 FROM moments_history`))).rows.length;
    expect(await rows()).toBeGreaterThan(0);
    await upkeep(w.db, new Date(w.now.getTime() + 29 * DAY));
    expect(await rows()).toBeGreaterThan(0);
    await upkeep(w.db, new Date(w.now.getTime() + 30 * DAY));
    expect(await rows()).toBe(0);
  });

  it("starts no rule's moment and keeps no source on an archived event (E10)", async () => {
    const archived = event("tenants.status.changed", {
      from: "live",
      to: "archived",
      actor_user_id: null,
    });
    await w.tx("demo", () => handleTenantEvent(deps(), archived));
    await w.tx("demo", () => handleTenantEvent(deps(), FIXTURES.surge()));
    await w.tx("demo", () => handleTenantEvent(deps(), FIXTURES.called()));
    expect(w.events("demo").filter((e) => e.type === "moments.override.started")).toEqual([]);
    const sources = await w.tx("demo", (c) => c.query(`SELECT 1 FROM moments_sources`));
    expect(sources.rows).toEqual([]);
  });

  it("forgets crew actions' keys after 24 hours", async () => {
    await w.call("crew", "POST", "/api/moments/spotlight", { show: "message", title: "Keyed" });
    const keys = async () =>
      (await w.tx("demo", (c) => c.query(`SELECT 1 FROM moments_idempotency`))).rows.length;
    await upkeep(w.db, new Date(w.now.getTime() + DAY - 1000));
    expect(await keys()).toBe(1);
    await upkeep(w.db, new Date(w.now.getTime() + DAY + 1000));
    expect(await keys()).toBe(0);
  });

  /** Holds the emergency row locked from a second connection, as a claims report does. */
  async function holdEmergency(db: pg.Pool) {
    const holder = await db.connect();
    await holder.query("BEGIN");
    await holder.query("SELECT 1 FROM moments WHERE class = 'emergency' FOR UPDATE");
    return {
      release: async () => {
        await holder.query("COMMIT");
        holder.release();
      },
    };
  }
  const settles = async (p: Promise<unknown>): Promise<boolean> =>
    Promise.race([
      p.then(() => true),
      new Promise<boolean>((r) => {
        setTimeout(() => {
          r(false);
        }, 400);
      }),
    ]);

  it("ends the emergency even while another transaction holds its row, waiting for it", async () => {
    expect((await w.call("admin", "POST", "/api/moments/emergency", {})).statusCode).toBe(201);
    const held = await holdEmergency(pool as pg.Pool);
    const ending = w.call("admin", "POST", "/api/moments/emergency/end", {});
    expect(await settles(ending)).toBe(false);
    await held.release();
    expect((await ending).statusCode).toBe(200);
    const left = await w.tx("demo", (c) => c.query("SELECT 1 FROM moments WHERE ended_at IS NULL"));
    expect(left.rows).toHaveLength(0);
  });

  it("ends every moment at archive even while another transaction holds the emergency", async () => {
    expect((await w.call("admin", "POST", "/api/moments/emergency", {})).statusCode).toBe(201);
    const held = await holdEmergency(pool as pg.Pool);
    const ending = w.tx("demo", (c) => endAll(c, w.engine, w.now));
    expect(await settles(ending)).toBe(false);
    await held.release();
    await ending;
    const left = await w.tx("demo", (c) => c.query("SELECT 1 FROM moments WHERE ended_at IS NULL"));
    expect(left.rows).toHaveLength(0);
  });

  it("lets only one of two concurrent emergency starts through", async () => {
    const both = await Promise.all([
      w.call("admin", "POST", "/api/moments/emergency", {}),
      w.call("admin", "POST", "/api/moments/emergency", {}),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const { rows } = await w.tx("demo", (c) =>
      c.query("SELECT 1 FROM moments WHERE class = 'emergency' AND ended_at IS NULL"),
    );
    expect(rows).toHaveLength(1);
  });
});
