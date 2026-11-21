/**
 * The demo event's Moments on the dev server (#715): the presets copied and Prize draw on for the
 * run of show's raffle, so a story is ready to go on air; dev mode only, idempotent, never over
 * storyboards changed by hand, `force` as the reset.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  HAND_MADE,
  NO_RAFFLE,
  READY,
  Refused,
  UP_TO_DATE,
  seedDemoMoments,
} from "../src/dev-seed.js";
import type { AgendaItem } from "../src/scene-eval.js";
import { loadScenes } from "../src/scene-store.js";
import { loadStories, writeStories } from "../src/story/store.js";
import { DATABASE_URL, T0, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { TABLES } from "./story-kit.js";

type Item = AgendaItem & { title: string };

const raffle = (id: string, starts: string): Item => ({
  id,
  title: "Raffle",
  kind: "activity",
  visibility: "public",
  status: "scheduled",
  starts_at: starts,
  ends_at: null,
});
const DINNER: Item = { ...raffle("it_dinner", "2026-01-01T19:30:00Z"), title: "Dinner" };
const AGENDA = [DINNER, raffle("it_raffle", "2026-01-01T21:00:00Z")];

describe.skipIf(!DATABASE_URL)("the dev seed's Moments", () => {
  let pool: pg.Pool;
  let w: World;

  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${TABLES}, moments_scenes`);
    w = world(pool);
  });

  const seed = (o: { force?: boolean; version?: string; items?: Item[] | null } = {}) =>
    seedDemoMoments(
      { db: w.db, now: () => w.now },
      {
        version: o.version ?? "dev",
        items: o.items === undefined ? AGENDA : o.items,
        force: o.force ?? false,
      },
    );
  const stories = () => w.tx("demo", (c) => loadStories(c));
  const prizeDraw = async () => (await stories()).stories.find((s) => s.key === "prize_draw");

  it("is refused outside dev mode and changes nothing", async () => {
    await expect(seed({ version: "1.4.0" })).rejects.toThrow(Refused);
    expect((await stories()).copied).toBe(false);
  });

  it("copies the presets and puts Prize draw on for the raffle", async () => {
    expect(await seed()).toBe(READY);
    const doc = await stories();
    expect(doc.copied).toBe(true);
    const pd = await prizeDraw();
    expect(pd?.enabled).toBe(true);
    expect(pd?.triggers).toContainEqual(
      expect.objectContaining({ kind: "item", item_id: "it_raffle" }),
    );
    // The presets every event has stay as they were copied; the scenes are copied too.
    expect(doc.stories.filter((s) => s.enabled).length).toBeGreaterThan(1);
    expect((await w.tx("demo", (c) => loadScenes(c))).copied).toBe(true);
  });

  it("a second run changes nothing", async () => {
    await seed();
    const before = (await stories()).revision;
    expect(await seed()).toBe(UP_TO_DATE);
    expect((await stories()).revision).toBe(before);
  });

  it("follows the raffle when the run of show moved to another day", async () => {
    await seed();
    expect(await seed({ items: [raffle("it_raffle2", "2026-01-02T21:00:00Z")] })).toBe(READY);
    expect((await prizeDraw())?.triggers).toContainEqual(
      expect.objectContaining({ kind: "item", item_id: "it_raffle2" }),
    );
  });

  it("leaves Prize draw alone without a raffle ahead", async () => {
    w.now = new Date("2026-01-01T22:00:00Z");
    expect(await seed()).toBe(NO_RAFFLE);
    expect(await seed({ items: null })).toBe(NO_RAFFLE);
    expect((await prizeDraw())?.enabled).toBe(false);
  });

  it("never over storyboards changed by hand", async () => {
    await seed();
    await w.tx("demo", async (c) => {
      const doc = await loadStories(c);
      const off = doc.stories.map((s) => (s.key === "prize_draw" ? { ...s, enabled: false } : s));
      await writeStories(c, off, doc.settings, doc.revision + 1);
    });
    expect(await seed({ items: [raffle("it_raffle2", "2026-01-02T21:00:00Z")] })).toBe(HAND_MADE);
    expect((await prizeDraw())?.enabled).toBe(false);
  });

  it("storyboards changed by hand before any seed keep it out", async () => {
    await w.tx("demo", async (c) => {
      const doc = await loadStories(c);
      await writeStories(c, doc.stories, doc.settings, 1);
    });
    expect(await seed()).toBe(HAND_MADE);
  });

  it("force puts the presets back with Prize draw on", async () => {
    await seed();
    await w.tx("demo", async (c) => {
      const doc = await loadStories(c);
      await writeStories(c, doc.stories.slice(0, 2), doc.settings, doc.revision + 1);
    });
    expect(await seed({ force: true })).toBe(READY);
    const doc = await stories();
    expect(doc.stories.length).toBeGreaterThan(3);
    expect((await prizeDraw())?.enabled).toBe(true);
    expect(T0.getTime()).toBeLessThan(Date.parse(AGENDA[1]?.starts_at ?? ""));
  });

  it("other events are untouched", async () => {
    await seed();
    expect((await w.tx("two", (c) => loadStories(c))).copied).toBe(false);
  });
});
