/**
 * Studio → Moments → Storyboards (SU5) and the crew's part on On air (SU2), as a browser uses
 * them: the preset picker of mockup 21 (every event and some venues, on or off, what triggers
 * each, its status, duplicate, reset, the rule a preset replaces), the builder of mockup 18 (triggers as sentences, the step strip with floors,
 * the repeat, the rounds' timeline, the cue per step and "+ New cue", the meters, the preview
 * and the test-fire), a save through the form, and Fire, Stop loop and Skip to finale.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { storeAgenda } from "../src/scene-store.js";
import { addZone } from "../src/store.js";
import { PRESETS } from "../src/story/presets.js";
import { DEFAULT_SETTINGS, ensureStories, writeStories } from "../src/story/store.js";
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
      // The header: Test-fire and Save stay in reach (sheet 05, 1).
      "Test-fire on",
      'form="story-save"',
      // Triggers and conditions as chip rows, labels in one column (2).
      "Plays when",
      "A tournament or ceremony item starts",
      "By hand, from On air",
      "Add a trigger",
      "Only if",
      "Every zone",
      "Quiet scene: calm and silent",
      "Add a condition",
      // The rounds on a timeline, one switch for set times or a loop (3).
      "At set times",
      "Every few minutes",
      "−15 min",
      "−1 min",
      "Add a round",
      "the item starts",
      "the first and last round",
      "Finale: It&#39;s on! · 8 s",
      "moments-timeline",
      // The round as a strip of steps, the repeat a bracket (4), the step's form beside it (5).
      " · 4 steps",
      "×2",
      "1 · Sting",
      "2 · Countdown",
      "Step 1 · Sting",
      "Remove step",
      // Fields on a grid: seconds a slider, placeholders as chips, what they fill with (6).
      'type="range"',
      "{item.title}",
      "Fills with: Demo Game Cup final",
      "+ New cue (story.starting_soon.1)",
      "/moments/cues/new?name=story.starting_soon.1",
      // The live preview with scrub (7) and the checks before saving (8).
      "data-story-scrub",
      "Play round",
      "Whole loop",
      "Before you save",
      "Airtime on the hero",
      "Sounds per run, per zone",
      // On a phone: three parts and the checks in one line (sheet 06).
      "Overview",
      "to look at",
    ])
      expect(b.body, text).toContain(text);
  });

  it("picks presets: every event and some venues, what triggers each, its status and the rule it replaces", async () => {
    const list = await w.call("admin", "GET", "/storyboards");
    expect(list.statusCode).toBe(200);
    for (const text of [
      "Every event",
      "Some venues",
      "Meal is served",
      "Premiere",
      "Champion replay",
      "item meal · start",
      "every 5 min · 3 rounds · until it ends",
      "idle: no matching item in the run of show",
      "next: Thu 19:00 Demo Game Cup final",
      "replaces rule match_called",
      "would replace rule hot_game",
      "takes the arrived order from rule pizza",
      "pick an item",
      "Reset all to default",
      "Duplicate",
      "New storyboard",
    ])
      expect(list.body, text).toContain(text);
  });

  it("turns presets on and off, copies one an older event lacks, and turns Champion replay with Champion", async () => {
    await w.tx("demo", (c) => writeStories(c, PRESETS.slice(0, 5), DEFAULT_SETTINGS, 3));
    const list = await w.call("admin", "GET", "/storyboards");
    expect(list.body).toContain("not in this event yet");
    // An uncopied preset is Off whatever the platform default says, so its button matches toggled().
    const uncopied = /storyboards\/pizza_last_call\/toggle[\s\S]{0,400}/.exec(list.body)?.[0] ?? "";
    expect(uncopied).toContain("Turn on");
    expect(uncopied).not.toContain("Turn off");
    const toggle = (key: string, revision: number) =>
      w.call(
        "admin",
        "POST",
        `/storyboards/${key}/toggle`,
        { idempotency_key: `k-${key}-${String(revision)}`, revision: String(revision) },
        form,
      );
    expect((await toggle("meal_served", 3)).headers.location).toContain("done=");
    expect((await toggle("champion", 4)).headers.location).toContain("done=");
    let doc = await w.tx("demo", (c) => ensureStories(c));
    const on = (key: string) => doc.stories.find((s) => s.key === key)?.enabled;
    expect([on("meal_served"), on("champion"), on("champion_replay")]).toEqual([
      true,
      false,
      undefined,
    ]);
    await toggle("champion", 5);
    doc = await w.tx("demo", (c) => ensureStories(c));
    expect([on("champion"), on("champion_replay")]).toEqual([true, true]);
    // Premiere needs its video first.
    const premiere = await toggle("premiere", 6);
    expect(decodeURIComponent(String(premiere.headers.location))).toContain(
      "choose the video before turning it on",
    );
  });

  it("duplicates a preset to edit, opens the copy's builder, and resets every preset to default", async () => {
    const dup = await w.call(
      "admin",
      "POST",
      "/storyboards/doors_open/duplicate",
      { idempotency_key: "k-dup", revision: "0" },
      form,
    );
    expect(dup.statusCode).toBe(303);
    expect(dup.headers.location).toContain("storyboards?edit=doors_open_copy");
    let doc = await w.tx("demo", (c) => ensureStories(c));
    expect(doc.stories.find((s) => s.key === "doors_open_copy")).toMatchObject({
      name: "Doors open (copy)",
      preset: null,
      enabled: false,
    });
    const own = await w.call("admin", "GET", "/storyboards");
    expect(own.body).toContain("Your storyboards");
    await w.call(
      "admin",
      "POST",
      "/storyboards/meal_served/toggle",
      { idempotency_key: "k-off", revision: "1" },
      form,
    );
    const reset = await w.call(
      "admin",
      "POST",
      "/storyboards/reset",
      { idempotency_key: "k-reset", revision: "2" },
      form,
    );
    expect(reset.headers.location).toContain("done=");
    doc = await w.tx("demo", (c) => ensureStories(c));
    expect(doc.stories.find((s) => s.key === "meal_served")?.enabled).toBe(true);
    expect(doc.stories.some((s) => s.key === "doors_open_copy")).toBe(true);
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

  // #611: the Fire form lists only the items the person may see (canSee).
  it("lists a crew-only item in the Fire form only for a crew reader", async () => {
    const secret = { ...ITEM, id: "it_crew", title: "Crew briefing", visibility: "crew" };
    await w.tx("demo", (c) => storeAgenda(c, { agenda_version: 2, items: [ITEM, secret] }));
    const crew = await w.call("crew", "GET", "/on-air");
    expect(crew.body).toContain("Demo Game Cup final · 19:00");
    expect(crew.body).not.toContain("Crew briefing");
    expect((await w.call("lead", "GET", "/on-air")).body).toContain("Crew briefing");
  });

  // #624 (O2, R22): firing on a past item went straight to the finale.
  it("offers Fire only the coming items its story takes, the next one first", async () => {
    const at = (iso: string) => ({
      starts_at: iso,
      ends_at: iso.slice(0, 11) + "23:00:00Z",
    });
    const past = { ...ITEM, id: "it_past", title: "Opening match", ...at("2026-01-01T18:00:00Z") };
    const doors = {
      ...ITEM,
      id: "it_doors",
      title: "Doors open",
      kind: "doors",
      ...at("2026-01-01T18:50:00Z"),
    };
    const awards = {
      ...ITEM,
      id: "it_awards",
      title: "Awards",
      kind: "ceremony",
      ...at("2026-01-01T21:00:00Z"),
    };
    await w.tx("demo", (c) =>
      storeAgenda(c, { agenda_version: 2, items: [past, doors, awards, ITEM] }),
    );
    const page = (await w.call("crew", "GET", "/on-air")).body;
    const fire = page.slice(page.indexOf('action="/moments/storyboards/starting_soon/fire"'));
    const select = fire.slice(0, fire.indexOf("</select>"));
    expect(select).not.toContain("Opening match");
    expect(select).not.toContain("Doors open");
    expect(select).toContain("Awards");
    expect(select.indexOf("Demo Game Cup final")).toBeLessThan(select.indexOf("Awards"));
    expect(select).toMatch(/value="it_final"\s*selected/);
  });

  it("keeps the catalogue and its Fire panel in one grid that fits a phone", async () => {
    const page = (await w.call("crew", "GET", "/storyboards")).body;
    expect(page).toContain('class="moments-stories"');
    expect(page).toContain('class="moments-stories__side"');
    expect(page).toContain('class="moments-presets"');
    expect(page).not.toContain("<table");
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

  it("opens the sound desk's new cue with the story's cue name filled in", async () => {
    const r = await w.call("admin", "GET", "/cues/new?name=story.starting_soon.1");
    expect(r.body).toContain('value="story.starting_soon.1"');
  });
});
