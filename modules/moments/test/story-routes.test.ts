/**
 * The storyboards API (contracts/moments/storyboards.openapi.yaml): the presets copied on first
 * use, saving with validation and video assets (a private YouTube refused), the preload, reset
 * to default, fire with its item, test-fire one round on one zone, Stop loop and Skip to finale.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { storeAgenda } from "../src/scene-store.js";
import { addZone } from "../src/store.js";
import { DATABASE_URL, freshDatabase } from "./helpers.js";
import { appWorld, errorOf, json } from "./app.js";
import type { AppWorld } from "./app.js";
import { ITEM, TABLES, step } from "./story-kit.js";

type Stories = { stories: Record<string, unknown>[]; revision: number };

describe.skipIf(!DATABASE_URL)("the storyboards API", () => {
  let pool: pg.Pool;
  let w: AppWorld;
  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${TABLES}, moments_idempotency`);
    w = await appWorld(pool);
    await w.tx("demo", async (c) => {
      await addZone(c, "main");
      await storeAgenda(c, { agenda_version: 1, items: [ITEM as never] });
    });
  });

  const list = async () => json(await w.call("reader", "GET", "/api/moments/storyboards")) as unknown as Stories;
  const put = async (stories: unknown[], revision: number, who = "admin") =>
    w.call(who, "PUT", "/api/moments/storyboards", { stories, revision });

  it("copies the five presets on first use and validates a save", async () => {
    const doc = await list();
    expect(doc.stories.map((s) => s.key)).toEqual(["doors_open", "starting_soon", "match_called", "champion", "midnight"]);
    expect(doc.stories[2]).toMatchObject({ rule_off: "match_called" });
    expect((await put(doc.stories, 0, "crew")).statusCode).toBe(403);
    const broken = [{ ...doc.stories[0], round: { steps: [step({ content: { title: "{item.nope}" } })], repeat: null, hold_seconds: null } }];
    const bad = await put(broken, 0);
    expect(bad.statusCode).toBe(400);
    expect(errorOf(bad).message).toContain("Unknown placeholder {item.nope}");
    expect((await put(doc.stories, 7)).statusCode).toBe(409);
  });

  it("keeps a video step's file and length, preloads it, and refuses a private YouTube video", async () => {
    w.assets.set("as_film", { id: "as_film", kind: "video", title: "Last year", url: "/api/screen/files/abc.mp4", size_bytes: 1, duration_seconds: 95 });
    w.assets.set("as_yt", { id: "as_yt", kind: "youtube", title: "Private", url: "https://www.youtube.com/watch?v=x", size_bytes: null, duration_seconds: 60, health: "error" } as never);
    const doc = await list();
    const premiere = {
      ...doc.stories[1],
      key: "premiere",
      name: "Premiere",
      preset: null,
      triggers: [{ kind: "take" }],
      round: { steps: [step({ message: true }), step({ template: "video", content: { asset_id: "as_film" }, on_the_dot: true })], repeat: null, hold_seconds: null },
      rounds: { mode: "offsets", offsets_minutes: [0] },
      end: { rounds: 1, for_minutes: null, until_clock: null, until_event: null, crew: true },
      finale: null,
      sound: "first",
    };
    const ok = await put([...doc.stories, premiere], 0);
    expect(ok.statusCode).toBe(200);
    const saved = (json(ok) as unknown as Stories).stories.at(-1) as { round: { steps: { content: unknown }[] } };
    expect(saved.round.steps[1]?.content).toEqual({ asset_id: "as_film", kind: "video", url: "/api/screen/files/abc.mp4", title: "Last year", duration_ms: 95_000 });
    const prefetch = w.events("demo").filter((e) => e.type === "moments.prefetch.changed").at(-1);
    expect(prefetch?.data).toEqual({ files: [{ url: "/api/screen/files/abc.mp4", zones: [] }] });
    const yt = { ...premiere, round: { ...premiere.round, steps: [step({ message: true }), step({ template: "video", content: { asset_id: "as_yt" } })] } };
    const refused = await put([...doc.stories, yt], 1);
    expect(refused.statusCode).toBe(400);
    expect(errorOf(refused).message).toContain("public or unlisted");
  });

  it("resets a preset to default", async () => {
    const doc = await list();
    const changed = doc.stories.map((s) => (s.key === "midnight" ? { ...s, name: "Our midnight", enabled: false } : s));
    expect((await put(changed, 0)).statusCode).toBe(200);
    const r = await w.call("admin", "POST", "/api/moments/storyboards/reset", { key: "midnight", revision: 1 });
    expect(r.statusCode).toBe(200);
    const midnight = (json(r) as unknown as Stories).stories.find((s) => s.key === "midnight");
    expect(midnight).toMatchObject({ name: "Midnight", enabled: true });
  });

  it("fires a story with its item, stops its loop without a finale, and skips another to its finale", async () => {
    w.now = new Date("2026-01-01T18:40:00Z");
    const noItem = await w.call("crew", "POST", "/api/moments/storyboards/starting_soon/take", {});
    expect(errorOf(noItem).message).toBe("Choose the item this story is about.");
    const fired = await w.call("crew", "POST", "/api/moments/storyboards/starting_soon/take", { item_id: "it_final" });
    expect(fired.statusCode).toBe(201);
    const run = json(fired);
    expect(run).toMatchObject({ status: "live", t: "2026-01-01T19:00:00.000Z" });
    const stop = await w.call("crew", "POST", `/api/moments/storyboards/runs/${String(run.id)}/stop`, {});
    expect(json(stop)).toMatchObject({ status: "ended", end_reason: "stopped" });
    expect((await w.call("crew", "POST", `/api/moments/storyboards/runs/${String(run.id)}/stop`, {})).statusCode).toBe(409);
    const again = json(await w.call("crew", "POST", "/api/moments/storyboards/starting_soon/take", { item_id: "it_final" }));
    const skip = await w.call("crew", "POST", `/api/moments/storyboards/runs/${String(again.id)}/finale`, {});
    expect(json(skip)).toMatchObject({ status: "live", round: { finale: true } });
    expect(w.audit.map((a) => a.action)).toContain("moments.storyboard.skipped");
  });

  it("test-fires one round on one zone, marked as a test", async () => {
    const r = await w.call("crew", "POST", "/api/moments/storyboards/midnight/take", { test: { zone: "main", sound: false } });
    expect(r.statusCode).toBe(201);
    expect(json(r)).toMatchObject({ test: true, zones: ["main"], round: { number: 1 } });
    const { rows } = await pool.query(`SELECT why FROM moments_history WHERE action = 'round_started'`);
    expect(rows[0]?.why).toMatch(/^test-fire · Demo crew/);
  });
});
