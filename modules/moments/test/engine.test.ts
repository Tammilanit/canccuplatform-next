/**
 * The arbiter on Postgres: the legacy directive rules ported (TTL, re-post extends, refusal with
 * a 30 s retry, revert), made regional (regions shared, patience, narrowing), a priority change
 * that re-ranks live, archiving, and a takeover that reverts on time across a restart.
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
    const [started] = w.events("demo");
    expect(started?.type).toBe("moments.override.started");
    expect(started?.data.override).toMatchObject({
      zones: [],
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

  it("updates the content in place when the same rule posts something new", async () => {
    await start(hotGame(14));
    await start(hotGame(20), 10);
    const last = w.events("demo").at(-1);
    expect(last?.data.changed).toEqual(expect.arrayContaining(["content", "expires_at"]));
    expect((await history()).map((h) => h.action)).toContain("changed");
  });

  it("refuses a lower rule moment with a 30 s retry when every region it may take is held", async () => {
    const top = await start({ ...standings, regions: ["hero"] });
    const rail = await start({ ...takeover, regions: ["rail"], kind: "block" });
    if (top.status === "refused" || rail.status === "refused") throw new Error("refused");
    for (const zone of ["main", "stage"]) {
      await report(
        claims(zone, [
          [top.moment.id, "hero"],
          [rail.moment.id, "rail"],
        ]),
      );
    }
    const r = await start(hotGame(), 5);
    expect(r).toEqual({
      status: "refused",
      retry_after_seconds: 30,
      held_by: "Demo takeover (rank 70)",
    });
    const refused = (await history()).at(-1);
    expect(refused).toMatchObject({ action: "refused", outcome: "refused, retry in 30 s" });
  });

  it("shares regions: a lower moment is accepted where a region of its chain is free", async () => {
    const top = await start({ ...standings, regions: ["hero"] });
    if (top.status === "refused") throw new Error("refused");
    await report(claims("main", [[top.moment.id, "hero"]]));
    await report(claims("stage", [[top.moment.id, "hero"]]));
    const r = await start(hotGame());
    expect(r.status).toBe("started");
    if (r.status === "refused") return;
    await report(
      claims("main", [
        [top.moment.id, "hero"],
        [r.moment.id, "rail"],
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

  it("brings the moment it held aside back when a takeover ends (revert)", async () => {
    const low = await start(hotGame());
    const top = await start(takeover);
    if (low.status === "refused" || top.status === "refused") throw new Error("refused");
    await report(claims("main", [[low.moment.id, "hero"]]));
    await report(claims("main", [[top.moment.id, "full"]], [], [low.moment.id]), 1);
    await tick(61);
    const ended = w.events("demo").at(-1);
    expect(ended).toMatchObject({
      type: "moments.override.ended",
      data: { override_id: top.moment.id, zones: [], reason: "expired", final: true },
    });
    await report(claims("main", [[low.moment.id, "hero"]]), 62);
    expect((await history()).filter((h) => h.zone_key === "main").map((h) => h.action)).toEqual([
      "placed",
      "placed",
      "hidden",
      "back",
    ]);
  });

  it("reverts a takeover on time across a restart (E2)", async () => {
    const low = await start(hotGame());
    const top = await start(takeover);
    if (low.status === "refused" || top.status === "refused") throw new Error("refused");
    await report(claims("main", [[top.moment.id, "full"]], [], [low.moment.id]));
    w.restart();
    await tick(59);
    expect(types(w.events("demo")).filter((t) => t.endsWith(".ended"))).toEqual([]);
    await tick(60);
    const ended = w.events("demo").filter((e) => e.type === "moments.override.ended");
    expect(ended.map((e) => e.data.override_id)).toEqual([top.moment.id]);
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
      await reRank(c, w.engine);
    });
    const last = w.events("demo").at(-1);
    expect(last).toMatchObject({ type: "moments.override.changed", data: { changed: ["rank"] } });
    expect((last?.data.override as Record<string, unknown>).rank).toBe(90);
    expect(types(w.events("demo"))).not.toContain("moments.override.ended");
  });

  it("splits a zone with its own order into its own override: narrowing, then final: false", async () => {
    const r = await start(hotGame());
    if (r.status === "refused") throw new Error("refused");
    const stage = ["emergency", ...DEFAULT_ORDER.slice(1).reverse()];
    await w.tx("demo", async (c) => {
      await c.query(
        `INSERT INTO moments_priorities (event_order, zone_orders, revision) VALUES ($1, $2, 1)`,
        [DEFAULT_ORDER, { stage }],
      );
      await reRank(c, w.engine);
    });
    const after = w.events("demo").slice(1);
    expect(
      after.map((e) => [e.type, e.data.override_id ?? (e.data.override as { id: string }).id]),
    ).toEqual([
      ["moments.override.started", `${r.moment.id}.stage`],
      ["moments.override.changed", r.moment.id],
      ["moments.override.ended", r.moment.id],
    ]);
    expect(after[1]?.data).toMatchObject({ changed: ["zones"], override: { zones: ["main"] } });
    expect(after[2]?.data).toMatchObject({ zones: ["stage"], final: false });
  });

  it("gives a zone up after its patience while it never had a place there", async () => {
    const r = await start({ ...hotGame(), patience_seconds: 120, ttl_seconds: 600 });
    if (r.status === "refused") throw new Error("refused");
    await report(claims("main", [], [r.moment.id]));
    await report(claims("stage", [[r.moment.id, "hero"]]));
    await tick(119);
    expect(w.events("demo")).toHaveLength(1);
    await tick(120);
    const [, narrowed, ended] = w.events("demo");
    expect(narrowed?.data).toMatchObject({ changed: ["zones"], override: { zones: ["stage"] } });
    expect(ended?.data).toMatchObject({ zones: ["main"], reason: "preempted", final: false });
  });

  it("ends a moment on one zone only (End in zone), and on a removed zone (E9)", async () => {
    const r = await start(hotGame());
    if (r.status === "refused") throw new Error("refused");
    await w.tx("demo", async (c) => {
      const m = await lockMoment(c, r.moment.id);
      if (m)
        await w.engine.end(c, m, "cleared", { user_id: "u_1", name: "Demo Crew" }, w.at(5), "main");
    });
    expect(w.events("demo").at(-1)?.data).toMatchObject({ zones: ["main"], final: false });
    await w.tx("demo", (c) => zoneRemoved(c, w.engine, "stage", w.at(6)));
    expect(w.events("demo").at(-1)?.data).toMatchObject({
      override_id: r.moment.id,
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
    expect(ended.map((e) => e.data.reason)).toEqual(["source_ended", "source_ended"]);
    expect(ended.every((e) => e.data.final === true)).toBe(true);
  });
});
