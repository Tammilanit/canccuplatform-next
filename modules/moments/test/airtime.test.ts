/**
 * Airtime that is seen and nothing left out (#777) on Postgres: the floor, the paused clock, the
 * queue instead of a drop, the rail as the waiting room, updates that replace, condensing, and
 * the hero given once across containers and restarts.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import type { Event } from "@canccu/kit";
import type { MomentRequest } from "../src/engine.js";
import { applyClaims } from "../src/placements.js";
import { tickTenant } from "../src/tick.js";
import { lockMoment } from "../src/store.js";
import { DATABASE_URL, T0, claims, freshDatabase, world } from "./helpers.js";
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
  content: { title: "Pizza is here", body: "Order 12", level: "info", ticker_line: "Pizza is here" },
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

run("airtime (#777)", () => {
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
  const placed = (ids: [string, string][], s: number, hidden: string[] = []) =>
    w.tx("demo", (c) => applyClaims(c, claims("main", ids, [], hidden), w.at(s), w.engine));
  const tick = (s: number) => w.tx("demo", (c) => tickTenant(c, w.engine, w.at(s)));
  const of = (id: string) =>
    w.events("demo").filter((e: Event) => {
      const o = (e.data.override ?? {}) as Record<string, unknown>;
      return o.id === id || e.data.override_id === id;
    });
  const lastOverride = (id: string) =>
    of(id)
      .filter((e) => e.type !== "moments.override.ended")
      .at(-1)?.data.override as Record<string, unknown> | undefined;
  const ended = (id: string) => of(id).some((e) => e.type === "moments.override.ended");
  const row = (id: string) => w.tx("demo", (c) => lockMoment(c, id));
  const secondsLeft = (id: string, s: number) =>
    (Date.parse(lastOverride(id)?.expires_at as string) - w.at(s).getTime()) / 1000;

  /** The card on the hero from 0, and Pizza is here asking at 5 s. */
  async function cardThenPizza(pizzaTtl = 180) {
    const c = await start(card, 0);
    await placed([[`${c.id}.main`, "hero"]], 0);
    const p = await start({ ...pizza, ttl_seconds: pizzaTtl }, 5);
    return { c, p };
  }

  it("the 90 s floor holds against a higher rank", async () => {
    const { c, p } = await cardThenPizza();
    expect(lastOverride(`${c.id}.main`)).toMatchObject({ regions: ["hero"], zones: ["main"] });
    expect(lastOverride(`${p.id}.main`)).toMatchObject({ regions: ["rail", "ticker"] });
    await tick(89);
    expect(ended(`${c.id}.main`)).toBe(false);
    await tick(90);
    expect(ended(`${c.id}.main`)).toBe(true);
    await tick(99);
    expect(lastOverride(`${p.id}.main`)).toMatchObject({ regions: ["rail", "ticker"] });
    await tick(100);
    expect(lastOverride(`${p.id}.main`)).toMatchObject({ regions: ["hero", "rail", "ticker"] });
  });

  it("an emergency still cuts in, and the clock pauses under it", async () => {
    const c = await start(card, 0);
    await placed([[`${c.id}.main`, "hero"]], 0);
    await w.tx("demo", (x) =>
      w.engine.request(
        x,
        {
          class: "emergency",
          kind: "takeover",
          regions: ["full"],
          template: "announcement",
          content: { title: "Please leave the hall", body: "", level: "emergency" },
          origin: "emergency",
          why: "emergency",
          ttl_seconds: null,
        },
        w.at(10),
      ),
    );
    await placed([], 10, [`${c.id}.main`]);
    await placed([[`${c.id}.main`, "hero"]], 40);
    expect(secondsLeft(`${c.id}.main`, 40)).toBeCloseTo(110, 0);
  });

  it("a pushed-aside moment comes back with its remaining time", async () => {
    const { c, p } = await cardThenPizza(60);
    await tick(90);
    await tick(100);
    expect(lastOverride(`${p.id}.main`)).toMatchObject({ regions: ["hero", "rail", "ticker"] });
    await tick(160);
    expect(ended(`${p.id}.main`)).toBe(true);
    await tick(170);
    const back = lastOverride(`${c.id}.main.2`);
    expect(back).toMatchObject({ regions: ["hero"] });
    expect(secondsLeft(`${c.id}.main.2`, 170)).toBeCloseTo(30, 0);
    expect(Date.parse(back?.starts_at as string)).toBe(w.at(80).getTime());
  });

  it("nothing is dropped before stale_after or source_ended", async () => {
    const c = await start({ ...card, ttl_seconds: null }, 0);
    await placed([[`${c.id}.main`, "hero"]], 0);
    const h = await start(hot(1), 0);
    const s = await start(hot(2), 0);
    await tick(1799);
    expect((await row(h.id))?.ended_at).toBeNull();
    await w.tx("demo", async (x) =>
      w.engine.end(x, (await lockMoment(x, s.id))!, "source_ended", null, w.at(1799)),
    );
    expect((await row(s.id))?.end_reason).toBe("source_ended");
    await tick(1800);
    expect((await row(h.id))?.end_reason).toBe("stale");
    expect((await row(c.id))?.ended_at).toBeNull();
    const { rows } = await w.tx("demo", (x) =>
      x.query(`SELECT outcome FROM moments_history WHERE moment_id = $1 AND action = 'ended'`, [
        h.id,
      ]),
    );
    expect(rows).toEqual([{ outcome: "stale" }]);
  });

  it("the rail shows the next in line, and holds the rest back", async () => {
    const { c, p } = await cardThenPizza();
    const h = await start(hot(1), 6);
    expect(lastOverride(`${c.id}.main`)).toMatchObject({ regions: ["hero"] });
    expect(lastOverride(`${p.id}.main`)).toMatchObject({ regions: ["rail", "ticker"] });
    expect(of(`${h.id}.main`)).toEqual([]);
  });

  it("a newer version replaces the queued one", async () => {
    const c = await start(card, 0);
    await placed([[`${c.id}.main`, "hero"]], 0);
    const standings: MomentRequest = {
      class: "tournament",
      template: "leaderboard",
      content: { title: "Cup", rows: [{ rank: 1 }] },
      origin: "rule",
      rule_id: "standings",
      why: "rule",
      regions: ["hero", "rail"],
      dedupe_key: "standings:",
    };
    const first = await start(standings, 10);
    const again = await w.tx("demo", (x) =>
      w.engine.request(x, { ...standings, content: { title: "Cup", rows: [{ rank: 2 }] } }, w.at(20)),
    );
    expect(again.status).toBe("renewed");
    const { rows } = await w.tx("demo", (x) =>
      x.query(`SELECT m.id, m.content, s.queued_since FROM moments m
               JOIN moment_slots s ON s.moment_id = m.id WHERE m.ended_at IS NULL AND m.class = 'tournament'`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, content: { rows: [{ rank: 2 }] } });
    expect((rows[0]?.queued_since as Date).getTime()).toBe(w.at(10).getTime());
  });

  it("routine moments condense past the threshold", async () => {
    const c = await start({ ...card, ttl_seconds: 60 }, 0);
    await placed([[`${c.id}.main`, "hero"]], 0);
    const hots = [];
    for (const n of [1, 2, 3, 4]) hots.push(await start(hot(n), n));
    await tick(60);
    await tick(70);
    const round = lastOverride(`${hots[0]!.id}.main`);
    expect(round).toMatchObject({ regions: ["hero", "rail"] });
    expect((round?.steps as Record<string, unknown>[]).map((s) => s.duration_ms)).toEqual([
      22500, 22500, 22500, 22500,
    ]);
    await tick(159);
    expect((await row(hots[3]!.id))?.ended_at).toBeNull();
    await tick(160);
    for (const h of hots) expect((await row(h.id))?.end_reason).toBe("expired");
  });

  it("a restart keeps the holder and its played time", async () => {
    const { c } = await cardThenPizza();
    const before = w.events("demo").length;
    w.restart();
    await tick(45);
    expect(w.events("demo").length).toBe(before);
    await tick(90);
    expect(ended(`${c.id}.main`)).toBe(true);
  });

  it("ending the holder frees the hero after the gap", async () => {
    const { c, p } = await cardThenPizza();
    await w.tx("demo", async (x) =>
      w.engine.end(x, (await lockMoment(x, c.id))!, "cleared", null, w.at(20)),
    );
    expect(lastOverride(`${p.id}.main`)).toMatchObject({ regions: ["rail", "ticker"] });
    await tick(30);
    expect(lastOverride(`${p.id}.main`)).toMatchObject({ regions: ["hero", "rail", "ticker"] });
  });

  it("Extend adds to the budget of a waiting moment", async () => {
    const { p } = await cardThenPizza();
    await w.tx("demo", async (x) =>
      w.engine.extend(x, (await lockMoment(x, p.id))!, 60, { user_id: "u", name: "Crew" }, w.at(20)),
    );
    await tick(90);
    await tick(100);
    expect(secondsLeft(`${p.id}.main`, 100)).toBeCloseTo(240, 0);
  });

  it("two passes at once give the hero once", async () => {
    const { p } = await cardThenPizza();
    await tick(90);
    await Promise.all([tick(100), tick(100)]);
    const toHero = of(`${p.id}.main`).filter(
      (e) =>
        e.type === "moments.override.changed" &&
        ((e.data.override as Record<string, unknown>).regions as string[])[0] === "hero",
    );
    expect(toHero).toHaveLength(1);
  });

  it("refuses a request only for one owner per happening", async () => {
    await cardThenPizza();
    const again = await w.tx("demo", (x) =>
      w.engine.request(
        x,
        { ...pizza, dedupe_key: "other", happening: "pizza.order.arrived:o_12" },
        w.at(6),
      ),
    );
    expect(again.status).toBe("started");
    const twice = await w.tx("demo", (x) =>
      w.engine.request(
        x,
        { ...pizza, dedupe_key: "third", happening: "pizza.order.arrived:o_12" },
        w.at(7),
      ),
    );
    expect(twice.status).toBe("refused");
  });
});

void T0;
