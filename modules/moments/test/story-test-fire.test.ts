/**
 * A test-fire is silent unless the crew chose sound (#114, #611): a video step's own sound too,
 * which would otherwise count against the zone's budgets and hold its other sound. And it fills
 * the placeholders its trigger has no value for with sample text (#668, R21): a test of "Match
 * called: {match.label}" never shows an empty value on screen.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadStories } from "../src/story/store.js";
import { takeStory } from "../src/story/triggers.js";
import type { Story } from "../src/story/model.js";
import { DATABASE_URL, freshDatabase, world } from "./helpers.js";
import type { World } from "./helpers.js";
import { TABLES, kit, preset, step, story } from "./story-kit.js";

const CREW = { user_id: "u_crew", name: "Demo Crew" };
const FILM = {
  asset_id: "as_film",
  kind: "video",
  url: "/api/screen/files/abc.mp4",
  duration_ms: 60_000,
  title: "Last year",
};

describe.skipIf(!DATABASE_URL)("a test-fire's sound", () => {
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
    await k.setup([
      story({
        round: {
          steps: [step({ template: "video", content: FILM })],
          repeat: null,
          hold_seconds: null,
        },
      }),
    ]);
  });

  const testFire = (sound: boolean) =>
    k.tx(async (c) => {
      const doc = await loadStories(c);
      return takeStory(
        { c, engine: w.engine, now: w.at(0), settings: doc.settings, event: doc.event },
        doc.stories[0] as Story,
        { item: null, variables: {}, actor: CREW, test: { zone: "main", sound } },
      );
    });

  it("mutes a video step's own sound without sound chosen, and logs no sound", async () => {
    await testFire(false);
    const video = k.started().find((o) => o.template === "video");
    expect(video?.content).toMatchObject({ url: FILM.url, muted_zones: ["main"] });
    expect(await k.soundLog()).toEqual([]);
  });

  it("plays a video step's own sound with sound chosen", async () => {
    await testFire(true);
    const video = k.started().find((o) => o.template === "video");
    expect(video?.content).toMatchObject({ url: FILM.url, muted_zones: [] });
    expect((await k.soundLog()).map((s) => `${s.zone_key} ${s.cue} ${s.outcome}`)).toEqual([
      "main story.video played",
    ]);
  });
});

describe.skipIf(!DATABASE_URL)("a test-fire's placeholders", () => {
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

  const fire = (test: boolean) =>
    k.tx(async (c) => {
      const doc = await loadStories(c);
      return takeStory(
        { c, engine: w.engine, now: w.at(0), settings: doc.settings, event: doc.event },
        doc.stories[0] as Story,
        {
          item: null,
          variables: {},
          actor: CREW,
          test: test ? { zone: "main", sound: false } : null,
        },
      );
    });
  const texts = () =>
    k
      .started()
      .flatMap((o) => (o.steps ?? []) as { content: Record<string, unknown> }[])
      .map((s) => `${String(s.content.title)} | ${String(s.content.subtitle)}`);

  it("fills Match called's match and teams with sample text", async () => {
    await k.setup([preset("match_called", { triggers: [{ kind: "take" }] })]);
    await fire(true);
    const [card] = texts().filter((t) => t.startsWith("Match called"));
    expect(card).toBeDefined();
    expect(card).not.toMatch(/Match called: \|/);
    expect(card).toMatch(/^Match called: \S.* \| \S.* · \S/);
  });

  it("keeps a placeholder's own fallback over the sample", async () => {
    await k.setup([
      story({
        round: {
          steps: [
            step({
              content: { title: "At {item.location|the stage}", subtitle: "", image_url: null },
              message: true,
            }),
          ],
          repeat: null,
          hold_seconds: null,
        },
      }),
    ]);
    await fire(true);
    expect(texts()).toEqual(["At the stage | "]);
  });

  it("leaves a real fire's missing value empty: samples are for tests only", async () => {
    await k.setup([
      story({
        round: {
          steps: [
            step({
              content: { title: "Match called: {match.label}", subtitle: "", image_url: null },
              message: true,
            }),
          ],
          repeat: null,
          hold_seconds: null,
        },
      }),
    ]);
    await fire(false);
    expect(texts()).toEqual(["Match called:  | "]);
  });
});
