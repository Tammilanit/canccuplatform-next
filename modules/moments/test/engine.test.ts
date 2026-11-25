/**
 * The arbiter on Postgres: the legacy directive rules ported (TTL, re-post extends, revert), one
 * override per moment and zone (#777; the queue, floor and clock are airtime.test.ts's), a
 * priority change that re-ranks live, archiving, and a takeover that ends on time across a restart.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEFAULT_ORDER } from "../src/arbiter.js";
import type { MomentRequest } from "../src/engine.js";
import { applyClaims } from "../src/placements.js";
import { endAll, reRank, tickTenant, zoneRemoved } from "../src/tick.js";
import { lockMoment } from "../src/store.js";
import { DATABASE_URL, T0, claims, freshDatabase, types, world } from "./helpers.js";
import type { World } from "./helpers.js";

const run = DATABASE_URL ? describe : describe.skip;

const hotGame = (players = 14): MomentRequest => ({
  class: "hot_game",
  template: "hot_game",
  content: {
    game: { id: "g_1", name: "Demo Game", cover_url: null },
    players,
    since: T0.toISOString(),
  },
  origin: "rule",
  rule_id: "hot_game",
  why: "rule: games.surge.started",
  dedupe_key: "hot_game:g_1",
});
const standings: MomentRequest = {
  class: "tournament",
  template: "leaderboard",
  content: { title: "Demo Game Cup", rows: [] },
  origin: "rule",
  why: "rule: tournament.leaderboard.changed",
  dedupe_key: "standings:",
};
const takeover: MomentRequest = {
  class: "spotlight",
  kind: "takeover",
  regions: ["full"],
  template: "announcement",
  content: { title: "Demo takeover", body: "", level: "info", starts_at: T0.toISOString() },
  origin: "crew",
  why: "Demo Crew · spotlight",
  ttl_seconds: 60,
  actor: { user_id: "u_crew", name: "Demo Crew" },
};

run("the arbiter", () => {
  let pool: pg.Pool | undefined;
  let w: World;
  beforeEach(async () => {
    if (pool !== undefined) await pool.end();
    pool = await freshDatabase();
    w = world(pool);
    await w.tx("demo", async (c) => {
      await c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main'), ('stage')`);
    });
  });
  afterAll(async () => {
    await pool?.end();
  });

  const start = (r: MomentRequest, s = 0) => w.tx("demo", (c) => w.engine.request(c, r, w.at(s)));
  const report = (r: ReturnType<typeof claims>, s = 0) =>
    w.tx("demo", (c) => applyClaims(c, r, w.at(s)));
  const tick = (s: number) => w.tx("demo", (c) => tickTenant(c, w.engine, w.at(s)));
  const history = async () =>
    (
      await w.tx("demo", (c) =>
        c.query(
          `SELECT action, zone_key, region, outcome, displaced FROM moments_history ORDER BY seq`,
        ),
      )
    ).rows;

  it("starts a moment on every zone with the default TTL of 120 s", async () => {
    const r = await start(hotGame());
    expect(r.status).toBe("started");
    const [started, stage] = w.events("demo");
    expect(started?.type).toBe("moments.override.started");
    expect(stage?.data.override).toMatchObject({
      id: `${r.status === "started" ? r.moment.id : ""}.stage`,
    });
    expect(started?.data.override).toMatchObject({
      zones: ["main"],
      rank: 50,
      kind: "block",
      regions: ["hero", "rail"],
      expires_at: w.at(120).toISOString(),
      starts_at: T0.toISOString(),
    });
  });

  it("extends a moment when the same content is posted again, and writes no history for it (E4)", async () => {
    await start(hotGame());
    const before = (await history()).length;
    const again = await start(hotGame(), 30);
    expect(again.status).toBe("renewed");
    const last = w.events("demo").at(-1);
    expect(last?.type).toBe("moments.override.changed");
    expect(last?.data.changed).toEqual(["expires_at"]);
    expect((last?.data.override as Record<string, unknown>).expires_at).toBe(
      w.at(150).toISOString(),
    );
    expect((last?.data.override as Record<string, unknown>).starts_at).toBe(T0.toISOString());
    expect(await history()).toHaveLength(before);
  });

  // #611: a renewal never brings the end nearer, so the crew's Extend survives it.
  it("keeps a crew's Extend through a renewal, and a moment's own TTL when the request has none", async () => {
    const r = await start(hotGame());
    if (r.status === "refused") throw new Error("refused");
    await w.tx("demo", (c) =>
      w.engine.extend(c, r.moment, 3600, { user_id: "u_crew", name: "Demo Crew" }, w.at(10)),
    );
    await start(hotGame(), 60);
    const expiresAt = async (id: string) =>
      (await w.tx("demo", (c) => lockMoment(c, id)))?.expires_at?.toISOString();
    expect(await expiresAt(r.moment.id)).toBe(w.at(3720).toISOString());
    const long = await start({ ...hotGame(), dedupe_key: "hot_game:g_2", ttl_seconds: 3600 }, 0);
    if (long.status === "refused") throw new Error("refused");
    await start({ ...hotGame(), dedupe_key: "hot_game:g_2" }, 100);
    // It waits behind the first (#777): its on-air time, not a wall-clock end, is what stays.
    const { rows } = await w.tx("demo", (c) =>
      c.query(`SELECT budget_ms FROM moment_slots WHERE moment_id = $1`, [long.moment.id]),
    );
    expect(rows.map((x) => Number(x.budget_ms))).toEqual([3_600_000, 3_600_000]);
  });

  it("updates the content in place when the same rule posts something new", async () => {
    await start(hotGame(14));
    await start(hotGame(20), 10);
    const last = w.events("demo").at(-1);
    expect(last?.data.changed).toEqual(expect.arrayContaining(["content", "expires_at"]));
    expect((await history()).map((h) => h.action)).toContain("changed");
  });

  it("shares regions: a lower moment is accepted where a region of its chain is free", async () => {
    const top = await start({ ...standings, regions: ["hero"] });
    if (top.status === "refused") throw new Error("refused");
    await report(claims("main", [[`${top.moment.id}.main`, "hero"]]));
    await report(claims("stage", [[`${top.moment.id}.stage`, "hero"]]));
    const r = await start(hotGame());
    expect(r.status).toBe("started");
    if (r.status === "refused") return;
    await report(
      claims("main", [
        [`${top.moment.id}.main`, "hero"],
        [`${r.moment.id}.main`, "rail"],
      ]),
    );
    const placed = (await history()).filter((h) => h.action === "placed");
    expect(placed.map((h) => [h.zone_key, h.region])).toContainEqual(["main", "rail"]);
  });

  it("never refuses people's moments: they wait", async () => {
    const top = await start({ ...takeover, ttl_seconds: 600 });
    if (top.status === "refused") throw new Error("refused");
    await report(claims("main", [[top.moment.id, "full"]]));
    await report(claims("stage", [[top.moment.id, "full"]]));
    const r = await start({ ...takeover, class: "announcement", regions: ["rail"], kind: "block" });
    expect(r.status).toBe("started");
  });

  it("brings the moment a crew takeover pushed aside back after it, with its time left", async () => {
    const low = await start(hotGame());
    const top = await start(takeover, 10);
    if (low.status === "refused" || top.status === "refused") throw new Error("refused");
    // Its chain has the rail: it waits there while the crew's takeover holds the screen (rule 4).
    const aside = w
      .events("demo")
      .filter(
        (e) => (e.data.override as { id?: string } | undefined)?.id === `${low.moment.id}.main`,
      );
    expect(aside.at(-1)?.data.override).toMatchObject({ regions: ["rail"] });
    await tick(70);
    expect(
      w
        .events("demo")
        .some(
          (e) =>
            e.type === "moments.override.ended" && e.data.override_id === `${top.moment.id}.main`,
        ),
    ).toBe(true);
    await tick(80);
    const back = w
      .events("demo")
      .filter(
        (e) => (e.data.override as { id?: string } | undefined)?.id === `${low.moment.id}.main`,
      );
    expect(back.at(-1)?.data.override).toMatchObject({
      regions: ["hero", "rail"],
      expires_at: w.at(190).toISOString(),
    });
  });

  it("ends a crew takeover on time across a restart (E2)", async () => {
    const low = await start(hotGame());
    const top = await start(takeover);
    if (low.status === "refused" || top.status === "refused") throw new Error("refused");
    w.restart();
    await tick(59);
    const ends = () =>
      w
        .events("demo")
        .filter(
          (e) =>
            e.type === "moments.override.ended" &&
            String(e.data.override_id).startsWith(top.moment.id),
        );
    expect(ends()).toEqual([]);
    await tick(60);
    expect(ends().map((e) => e.data.override_id)).toEqual([
      `${top.moment.id}.main`,
      `${top.moment.id}.stage`,
    ]);
    const lowNow = await w.tx("demo", (c) => lockMoment(c, low.moment.id));
    expect(lowNow?.ended_at).toBeNull();
  });

  it("ranks every running moment again when the order changes, and ends none (E8)", async () => {
    const r = await start(hotGame());
    if (r.status === "refused") throw new Error("refused");
    const order = [...DEFAULT_ORDER];
    order.splice(order.indexOf("hot_game"), 1);
    order.splice(1, 0, "hot_game");
    await w.tx("demo", async (c) => {
      await c.query(
        `INSERT INTO moments_priorities (event_order, zone_orders, revision) VALUES ($1, '{}', 1)`,
        [order],
      );
      await reRank(c, w.engine, w.at(5));
    });
    const last = w.events("demo").at(-1);
    expect(last).toMatchObject({ type: "moments.override.changed", data: { changed: ["rank"] } });
    expect((last?.data.override as Record<string, unknown>).rank).toBe(90);
    expect(types(w.events("demo"))).not.toContain("moments.override.ended");
  });

  it("gives a zone with its own order its own rank on its override", async () => {
    const r = await start(hotGame());
    if (r.status === "refused") throw new Error("refused");
    const stage = ["emergency", ...DEFAULT_ORDER.slice(1).reverse()];
    await w.tx("demo", async (c) => {
      await c.query(
        `INSERT INTO moments_priorities (event_order, zone_orders, revision) VALUES ($1, $2, 1)`,
        [DEFAULT_ORDER, { stage }],
      );
      await reRank(c, w.engine, w.at(5));
    });
    const after = w.events("demo").slice(2);
    expect(after.map((e) => [e.type, (e.data.override as { id: string }).id])).toEqual([
      ["moments.override.changed", `${r.moment.id}.stage`],
    ]);
    expect(after[0]?.data).toMatchObject({ changed: ["rank"], override: { rank: 70 } });
  });

  it("ends a moment on one zone only (End in zone), and on a removed zone (E9)", async () => {
    const r = await start(hotGame());
    if (r.status === "refused") throw new Error("refused");
    await w.tx("demo", async (c) => {
      const m = await lockMoment(c, r.moment.id);
      if (m)
        await w.engine.end(c, m, "cleared", { user_id: "u_1", name: "Demo Crew" }, w.at(5), "main");
    });
    expect(w.events("demo").at(-1)?.data).toMatchObject({
      override_id: `${r.moment.id}.main`,
      zones: ["main"],
      final: true,
    });
    await w.tx("demo", (c) => zoneRemoved(c, w.engine, "stage", w.at(6)));
    expect(w.events("demo").at(-1)?.data).toMatchObject({
      override_id: `${r.moment.id}.stage`,
      zones: ["stage"],
      reason: "source_ended",
      final: true,
    });
  });

  it("ends every moment, the emergency included, when the event is archived (E10)", async () => {
    await start(hotGame());
    await start({ ...takeover, class: "emergency", origin: "emergency", ttl_seconds: null });
    await w.tx("demo", (c) => endAll(c, w.engine, w.at(10)));
    const ended = w.events("demo").filter((e) => e.type === "moments.override.ended");
    expect(ended.map((e) => e.data.reason)).toEqual([
      "source_ended",
      "source_ended",
      "source_ended",
    ]);
    expect(ended.every((e) => e.data.final === true)).toBe(true);
  });
});
