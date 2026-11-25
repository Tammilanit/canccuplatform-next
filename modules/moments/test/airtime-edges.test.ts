/**
 * The airtime scheduler's edges on Postgres (#777): a paused holder keeps its claim, a moment
 * nobody sees still goes stale, moments running at the deploy are adopted (plan D19), and a
 * condensed round made in a pass that also ends something plays as one round.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import type { Event } from "@canccu/kit";
import type { MomentRequest } from "../src/engine.js";
import { DEFAULT_ORDERS } from "../src/arbiter.js";
import { applyClaims } from "../src/placements.js";
import { tickTenant } from "../src/tick.js";
import { lockMoment } from "../src/store.js";
import { DATABASE_URL, claims, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";

const run = DATABASE_URL ? describe : describe.skip;

const card: MomentRequest = {
  class: "finals",
  template: "winner_card",
  content: { title: "Demo Cup: champion", names: ["Demo Team"], points: 3, image_url: null },
  origin: "rule",
  rule_id: "finals_result",
  why: "rule: tournament.match.finished",
  regions: ["hero"],
  ttl_seconds: 120,
  dedupe_key: "finals_result:m_1",
};
const pizza: MomentRequest = {
  class: "announcement",
  template: "announcement",
  content: {
    title: "Pizza is here",
    body: "Order 12",
    level: "info",
    ticker_line: "Pizza is here",
  },
  origin: "rule",
  rule_id: "pizza",
  why: "rule: pizza.order.arrived",
  regions: ["hero", "rail", "ticker"],
  ttl_seconds: 180,
  dedupe_key: "pizza:o_12:arrived",
};
const hot = (n: number): MomentRequest => ({
  class: "hot_game",
  template: "hot_game",
  content: { game: { id: `g_${String(n)}`, name: `Game ${String(n)}` }, players: 10 + n },
  origin: "rule",
  rule_id: "hot_game",
  why: "rule: games.surge.started",
  regions: ["hero", "rail"],
  dedupe_key: `hot_game:g_${String(n)}`,
});

run("airtime edges (#777)", () => {
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

  const start = async (r: MomentRequest, s = 0) => {
    const a = await w.tx("demo", (c) => w.engine.request(c, r, w.at(s)));
    if (a.status === "refused") throw new Error("refused");
    return a.moment;
  };
  const report = (s: number, placed: [string, string][], unplaced: string[], hidden: string[]) =>
    w.tx("demo", (c) =>
      applyClaims(c, claims("main", placed, unplaced, hidden), w.at(s), w.engine),
    );
  const tick = (s: number) => w.tx("demo", (c) => tickTenant(c, w.engine, w.at(s)));
  const of = (id: string, from = 0) =>
    w
      .events("demo")
      .slice(from)
      .filter((e: Event) => {
        const o = (e.data.override ?? {}) as Record<string, unknown>;
        return o.id === id || e.data.override_id === id;
      });
  const lastOverride = (id: string) =>
    of(id)
      .filter((e) => e.type !== "moments.override.ended")
      .at(-1)?.data.override as Record<string, unknown> | undefined;
  const row = (id: string) => w.tx("demo", (c) => lockMoment(c, id));
  const secondsLeft = (id: string, s: number) =>
    (Date.parse(lastOverride(id)?.expires_at as string) - w.at(s).getTime()) / 1000;

  it("a holder hidden past its stale time comes back with its remaining time", async () => {
    const p = await start(pizza, 0);
    await report(0, [[`${p.id}.main`, "hero"]], [], []);
    await report(10, [], [], [`${p.id}.main`]);
    // No end of its own while paused: Screen would drop the claim at it, for good.
    expect(lastOverride(`${p.id}.main`)?.expires_at).toBeNull();
    await tick(1850);
    expect((await row(p.id))?.ended_at).toBeNull();
    await report(1900, [[`${p.id}.main`, "hero"]], [], []);
    expect(secondsLeft(`${p.id}.main`, 1900)).toBeCloseTo(170, 0);
  });

  it("a ticker-only moment Screen leaves unplaced, or never places, goes stale", async () => {
    const ticker = (key: string): MomentRequest => ({
      ...pizza,
      regions: ["ticker"],
      ttl_seconds: null,
      dedupe_key: key,
    });
    const unplaced = await start(ticker("a"), 0);
    const never = await start(ticker("b"), 0);
    const shown = await start(ticker("c"), 0);
    await report(1, [[`${shown.id}.main`, "ticker"]], [`${unplaced.id}.main`], []);
    await tick(1799);
    for (const m of [unplaced, never, shown]) expect((await row(m.id))?.ended_at).toBeNull();
    await tick(1800);
    expect((await row(unplaced.id))?.end_reason).toBe("stale");
    expect((await row(never.id))?.end_reason).toBe("stale");
    expect((await row(shown.id))?.ended_at).toBeNull();
  });

  it("a placed ticker moment hidden past its stale time keeps its remaining time", async () => {
    const t = await start({ ...pizza, regions: ["ticker"], ttl_seconds: 3600, dedupe_key: "t" }, 0);
    await report(1, [[`${t.id}.main`, "ticker"]], [], []);
    await tick(1900);
    await report(1900, [], [], [`${t.id}.main`]);
    await tick(1901);
    expect((await row(t.id))?.ended_at).toBeNull();
  });

  it("adopts a moment on every zone it covers and ends its old override after the last", async () => {
    await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ('side')`));
    const a = await start({ ...card, ttl_seconds: 300 }, 0);
    await w.tx("demo", async (c) => {
      await c.query(`DELETE FROM moment_slots`);
      await c.query(`DELETE FROM moments_zone_air`);
      await c.query(`DELETE FROM moment_placements`);
      await c.query(`DELETE FROM moment_overrides`);
      await c.query(`UPDATE moments SET expires_at = $1, fresh_at = NULL`, [w.at(100)]);
      await c.query(
        `INSERT INTO moment_overrides (override_id, moment_id, sent)
         SELECT id, id, jsonb_build_object('id', id, 'kind', kind, 'zones', '[]'::jsonb,
           'rank', 50, 'template', template, 'content', content, 'regions', to_jsonb(regions),
           'expires_at', $1::text)
         FROM moments`,
        [w.at(100).toISOString()],
      );
    });
    const from = w.events("demo").length;
    await tick(10);
    expect(secondsLeft(`${a.id}.main`, 10)).toBeCloseTo(90, 0);
    expect(secondsLeft(`${a.id}.side`, 10)).toBeCloseTo(90, 0);
    const events = w.events("demo").slice(from);
    const idx = (f: (e: Event) => boolean) => events.findIndex(f);
    const startOf = (z: string) =>
      idx((e) => (e.data.override as Record<string, unknown> | undefined)?.id === `${a.id}.${z}`);
    const ended = idx((e) => e.data.override_id === a.id);
    expect(ended).toBeGreaterThan(Math.max(startOf("main"), startOf("side")));
  });

  it("adopts moments running at the deploy: the hero stays, the old override ends after", async () => {
    const a = await start({ ...hot(1), ttl_seconds: 300 }, 0);
    const b = await start({ ...card, ttl_seconds: 300 }, 0);
    // As #777's deploy finds them: one `<id>` override each on every zone, no slots, and Screen
    // showing the lower-ranked hot game in the hero.
    await w.tx("demo", async (c) => {
      await c.query(`DELETE FROM moment_slots`);
      await c.query(`DELETE FROM moments_zone_air`);
      await c.query(`DELETE FROM moment_placements`);
      await c.query(`DELETE FROM moment_overrides`);
      await c.query(`UPDATE moments SET expires_at = $1, fresh_at = NULL`, [w.at(100)]);
      await c.query(
        `INSERT INTO moment_overrides (override_id, moment_id, sent)
         SELECT id, id, jsonb_build_object('id', id, 'kind', kind, 'zones', '[]'::jsonb,
           'rank', 50, 'template', template, 'content', content, 'regions', to_jsonb(regions),
           'expires_at', $1::text)
         FROM moments`,
        [w.at(100).toISOString()],
      );
      await c.query(
        `INSERT INTO moment_placements (override_id, zone_key, moment_id, state, role, since,
           placed_once)
         VALUES ($1, 'main', $1, 'placed', 'hero', $2, true)`,
        [a.id, w.at(0)],
      );
    });
    const from = w.events("demo").length;
    await tick(10);
    const types = (id: string) => of(id, from).map((e) => e.type);
    expect(lastOverride(`${a.id}.main`)).toMatchObject({ regions: ["hero", "rail"] });
    expect(types(`${a.id}.main`)).toEqual(["moments.override.started"]);
    expect(secondsLeft(`${a.id}.main`, 10)).toBeCloseTo(90, 0);
    const events = w.events("demo").slice(from);
    const started = events.findIndex(
      (e) => (e.data.override as Record<string, unknown> | undefined)?.id === `${a.id}.main`,
    );
    const ended = events.findIndex((e) => e.data.override_id === a.id);
    expect(started).toBeGreaterThanOrEqual(0);
    expect(ended).toBeGreaterThan(started);
    expect(events[ended]?.data).toMatchObject({ final: true, zones: [] });
    // The card waits its turn behind the floor; its old override ends too.
    expect(of(`${b.id}.main`, from)).toEqual([]);
    expect(of(b.id, from).map((e) => e.data.final)).toEqual([true]);
    // Ending a moment takes no old override along any more: there is none left.
    const { rows } = await w.tx("demo", (c) =>
      c.query(`SELECT override_id FROM moment_overrides WHERE NOT ended ORDER BY override_id`),
    );
    expect(rows.map((r) => r.override_id)).toEqual([`${a.id}.main`]);
  });

  it("a condensed round made as the holder runs out plays as one round (gap 0)", async () => {
    await w.tx("demo", (c) =>
      c.query(
        `INSERT INTO moments_priorities (event_order, zone_orders, revision, airtime)
         VALUES ($1, '{}', 1, '{"gap_seconds": 0}')`,
        [DEFAULT_ORDERS.order],
      ),
    );
    const c = await start({ ...card, ttl_seconds: 60 }, 0);
    await report(0, [[`${c.id}.main`, "hero"]], [], []);
    const hots = [];
    for (const n of [1, 2, 3, 4, 5]) hots.push(await start(hot(n), n));
    await tick(60);
    const first = (hots[0] as { id: string }).id;
    const round = lastOverride(`${first}.main.2`);
    expect(round).toMatchObject({ regions: ["hero", "rail"], starts_at: w.at(60).toISOString() });
    expect((round?.steps as Record<string, unknown>[]).map((s) => s.duration_ms)).toEqual([
      18000, 18000, 18000, 18000, 18000,
    ]);
    await tick(149);
    expect((await row((hots[4] as { id: string }).id))?.ended_at).toBeNull();
    await tick(150);
    for (const h of hots) expect((await row(h.id))?.end_reason).toBe("expired");
  });
});
