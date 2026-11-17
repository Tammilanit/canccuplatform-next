/**
 * A story that cannot be built never stops the event's tick (#611): its fault stays in its own
 * savepoint, so the other stories, runs, expiries and announcements of that second go on; and a
 * free placeholder named after an Object.prototype key fills with nothing.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fillText } from "../src/story/fill.js";
import type { Story } from "../src/story/model.js";
import { DATABASE_URL, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { TABLES, kit, step, story } from "./story-kit.js";

/** 19:00: T0 is 18:00. */
const T = 3600;
const hourly = (o: Partial<Story>): Story =>
  story({
    triggers: [
      { kind: "clock", mode: "every", at: null, every_minutes: 60, from: "10:00", until: "22:00" },
    ],
    ...o,
  });

describe("free placeholders", () => {
  it("fill a name of Object.prototype with nothing, or the run's own fact", () => {
    const ctx = {
      now: Date.parse("2026-01-01T19:00:00Z"),
      t: Date.parse("2026-01-01T19:00:00Z"),
      timeZone: "UTC",
      facts: {},
      eventName: "Demo Event",
      eventStartsAt: null,
      eventEndsAt: null,
      hostname: null,
    };
    expect(fillText("[{constructor}]", ctx)).toBe("[]");
    expect(fillText("[{toString|none}]", ctx)).toBe("[none]");
    expect(fillText("[{constructor}]", { ...ctx, facts: { constructor: "x" } })).toBe("[x]");
  });
});

describe.skipIf(!DATABASE_URL)("a story that cannot be built", () => {
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

  it("plays a `{constructor}` placeholder as nothing", async () => {
    await k.setup([
      hourly({
        round: {
          steps: [step({ content: { title: "At {constructor}" } })],
          repeat: null,
          hold_seconds: null,
        },
      }),
    ]);
    await k.tick(w.at(T));
    const steps = (k.started()[0]?.steps ?? []) as { content: Record<string, unknown> }[];
    expect(steps[0]?.content.title).toBe("At ");
  });

  it("leaves the other stories of that second to fire", async () => {
    // Stored past the checks, as an older row or a hand edit could be.
    const broken = step({ content: null as never });
    await k.setup([
      hourly({ key: "broken", round: { steps: [broken], repeat: null, hold_seconds: null } }),
      hourly({ key: "fine" }),
    ]);
    await k.tick(w.at(T));
    expect((await k.runs()).map((r) => r.story_key)).toEqual(["fine"]);
  });
});
