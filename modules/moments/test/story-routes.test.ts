/**
 * The storyboards API (contracts/moments/storyboards.openapi.yaml): the presets copied on first
 * use, saving with validation and video assets (a private YouTube refused), the preload, reset
 * to default, fire with its item, test-fire one round on one zone, Stop loop and Skip to finale.
 */
import type pg from "pg";
import { TenantResolver } from "@canccu/kit";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { storeAgenda } from "../src/scene-store.js";
import { addZone } from "../src/store.js";
import { forgetUser } from "../src/consumer.js";
import { PRESETS } from "../src/story/presets.js";
import { DATABASE_URL, freshDatabase } from "./helpers.js";
import { appWorld, errorOf, json } from "./app.js";
import type { AppWorld } from "./app.js";
import { ITEM, TABLES, step, story } from "./story-kit.js";

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
      await storeAgenda(c, { agenda_version: 1, items: [ITEM] });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const list = async () =>
    json(await w.call("reader", "GET", "/api/moments/storyboards")) as unknown as Stories;
  const put = async (stories: unknown[], revision: number, who = "admin") =>
    w.call(who, "PUT", "/api/moments/storyboards", { stories, revision });

  it("copies the 24 presets on first use and validates a save", async () => {
    const doc = await list();
    expect(doc.stories.map((s) => s.key)).toEqual(PRESETS.map((p) => p.key));
    expect(doc.stories[2]).toMatchObject({ rule_off: "match_called" });
    expect((await put(doc.stories, 0, "crew")).statusCode).toBe(403);
    const broken = [
      {
        ...doc.stories[0],
        round: {
          steps: [step({ content: { title: "{item.nope}" } })],
          repeat: null,
          hold_seconds: null,
        },
      },
    ];
    const bad = await put(broken, 0);
    expect(bad.statusCode).toBe(400);
    expect(errorOf(bad).message).toContain("Unknown placeholder {item.nope}");
    expect((await put(doc.stories, 7)).statusCode).toBe(409);
  });

  // #611, #114 "validated by a JSON schema": the contract's storyboard.schema.json, then the rules.
  it("refuses a story its JSON schema refuses: an unknown property, a bad enum, no rounds", async () => {
    const own = story({ key: "own", name: "Own story" });
    const noRounds: Record<string, unknown> = { ...own };
    delete noRounds.rounds;
    const cases: [unknown, string][] = [
      [{ ...own, colour: "red" }, "colour"],
      [
        {
          ...own,
          triggers: [{ kind: "take" }],
          end: { ...own.end, until_event: { kind: "foo" } },
        },
        "until_event",
      ],
      [{ ...own, round: { ...own.round, steps: [step({ message: "yes" as never })] } }, "message"],
      [noRounds, "rounds"],
    ];
    for (const [bad, culprit] of cases) {
      const r = await put([bad], 0);
      expect(r.statusCode, culprit).toBe(400);
      expect(errorOf(r).code, culprit).toBe("invalid_request");
      expect(errorOf(r).message, culprit).toContain(culprit);
    }
    expect((await put([own], 0)).statusCode).toBe(200);
  });

  /**
   * A story with a video step, alone in the event's list: each save validates and audits the
   * whole list, so the video tests save only the story they look at (#602's carry-over: this
   * test once timed out on a loaded CI runner; no call in it waits, each save took 12–51 ms here).
   */
  const film = (video: Record<string, unknown>) => ({
    ...story({ key: "film", name: "Last year's film" }),
    round: {
      steps: [
        step({ message: true }),
        step({ template: "video", content: video, on_the_dot: true }),
      ],
      repeat: null,
      hold_seconds: null,
    },
  });

  it("keeps a video step's file and length, and preloads it", async () => {
    w.assets.set("as_film", {
      id: "as_film",
      kind: "video",
      title: "Last year",
      url: "/api/screen/files/abc.mp4",
      size_bytes: 1,
      duration_seconds: 95,
    });
    const ok = await put([film({ asset_id: "as_film" })], 0);
    expect(ok.statusCode).toBe(200);
    const saved = (json(ok) as unknown as Stories).stories.at(-1) as {
      round: { steps: { content: unknown }[] };
    };
    expect(saved.round.steps[1]?.content).toEqual({
      asset_id: "as_film",
      kind: "video",
      url: "/api/screen/files/abc.mp4",
      title: "Last year",
      duration_ms: 95_000,
    });
    const prefetch = w
      .events("demo")
      .filter((e) => e.type === "moments.prefetch.changed")
      .at(-1);
    expect(prefetch?.data).toEqual({ files: [{ url: "/api/screen/files/abc.mp4", zones: [] }] });
  });

  it("refuses a private YouTube video, and asks a YouTube video's length", async () => {
    w.assets.set("as_yt", {
      id: "as_yt",
      kind: "youtube",
      title: "Private",
      url: "https://www.youtube.com/watch?v=x",
      size_bytes: null,
      duration_seconds: 60,
      health: "error",
    } as never);
    const refused = await put([film({ asset_id: "as_yt" })], 0);
    expect(refused.statusCode).toBe(400);
    expect(errorOf(refused).message).toContain("public or unlisted");
    // YouTube gives no length: the organiser says how long it plays.
    w.assets.set("as_yt_ok", {
      id: "as_yt_ok",
      kind: "youtube",
      title: "Recap",
      url: "https://www.youtube.com/watch?v=abcdefgh",
      size_bytes: null,
      duration_seconds: null,
      health: "ok",
    } as never);
    expect(errorOf(await put([film({ asset_id: "as_yt_ok" })], 0)).message).toContain(
      "give the video's length",
    );
    const ok = await put([film({ asset_id: "as_yt_ok", duration_seconds: 600 })], 0);
    expect(ok.statusCode).toBe(200);
    const yts = (json(ok) as unknown as Stories).stories.at(-1) as {
      round: { steps: { content: Record<string, unknown> }[] };
    };
    expect(yts.round.steps[1]?.content).toMatchObject({ kind: "youtube", duration_ms: 600_000 });
  });

  it("keeps a preset's video step unchosen while it is off, and refuses to turn it on so", async () => {
    const doc = await list();
    const premiere = doc.stories.find((s) => s.key === "premiere") as Record<string, unknown>;
    const on = doc.stories.map((s) => (s.key === "premiere" ? { ...premiere, enabled: true } : s));
    const refused = await put(on, 0);
    expect(refused.statusCode).toBe(400);
    expect(errorOf(refused).message).toContain("Premiere: choose the video before turning it on.");
    expect((await put(doc.stories, 0)).statusCode).toBe(200);
  });

  it("resets a preset to default", async () => {
    const doc = await list();
    const changed = doc.stories.map((s) =>
      s.key === "midnight" ? { ...s, name: "Our midnight", enabled: false } : s,
    );
    expect((await put(changed, 0)).statusCode).toBe(200);
    const r = await w.call("admin", "POST", "/api/moments/storyboards/reset", {
      key: "midnight",
      revision: 1,
    });
    expect(r.statusCode).toBe(200);
    const midnight = (json(r) as unknown as Stories).stories.find((s) => s.key === "midnight");
    expect(midnight).toMatchObject({ name: "Midnight", enabled: true });
  });

  it("fires a story with its item, stops its loop without a finale, and skips another to its finale", async () => {
    w.now = new Date("2026-01-01T18:40:00Z");
    const noItem = await w.call("crew", "POST", "/api/moments/storyboards/starting_soon/take", {});
    expect(errorOf(noItem).message).toBe("Choose the item this story is about.");
    const fired = await w.call("crew", "POST", "/api/moments/storyboards/starting_soon/take", {
      item_id: "it_final",
    });
    expect(fired.statusCode).toBe(201);
    const run = json(fired);
    expect(run).toMatchObject({ status: "live", t: "2026-01-01T19:00:00.000Z" });
    const stop = await w.call(
      "crew",
      "POST",
      `/api/moments/storyboards/runs/${String(run.id)}/stop`,
      {},
    );
    expect(json(stop)).toMatchObject({ status: "ended", end_reason: "stopped" });
    expect(
      (await w.call("crew", "POST", `/api/moments/storyboards/runs/${String(run.id)}/stop`, {}))
        .statusCode,
    ).toBe(409);
    const again = json(
      await w.call("crew", "POST", "/api/moments/storyboards/starting_soon/take", {
        item_id: "it_final",
      }),
    );
    const skip = await w.call(
      "crew",
      "POST",
      `/api/moments/storyboards/runs/${String(again.id)}/finale`,
      {},
    );
    expect(json(skip)).toMatchObject({ status: "live", round: { finale: true } });
    expect(w.audit.map((a) => a.action)).toContain("moments.storyboard.skipped");
  });

  // #611: firing is no way around the agenda's visibility, as the composer is not (canSee).
  it("fires with a crew-only item only for a crew reader, and never prints its fields", async () => {
    w.now = new Date("2026-01-01T18:40:00Z");
    const secret = { ...ITEM, id: "it_crew", title: "Crew briefing", visibility: "crew" };
    await w.tx("demo", (c) => storeAgenda(c, { agenda_version: 2, items: [ITEM, secret] }));
    const fire = (who: string) =>
      w.call(who, "POST", "/api/moments/storyboards/starting_soon/take", { item_id: "it_crew" });
    const hidden = await fire("crew");
    expect(hidden.statusCode).toBe(400);
    expect(errorOf(hidden).message).toBe("No such run-of-show item.");
    const crewReader = await fire("lead");
    expect(crewReader.statusCode).toBe(400);
    expect(errorOf(crewReader).message).toContain("not public");
    expect((await w.tx("demo", (c) => c.query(`SELECT id FROM moments`))).rows).toEqual([]);
  });

  it("test-fires one round on one zone, marked as a test", async () => {
    const r = await w.call("crew", "POST", "/api/moments/storyboards/midnight/take", {
      test: { zone: "main", sound: false },
    });
    expect(r.statusCode).toBe(201);
    expect(json(r)).toMatchObject({ test: true, zones: ["main"], round: { number: 1 } });
    const { rows } = await pool.query(
      `SELECT why FROM moments_history WHERE action = 'round_started'`,
    );
    expect((rows[0] as { why: string } | undefined)?.why).toMatch(
      /^Demo crew · test-fire Midnight/,
    );
  });

  // A5, R19, R20 (#625): the first fire, before any page read the event, read "Welcome to" with
  // no name and drew the QR step's code as a white square (no hostname, no code).
  it("fills the event's name and draws the QR step's code on the very first fire", async () => {
    // The kit asks tenants over plain HTTP, which the fake fetch does not answer.
    vi.spyOn(TenantResolver.prototype, "event").mockResolvedValue({
      name: "Demo Event",
      status: "live",
    } as Awaited<ReturnType<TenantResolver["event"]>>);
    const r = await w.call("crew", "POST", "/api/moments/storyboards/doors_open/take", {
      test: { zone: "main", sound: false },
    });
    expect(r.statusCode).toBe(201);
    const { rows } = await pool.query(`SELECT steps FROM moments WHERE steps IS NOT NULL`);
    const steps = (rows[0] as { steps: { template: string; content: Record<string, unknown> }[] })
      .steps;
    expect(steps[1]?.content.title).toBe("Welcome to Demo Event");
    const qr = steps.find((s) => s.template === "qr")?.content;
    expect(qr?.image_url).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(qr?.url).toBe("https://demo.test/notify/");
  });

  it("test-fires a round now with an item whose time has passed: it plays, not skipped", async () => {
    const doors = {
      ...ITEM,
      id: "it_doors",
      title: "Doors open",
      kind: "doors",
      starts_at: "2026-01-01T14:00:00Z",
      ends_at: "2026-01-01T15:00:00Z",
    };
    await w.tx("demo", (c) => storeAgenda(c, { agenda_version: 2, items: [ITEM, doors] }));
    const r = await w.call("crew", "POST", "/api/moments/storyboards/doors_open/take", {
      test: { zone: "main", sound: false },
      item_id: "it_doors",
    });
    expect(r.statusCode).toBe(201);
    expect(json(r)).toMatchObject({ test: true, status: "live", round: { number: 1 } });
    const { rows } = await pool.query(
      `SELECT action FROM moments_history WHERE action IN ('round_started', 'round_skipped', 'loop_ended')`,
    );
    expect(rows.map((x: { action: string }) => x.action)).toEqual(["round_started"]);
  });

  it("forgets a person's name in the story's runs and history rows", async () => {
    await w.call("crew", "POST", "/api/moments/storyboards/midnight/take", {
      test: { zone: "main", sound: false },
    });
    await w.tx("demo", (c) => forgetUser(c, "u_crew"));
    const { rows } = await pool.query(
      `SELECT why, actor_name FROM moments_history WHERE action = 'round_started'
       UNION ALL SELECT why, actor_name FROM moments_story_runs`,
    );
    expect(rows.length).toBe(2);
    for (const r of rows as { why: string; actor_name: string | null }[]) {
      expect(r.actor_name).toBeNull();
      expect(r.why).not.toContain("Demo crew");
    }
  });

  it("keeps the stopper's and the finisher's names out of the history and the run, and forgets both people", async () => {
    w.now = new Date("2026-01-01T18:40:00Z");
    const fire = async () =>
      json(
        await w.call("crew", "POST", "/api/moments/storyboards/starting_soon/take", {
          item_id: "it_final",
        }),
      );
    const stopped = await fire();
    await w.call("admin", "POST", `/api/moments/storyboards/runs/${String(stopped.id)}/stop`, {});
    const skipped = await fire();
    await w.call("admin", "POST", `/api/moments/storyboards/runs/${String(skipped.id)}/finale`, {});
    const left = async () => {
      const { rows } = await pool.query(
        `SELECT to_jsonb(h)::text AS t FROM moments_history h
         UNION ALL SELECT to_jsonb(r)::text FROM moments_story_runs r`,
      );
      return (rows as { t: string }[]).map((r) => r.t).join("\n");
    };
    // Bob (admin) is the actor of his own rows only; Alice (crew) stays the run's actor.
    const runs = await pool.query(`SELECT actor_user_id FROM moments_story_runs`);
    expect(
      (runs.rows as { actor_user_id: string }[]).every((r) => r.actor_user_id === "u_crew"),
    ).toBe(true);
    expect(await left()).not.toMatch(/stopped by Demo|finale by Demo/);
    await w.tx("demo", (c) => forgetUser(c, "u_crew"));
    await w.tx("demo", (c) => forgetUser(c, "u_admin"));
    const rest = await left();
    expect(rest).not.toContain("Demo crew");
    expect(rest).not.toContain("Demo admin");
    expect(rest).not.toContain("u_crew");
    expect(rest).not.toContain("u_admin");
  });
});
