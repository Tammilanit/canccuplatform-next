/**
 * What Moments catches up after a restart (#611, E2, E10): Screen's placements reported while it
 * was down, from the replay of Screen's streams, and an event archived meanwhile, from the tick.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { handleTenantEvent, handleZoneReplay } from "../src/consumer.js";
import type { MomentRequest } from "../src/engine.js";
import { lockMoment } from "../src/store.js";
import { StatusTicker, tickAll, tickTenant } from "../src/tick.js";
import { DATABASE_URL, T0, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { event } from "./fixtures.js";

const run = DATABASE_URL ? describe : describe.skip;

const hotGame: MomentRequest = {
  class: "hot_game",
  template: "hot_game",
  content: { game: { id: "g_1", name: "Demo Game", cover_url: null }, players: 14, since: null },
  origin: "rule",
  rule_id: "hot_game",
  why: "rule: games.surge.started",
  dedupe_key: "hot_game:g_1",
  // Longer than a rule's patience of 120 s, so only patience could end it at 120 s.
  ttl_seconds: 600,
};

run("catching up after a restart", () => {
  let pool: pg.Pool | undefined;
  let w: World;
  beforeEach(async () => {
    if (pool !== undefined) await pool.end();
    pool = await freshDatabase();
    w = world(pool);
    await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main')`));
  });
  afterAll(async () => {
    await pool?.end();
  });

  const deps = () => ({
    db: w.db,
    engine: w.engine,
    flush: () => w.outbox.flush(),
    now: () => w.now,
  });
  const start = async () => {
    const r = await w.tx("demo", (c) => w.engine.request(c, hotGame, w.at(0)));
    if (r.status === "refused") throw new Error("refused");
    return r.moment.id;
  };
  const report = (id: string, placed: boolean) =>
    event("screen.claims.changed", {
      zone_key: "main",
      placed: placed ? [{ override_id: id, role: "hero" }] : [],
      unplaced: placed ? [] : [id],
      hidden: [],
    });
  const placement = async (id: string) =>
    (
      await w.tx("demo", (c) =>
        c.query(`SELECT state FROM moment_placements WHERE moment_id = $1`, [id]),
      )
    ).rows[0]?.state as string | undefined;

  it("applies a placement Screen reported while Moments restarted, so patience never ends it", async () => {
    const id = await start();
    const waiting = report(id, false);
    await w.tx("demo", () => handleTenantEvent(deps(), waiting));
    expect(await placement(id)).toBe("unplaced");
    // Moments restarts at 30 s; Screen places the moment at 35 s; the live subscription starts
    // from "now" at 40 s and never sees it, the replay of Screen's stream does.
    w.restart();
    const placed = report(id, true);
    w.now = w.at(40);
    await w.tx("demo", () => handleZoneReplay(deps(), waiting));
    await w.tx("demo", () => handleZoneReplay(deps(), placed));
    expect(await placement(id)).toBe("placed");
    // A report replayed again, or an older one, changes nothing.
    await w.tx("demo", () => handleZoneReplay(deps(), waiting));
    expect(await placement(id)).toBe("placed");
    await w.tx("demo", (c) => tickTenant(c, w.engine, w.at(120)));
    const m = await w.tx("demo", (c) => lockMoment(c, id));
    expect(m?.ended_at).toBeNull();
  });

  it("catches up a zone whose key was removed and saved again in Screen's past (#611)", async () => {
    const id = await start();
    const waiting = report(id, false);
    await w.tx("demo", () => handleTenantEvent(deps(), waiting));
    w.restart();
    const placed = report(id, true);
    w.now = w.at(40);
    // The whole stream replays at boot: removed, saved, the live-applied report, the downtime one.
    const removed = event("screen.zone.removed", { zone_key: "main" });
    const saved = event("screen.zone.saved", { zone_key: "main" });
    for (const e of [removed, saved, waiting, placed])
      await w.tx("demo", () => handleZoneReplay(deps(), e));
    expect(await placement(id)).toBe("placed");
  });

  it("ends every moment of an event archived while Moments was down, on the tick", async () => {
    const id = await start();
    const status = new Map([["demo", "live"]]);
    const statuses = new StatusTicker((t) => Promise.resolve(status.get(t) ?? null));
    const tick = () => tickAll({ ...deps(), statuses });
    w.now = w.at(1);
    await tick();
    expect((await w.tx("demo", (c) => lockMoment(c, id)))?.ended_at).toBeNull();
    status.set("demo", "archived");
    w.now = w.at(2);
    await tick();
    // Read at most once a minute per event.
    expect((await w.tx("demo", (c) => lockMoment(c, id)))?.ended_at).toBeNull();
    w.now = w.at(62);
    await tick();
    const m = await w.tx("demo", (c) => lockMoment(c, id));
    expect(m?.end_reason).toBe("source_ended");
    const { rows } = await w.pool.query(
      `SELECT archived_at FROM moments_tenants WHERE tenant_id = 'demo'`,
    );
    expect((rows[0] as { archived_at: Date | null }).archived_at?.getTime()).toBe(
      T0.getTime() + 62_000,
    );
  });
});
