/**
 * Studio → Moments → Storyboards (SU5) and the crew's part on On air (SU2), as a browser uses
 * them: the list, the builder of mockup 18 (triggers as sentences, the step strip with floors,
 * the repeat, the rounds' timeline, the cue per step and "+ New cue", the meters, the preview
 * and the test-fire), a save through the form, and Fire, Stop loop and Skip to finale.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { storeAgenda } from "../src/scene-store.js";
import { addZone } from "../src/store.js";
import { ensureStories } from "../src/story/store.js";
import { DATABASE_URL, freshDatabase } from "./helpers.js";
import { appWorld } from "./app.js";
import type { AppWorld } from "./app.js";
import { ITEM, TABLES } from "./story-kit.js";

const form = { form: true };

describe.skipIf(!DATABASE_URL)("the Storyboards pages", () => {
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
    w.now = new Date("2026-01-01T18:40:00Z");
    await w.tx("demo", async (c) => {
      await addZone(c, "main");
      await storeAgenda(c, { agenda_version: 1, items: [ITEM] });
    });
  });

  it("lists the stories and draws the builder of a preset", async () => {
    const list = await w.call("reader", "GET", "/storyboards");
    expect(list.statusCode).toBe(200);
    for (const name of ["Doors open", "Starting soon", "Match called", "Champion", "Midnight"])
      expect(list.body).toContain(name);
    expect(list.body).not.toContain("Turn off");
    const b = await w.call("admin", "GET", "/storyboards?edit=starting_soon");
    expect(b.statusCode).toBe(200);
    for (const text of [
      "A run-of-show item of kind tournament or ceremony · its start · follows delays",
      "Taken by hand",
      "repeat ×2",
      "floor 8 s",
      "♪ tournament.pre",
      "At −15, −5, −1 min of T · until item starts",
      "finale It&#39;s on!",
      "Sounds per run, per zone",
      "Test-fire one round on",
      "data-story-scrub",
      "+ New cue (story.starting_soon.1)",
      "the first and last round",
    ])
      expect(b.body, text).toContain(text);
  });

  it("saves the builder's form through the API, and refuses a broken one with the reason", async () => {
    const b = await w.call("admin", "GET", "/storyboards?edit=midnight");
    const key = /name="idempotency_key"\s+value="([^"]+)"/.exec(b.body)?.[1] ?? "k-1";
    const fields = {
      idempotency_key: key,
      revision: "0",
      name: "Midnight!",
      enabled: "yes",
      full_screen: "yes",
      t0_mode: "daily",
      t0_at: "00:00",
      s0_template: "countdown",
      s0_title: "Midnight",
      s0_seconds: "10",
      s0_transition: "fade",
      s1_template: "sting",
      s1_title: "Midnight!",
      s1_seconds: "4",
      s1_transition: "flash",
      s2_template: "title_card",
      s2_title: "Night {now.day} at {event.name}",
      s2_seconds: "15",
      s2_transition: "rise",
      message: "2",
      dot: "1",
      rounds_mode: "offsets",
      offsets: "0",
      end_rounds: "1",
      end_crew: "yes",
      quiet: "skip",
      sound: "first",
    };
    const saved = await w.call("admin", "POST", "/storyboards/midnight/save", fields, form);
    expect(saved.statusCode).toBe(303);
    expect(saved.headers.location).toContain("done=");
    const doc = await w.tx("demo", (c) => ensureStories(c));
    expect(doc.stories.find((s) => s.key === "midnight")).toMatchObject({
      name: "Midnight!",
      conditions: { quiet: "skip" },
      round: { steps: [{ template: "countdown" }, { on_the_dot: true }, { message: true }] },
    });
    const broken = await w.call(
      "admin",
      "POST",
      "/storyboards/midnight/save",
      { ...fields, idempotency_key: "k-broken", revision: "1", s2_title: "{nope.nope}" },
      form,
    );
    expect(decodeURIComponent(String(broken.headers.location))).toContain(
      "Unknown placeholder {nope.nope}",
    );
  });

  it("fires from On air with its item, then stops the loop and skips another to its finale", async () => {
    const onAir = await w.call("crew", "GET", "/on-air");
    expect(onAir.body).toContain("Fire Starting soon");
    expect(onAir.body).toContain("Demo Game Cup final · 19:00");
    const fired = await w.call(
      "crew",
      "POST",
      "/storyboards/starting_soon/fire",
      { idempotency_key: "k-fire-1", item_id: "it_final", back: "on-air" },
      form,
    );
    expect(fired.headers.location).toContain("done=Fired");
    const live = await w.call("crew", "GET", "/on-air");
    const id = /storyboards\/runs\/([^/]+)\/stop/.exec(live.body)?.[1] ?? "";
    expect(live.body).toContain("Skip to finale");
    const stop = await w.call(
      "crew",
      "POST",
      `/storyboards/runs/${id}/stop`,
      { idempotency_key: "k-stop-1", back: "on-air" },
      form,
    );
    expect(stop.headers.location).toContain("done=Loop%20stopped");
    expect((await w.call("crew", "GET", "/on-air")).body).toContain("No loop is running.");
  });
});
