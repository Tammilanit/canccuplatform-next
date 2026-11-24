/** The built-in rules on fixture events (D7, D8), and live bindings updated through `.changed`. */
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import type { Event } from "@canccu/kit";
import { handleTenantEvent, handleZoneReplay } from "../src/consumer.js";
import { spotlightRequest } from "../src/content.js";
import { applyClaims } from "../src/placements.js";
import { RULE_IDS, checkRule, loadRules } from "../src/rules.js";
import type { RuleView } from "../src/rules.js";
import { lockMoment } from "../src/store.js";
import { tickTenant } from "../src/tick.js";
import { DATABASE_URL, claims, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { FIXTURES } from "./fixtures.js";
import { DEFAULT_SETTINGS, ensureStories, writeStories } from "../src/story/store.js";

// The catalog outlines each event; the games contract, written already, holds its own `data`.
const contract = (name: string): string =>
  readFileSync(new URL(`../../../contracts/${name}`, import.meta.url), "utf8");
const CATALOG = contract("events.md");
const GAMES = contract("games.md");

describe("the fixture events", () => {
  it("carry only the fields the event catalog names for their type", () => {
    const all = [
      FIXTURES.called(),
      FIXTURES.started(),
      FIXTURES.finished(true),
      FIXTURES.leaderboard(1),
      FIXTURES.placed(),
      FIXTURES.arrived(),
      FIXTURES.cancelled(),
      FIXTURES.surge(),
      FIXTURES.surgeEnded(),
    ];
    for (const e of all) {
      const doc = e.type.startsWith("games.") ? GAMES : CATALOG;
      const row = doc.split("\n").find((l) => l.startsWith(`| \`${e.type}\``));
      expect(row, e.type).toBeDefined();
      const fields = (row ?? "").split("|").at(-2) ?? "";
      for (const key of Object.keys(e.data))
        expect(fields, `${e.type}.${key}`).toContain(`\`${key}\``);
    }
  });
});

const run = DATABASE_URL ? describe : describe.skip;

run("the built-in rules", () => {
  let pool: pg.Pool | undefined;
  let w: World;
  beforeEach(async () => {
    if (pool !== undefined) await pool.end();
    pool = await freshDatabase();
    w = world(pool);
    // One override per moment and zone (#777): a moment shows on the zones Moments knows.
    if (!expect.getState().currentTestName?.includes("learns the event's zones"))
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
        ...(e.data.override as Record<string, unknown>),
      }));

  /** The presets Match called, Champion and Pizza orders ready show these happenings while on (SD6): off here. */
  const presetsOff = (keys = ["match_called", "champion"]) =>
    w.tx("demo", async (c) => {
      const doc = await ensureStories(c);
      const stories = doc.stories.map((s) => ({
        ...s,
        enabled: s.enabled && (s.preset === null || !keys.includes(s.preset)),
      }));
      await writeStories(c, stories, DEFAULT_SETTINGS, doc.revision + 1);
    });

  it("leaves a happening to its preset while the preset is on (SD6)", async () => {
    await deliver(FIXTURES.called());
    expect(overrides().map((o) => o.template)).toEqual(["title_card"]);
  });

  it("calls a match into the hero, and ends it when the match starts (E5)", async () => {
    await presetsOff();
    await deliver(FIXTURES.called());
    expect(overrides()[0]).toMatchObject({
      type: "moments.override.started",
      template: "match_called",
      rank: 55,
      regions: ["hero", "rail"],
      source: { module: "tournament", ref: "tm_1" },
      content: {
        label: "Heat 1",
        game_name: "Demo Game",
        teams: [{ name: "Demo Player" }, { name: "Demo Player 2" }],
      },
    });
    await deliver(FIXTURES.started());
    expect(w.events("demo").at(-1)?.data).toMatchObject({ reason: "source_ended", final: true });
  });

  it("shows the champion only for a final", async () => {
    await presetsOff();
    await deliver(FIXTURES.finished(false));
    expect(w.events("demo")).toHaveLength(0);
    await deliver(FIXTURES.finished(true));
    expect(overrides()[0]).toMatchObject({
      template: "winner_card",
      rank: 65,
      content: { title: "Demo Game: champion", names: ["Demo Player 2"], points: 38 },
    });
  });

  // #771: in the venue rail the call-in holds the food box in its own place, so the hall reads the
  // order's state in one box; a layout without a venue rail has it on the ticker.
  it("puts pizza in the venue rail, updates it when it arrives, and ends it when cancelled", async () => {
    await presetsOff(["pizza_arrived"]);
    await deliver(FIXTURES.placed());
    await deliver(FIXTURES.arrived());
    const box = overrides().filter((o) => o.template === "pizza_placed");
    expect(box[0]).toMatchObject({
      type: "moments.override.started",
      rank: 80,
      regions: ["venue_rail", "ticker"],
    });
    expect(box.at(-1)).toMatchObject({
      type: "moments.override.changed",
      content: { state: "arrived" },
    });
    await deliver(FIXTURES.cancelled());
    const ended = w.events("demo").filter((e) => e.type === "moments.override.ended");
    expect(ended.map((e) => e.data.reason)).toEqual(["source_ended", "source_ended"]);
  });

  // #777: Pizza is here is the rule's announcement on the hero, ending on the order's done.
  it("says Pizza is here on the hero, then the rail and the ticker, until the order is done", async () => {
    await deliver(FIXTURES.placed());
    await deliver(FIXTURES.arrived());
    const here = overrides().find((o) => o.template === "announcement");
    expect(here).toMatchObject({
      type: "moments.override.started",
      rank: 80,
      regions: ["hero", "rail", "ticker"],
      expires_at: new Date(w.now.getTime() + 180_000).toISOString(),
      content: { title: "Pizza is here", level: "info" },
    });
    const content = here?.content as { body: string; ticker_line: string };
    expect(content.body).toMatch(/^Order \d+ · Collect at /);
    expect(content.ticker_line).toBe(`Pizza is here · ${content.body}`);
    await deliver({ ...FIXTURES.arrived(), type: "pizza.order.done" });
    expect(w.events("demo").at(-1)?.data).toMatchObject({
      override_id: `${String(here?.id).replace(/\.main$/, "")}.main`,
      reason: "source_ended",
    });
  });

  it("shows a hot game until its surge ends", async () => {
    await deliver(FIXTURES.surge());
    expect(overrides()[0]).toMatchObject({
      template: "hot_game",
      rank: 50,
      content: { players: 14 },
    });
    await deliver(FIXTURES.surgeEnded());
    expect(w.events("demo").at(-1)?.data).toMatchObject({ reason: "source_ended" });
  });

  it("follows each event's settings: off, another class, another TTL", async () => {
    await w.tx("demo", (c) =>
      c.query(
        `INSERT INTO moments_rules (rule_id, settings, revision) VALUES
           ('hot_game', '{"enabled": false}', 1),
           ('pizza', '{"class": "spotlight", "ttl_seconds": 60, "zones": ["main"]}', 1)`,
      ),
    );
    await deliver(FIXTURES.surge());
    await deliver(FIXTURES.placed());
    expect(overrides()).toHaveLength(1);
    expect(overrides()[0]).toMatchObject({
      template: "pizza_placed",
      rank: 70,
      zones: ["main"],
      expires_at: new Date(w.now.getTime() + 60_000).toISOString(),
    });
  });

  it("plays each rule's cue when its moment starts, and a new photo's cue, sound only", async () => {
    await w.tx("demo", (c) =>
      c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main') ON CONFLICT DO NOTHING`),
    );
    await deliver(FIXTURES.placed());
    // After the pizza's sound: one sound at a time on a zone.
    w.now = w.at(10);
    await deliver({
      ...FIXTURES.placed(),
      id: "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4ff1",
      type: "screen.photo.added",
      source: "screen",
      data: { photo_id: "ph_1", actor_user_id: null },
    });
    const cues = w
      .events("demo")
      .filter((e) => e.type === "moments.sound.played")
      .map((e) => (e.data.sound as { cue: string }).cue);
    expect(cues).toEqual(["pizza.placed", "photo.showcase"]);
    const started = w.events("demo").find((e) => e.type === "moments.override.started");
    expect((started?.data.override as { effect: { name: string } }).effect.name).toMatch(
      /pop|ripple/,
    );
  });

  it("lists every rule with its defaults, and refuses settings it cannot use", async () => {
    const rules = await w.tx("demo", (c) => loadRules(c));
    expect(rules.map((r) => r.rule_id)).toEqual(RULE_IDS);
    expect(rules.every((r) => r.enabled && r.revision === 0)).toBe(true);
    const good = { ...rules[0], cue: null };
    expect(checkRule("match_called", good)).toBeNull();
    expect(checkRule("match_called", { ...good, template: "hot_game" })).toMatch(/template/);
    expect(checkRule("match_called", { ...good, class: "emergency" })).toMatch(/class/);
    expect(checkRule("match_called", { ...good, ttl_seconds: 7201 })).toMatch(/ttl/);
  });

  it("learns the event's zones from Screen's past zone events, and a past removal ends nothing", async () => {
    const deps = { db: w.db, engine: w.engine, flush: () => w.outbox.flush(), now: () => w.now };
    const zone = (type: string, key: string) => ({
      ...FIXTURES.surge(),
      type,
      source: "screen",
      data: { zone_key: key },
    });
    await deliver(FIXTURES.surge());
    await w.tx("demo", async () => {
      for (const e of [
        zone("screen.zone.saved", "main"),
        zone("screen.zone.saved", "stage"),
        zone("screen.zone.removed", "stage"),
      ]) {
        await handleZoneReplay(deps, e);
      }
    });
    const zones = await w.tx("demo", (c) => c.query(`SELECT zone_key FROM moments_zones`));
    expect(zones.rows).toEqual([{ zone_key: "main" }]);
    // The tick passes every zone it knows (#777), so the replayed zone gets the moment.
    await w.tx("demo", (c) => tickTenant(c, w.engine, w.now));
    expect(w.events("demo").map((e) => e.type)).toEqual(["moments.override.started"]);
  });

  it("keeps the standings live: a bound spotlight gets each new leaderboard through .changed", async () => {
    await w.tx("demo", async (c) => {
      const r = await spotlightRequest(
        c,
        { show: "standings" },
        { user_id: "u_9", name: "Demo Crew" },
        "demo.test",
        w.now,
      );
      expect(r.content).toMatchObject({
        title: "Collecting standings…",
        rows: [],
        from_crew: true,
      });
      await w.engine.request(c, r, w.now);
    });
    await deliver(FIXTURES.leaderboard(2, 40));
    const changed = overrides().filter(
      (o) => o.type === "moments.override.changed" && o.class === undefined,
    );
    const spot = changed.find((o) => (o.content as { from_crew?: boolean }).from_crew === true);
    expect(spot?.content).toMatchObject({
      title: "Standings",
      rows: [
        { rank: 1, name: "Demo Player 2", points: 40 },
        { rank: 2, name: "Demo Player", points: 36 },
      ],
      from_crew: true,
    });
    // An older leaderboard arriving late changes nothing.
    const before = w.events("demo").length;
    await deliver(FIXTURES.leaderboard(1, 10));
    expect(
      w
        .events("demo")
        .slice(before)
        .some((e) => e.type === "moments.override.started"),
    ).toBe(false);
    const latest = overrides()
      .filter((o) => (o.content as { from_crew?: boolean } | undefined)?.from_crew)
      .at(-1);
    expect((latest?.content as { rows: { points: number }[] }).rows[0]?.points).toBe(40);
  });
});
