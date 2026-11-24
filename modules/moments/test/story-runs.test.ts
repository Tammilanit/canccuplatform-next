/**
 * Storyboards' runs on a fake clock (SO4; contracts/moments.md, Storyboards): offsets with a
 * finale at the item's start, a delay and a cancel; `every` rounds and `clock every` in its
 * window; each end and the finale; Midnight's sting on 00:00:00; a long hold; a late take; a
 * held region, an emergency and a restart mid-loop.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lockMoment } from "../src/store.js";
import { loadStories } from "../src/story/store.js";
import { takeStory } from "../src/story/triggers.js";
import type { Story } from "../src/story/model.js";
import { DATABASE_URL, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { ITEM, TABLES, kit, preset, rounds, step, story } from "./story-kit.js";

const CREW = { user_id: "u_crew", name: "Demo Crew" };
/** 19:00, the item's start: T0 is 18:00. */
const T = 3600;

describe.skipIf(!DATABASE_URL)("storyboard runs", () => {
  let pool: pg.Pool;
  let w: World;
  let k: ReturnType<typeof kit>;
  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${TABLES}`);
    w = world(pool);
    k = kit(w);
  });

  const take = (
    s: Story,
    at: Date,
    item: Record<string, unknown> | null = null,
    test: { zone: string; sound: boolean } | null = null,
  ) =>
    k.tx(async (c) => {
      const doc = await loadStories(c);
      return takeStory(
        { c, engine: w.engine, now: at, settings: doc.settings, event: doc.event },
        s,
        { item: item as never, variables: {}, actor: CREW, test },
      );
    });

  it("plays Starting soon at T−15, T−5 and T−1, its finale at the item's start, and sounds first and last", async () => {
    await k.setup([preset("starting_soon")]);
    await k.agenda([ITEM]);
    await k.tick(w.at(T - 15 * 60 - 1));
    expect(await k.runs()).toEqual([]);
    for (const at of [T - 900, T - 300, T - 60]) {
      await k.tick(w.at(at));
      const o = k.started().at(-1) as Record<string, unknown>;
      expect(o).toMatchObject({
        template: "sting",
        rank: 60,
        regions: ["hero", "rail"],
        starts_at: w.at(at).toISOString(),
      });
      expect((o.steps as unknown[]).length).toBe(4);
      expect(o.expires_at).toBe(w.at(at + 46).toISOString());
      await k.place("main", [[o.id as string, "hero"]], w.at(at));
      await k.tick(w.at(at + 1));
      await k.tick(w.at(at + 50));
    }
    const steps = (k.started()[0]?.steps ?? []) as { content: Record<string, unknown> }[];
    expect(steps[1]?.content).toMatchObject({
      label: "Demo Game Cup final",
      target_at: "2026-01-01T19:00:00.000Z",
      ends_text: "Stage · in 15 minutes",
    });
    await k.tick(w.at(T));
    const finale = k.started().at(-1) as Record<string, unknown>;
    expect(finale).toMatchObject({
      template: "title_card",
      content: { title: "It's on!", subtitle: "Demo Game Cup final · Stage" },
    });
    await k.place("main", [[finale.id as string, "hero"]], w.at(T));
    await k.tick(w.at(T + 1));
    await k.tick(w.at(T + 10));
    expect(rounds(await k.history())).toEqual([
      "round_started round 1 of 3",
      "round_started round 2 of 3",
      "round_started round 3 of 3",
      "round_started finale",
      "loop_ended ended: the item started",
    ]);
    const sounds = (await k.soundLog()).filter((s) => s.outcome === "played").map((s) => s.cue);
    expect(sounds).toEqual(["tournament.pre", "tournament.pre", "tournament.start"]);
    expect((await k.runs())[0]).toMatchObject({ status: "ended", end_reason: "planned" });
  });

  it("follows the item's delay, and a cancel ends the loop silently", async () => {
    await k.setup([preset("starting_soon")]);
    await k.agenda([ITEM]);
    await k.tick(w.at(T - 900));
    await k.agenda([{ ...ITEM, starts_at: "2026-01-01T19:10:00Z" }], 2);
    await k.tick(w.at(T - 300));
    expect(k.started()).toHaveLength(1);
    await k.tick(w.at(T + 300));
    expect(k.started()).toHaveLength(2);
    await k.agenda([{ ...ITEM, starts_at: "2026-01-01T19:10:00Z", status: "cancelled" }], 3);
    await k.tick(w.at(T + 320));
    const h = rounds(await k.history());
    expect(h.at(-1)).toBe("loop_ended ended: Demo Game Cup final was cancelled");
    expect(h.some((x) => x.includes("finale"))).toBe(false);
    const ended = w.events("demo").filter((e) => e.type === "moments.override.ended");
    expect(ended.at(-1)?.data).toMatchObject({ reason: "cleared", final: true });
  });

  it("plays `every` rounds, ends by its count and plays the finale on that planned end", async () => {
    const s = story({
      triggers: [{ kind: "item", kinds: ["doors"], item_id: null, anchor: "start" }],
      rounds: { mode: "every", every_minutes: 10, from_minutes: 0 },
      end: { rounds: 3, for_minutes: null, until_clock: null, until_event: null, crew: true },
      finale: [step({ content: { title: "That's all" }, duration_seconds: 8 })],
    });
    await k.setup([s]);
    await k.agenda([{ ...ITEM, id: "it_doors", kind: "doors", title: "Doors" }]);
    for (const at of [T, T + 30, T + 600, T + 630, T + 1200, T + 1230, T + 1240])
      await k.tick(w.at(at));
    expect(rounds(await k.history())).toEqual([
      "round_started round 1 of 3",
      "round_started round 2 of 3",
      "round_started round 3 of 3",
      "round_started finale",
      "loop_ended ended: after its last round",
    ]);
  });

  it("fires `clock every` aligned to its window, one run per fire", async () => {
    const s = story({
      triggers: [
        {
          kind: "clock",
          mode: "every",
          at: null,
          every_minutes: 60,
          from: "10:00",
          until: "22:00",
        },
      ],
      rounds: { mode: "offsets", offsets_minutes: [0] },
    });
    await k.setup([s]);
    // 21:00 is missed past its patience while Moments was down, and never played late.
    for (const at of [T - 1, T, T + 1800, T + 3600, T + 3 * 3600 + 60]) await k.tick(w.at(at));
    const runs = await k.runs();
    expect(runs.map((r) => r.t.toISOString())).toEqual([
      "2026-01-01T19:00:00.000Z",
      "2026-01-01T20:00:00.000Z",
      "2026-01-01T22:00:00.000Z",
    ]);
  });

  it("ends by its time and by its clock time, with the finale, and on the crew's stop without it", async () => {
    const base = {
      rounds: { mode: "every" as const, every_minutes: 5, from_minutes: 0 },
      finale: [step({ content: { title: "Bye" }, duration_seconds: 8 })],
    };
    await k.setup([
      story({
        ...base,
        key: "for",
        end: { rounds: null, for_minutes: 12, until_clock: null, until_event: null, crew: true },
      }),
      story({
        ...base,
        key: "clock",
        end: {
          rounds: null,
          for_minutes: null,
          until_clock: "18:07",
          until_event: null,
          crew: true,
        },
      }),
    ]);
    const doc = await k.tx((c) => loadStories(c));
    await take(doc.stories[0] as Story, w.at(0));
    await take(doc.stories[1] as Story, w.at(0));
    for (const at of [30, 300, 330, 420, 430, 600, 630, 720, 730]) await k.tick(w.at(at));
    const h = await k.history();
    const ends = h.filter((r) => r.action === "loop_ended").map((r) => r.outcome);
    expect(ends).toEqual(["ended: its time is over", "ended: its time is over"]);
    expect(h.filter((r) => r.outcome === "finale")).toHaveLength(2);
  });

  it("lands Midnight's sting on 00:00:00: its round starts at 23:59:50, full screen", async () => {
    await k.setup([preset("midnight")]);
    const at = (iso: string) => new Date(iso);
    await k.tick(at("2026-01-01T23:59:49Z"));
    expect(k.started()).toEqual([]);
    await k.tick(at("2026-01-01T23:59:50Z"));
    const o = k.started()[0] as Record<string, unknown>;
    expect(o).toMatchObject({ regions: ["full"], starts_at: "2026-01-01T23:59:50.000Z" });
    const steps = o.steps as {
      template: string;
      duration_ms: number;
      content: Record<string, unknown>;
    }[];
    expect(steps.map((s) => [s.template, s.duration_ms])).toEqual([
      ["countdown", 10_000],
      ["sting", 4000],
      ["title_card", 15_000],
    ]);
    expect(steps[0]?.content.target_at).toBe("2026-01-02T00:00:00.000Z");
    expect(steps[2]?.content.title).toBe("Night 1 at Demo Event");
  });

  it("holds a long hold story's last step to its hold (SL2)", async () => {
    const s = story({
      round: { steps: [step({ message: true })], repeat: null, hold_seconds: 150 },
    });
    await k.setup([s]);
    await take(s, w.at(0));
    expect(k.started()[0]?.expires_at).toBe(w.at(150).toISOString());
  });

  it("a late take plays the round due now, from the item's time (SU3)", async () => {
    await k.setup([
      preset("starting_soon", {
        triggers: [
          { kind: "take" },
          { kind: "item", kinds: ["ceremony"], item_id: null, anchor: "start" },
        ],
      }),
    ]);
    await k.agenda([ITEM]);
    const doc = await k.tx((c) => loadStories(c));
    await take(doc.stories[0] as Story, w.at(T - 280), ITEM);
    expect(k.started()[0]?.starts_at).toBe(w.at(T - 300).toISOString());
    expect(rounds(await k.history())).toEqual([
      "round_skipped round 1 of 3 skipped: its time ran out",
      "round_started round 2 of 3",
    ]);
  });

  it("never skips a round for a held region (#777), and skips one due during an emergency", async () => {
    await k.setup([preset("starting_soon")]);
    await k.agenda([ITEM]);
    await k.tick(w.at(T - 900));
    const id = k.started()[0]?.id as string;
    await k.place("main", [], w.at(T - 900), [id]);
    await k.tick(w.at(T - 900 + 47));
    expect(rounds(await k.history()).at(-1)).toBe("round_started round 1 of 3");
    await k.tx((c) =>
      w.engine.request(
        c,
        {
          class: "emergency",
          template: "announcement",
          content: { title: "Leave", level: "emergency" },
          origin: "emergency",
          why: "test",
          ttl_seconds: null,
        },
        w.at(T - 301),
      ),
    );
    await k.tick(w.at(T - 300));
    expect(rounds(await k.history()).at(-1)).toBe(
      "round_skipped round 2 of 3 skipped: an emergency holds every zone",
    );
  });

  it("starts the round due now after a restart mid-loop (SE4)", async () => {
    await k.setup([preset("starting_soon")]);
    await k.agenda([ITEM]);
    await k.tick(w.at(T - 900));
    w.restart();
    await k.tick(w.at(T - 290));
    const h = rounds(await k.history());
    expect(h).toEqual(["round_started round 1 of 3", "round_started round 2 of 3"]);
    const id = String(k.started()[1]?.id).replace(/\.main$/, "");
    const m = await k.tx((c) => lockMoment(c, id));
    expect(m?.starts_at.toISOString()).toBe(w.at(T - 300).toISOString());
  });

  it("ends an `every` loop the crew's Stop alone ends after 6 h, without its finale (SE5)", async () => {
    const s = story({
      rounds: { mode: "every", every_minutes: 120, from_minutes: 0 },
      end: { rounds: null, for_minutes: null, until_clock: null, until_event: null, crew: true },
      finale: [step({ content: { title: "Bye" }, duration_seconds: 8 })],
    });
    await k.setup([s]);
    await take(s, w.at(0));
    await k.tick(w.at(6 * 3600 - 1));
    expect((await k.runs())[0]?.status).toBe("live");
    await k.tick(w.at(6 * 3600));
    const h = rounds(await k.history());
    expect(h.at(-1)).toBe("loop_ended ended: time limit");
    expect(h.some((x) => x.includes("finale"))).toBe(false);
  });
});
