/**
 * The storyboard builder's page and its saves (#627, step 4 polish sheets 05 and 06): the chosen
 * step's form opens beside the strip with every other step's fields still in the form, and the
 * rounds as chips, a dragged order and a moved step save through the same API. The builder's
 * drawing is in story-pages.test.ts and in Chromium in story-builder.browser.test.ts.
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

describe.skipIf(!DATABASE_URL)("the storyboard builder's page", () => {
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

  it("opens the chosen step's form beside the strip and keeps the others in the form", async () => {
    const b = await w.call("admin", "GET", "/storyboards?edit=starting_soon&step=1");
    const form = (i: number) =>
      new RegExp(`<fieldset[^>]*data-step-form="${String(i)}"[^>]*>`).exec(b.body)?.[0] ?? "";
    expect(form(0)).toContain("hidden");
    expect(form(1)).not.toContain("hidden");
    expect(b.body).toContain("Step 2 · Countdown");
    expect(b.body).toMatch(
      /aria-current="step"[^>]*data-step="1"|data-step="1"[^>]*aria-current="step"/,
    );
    // Every step's fields go with the form, so saving one step never empties another.
    expect(b.body).toContain('name="s0_title"');
    expect(b.body).toContain('name="s1_title"');
  });

  it("saves rounds as chips, a dragged order and a moved step through the same API", async () => {
    const b = await w.call("admin", "GET", "/storyboards?edit=midnight");
    const key = /name="idempotency_key"\s+value="([^"]+)"/.exec(b.body)?.[1] ?? "k-1";
    const fields: [string, string][] = [
      ["idempotency_key", key],
      ["revision", "0"],
      ["name", "Midnight"],
      ["enabled", "yes"],
      ["t0_mode", "daily"],
      ["t0_at", "00:00"],
      ["s0_template", "countdown"],
      ["s0_title", "Midnight"],
      ["s0_seconds", "10"],
      ["s0_transition", "fade"],
      ["s1_template", "sting"],
      ["s1_title", "Midnight!"],
      ["s1_seconds", "4"],
      ["s1_transition", "flash"],
      ["s2_template", "title_card"],
      ["s2_title", "Night {now.day} at {event.name}"],
      ["s2_seconds", "15"],
      ["s2_transition", "rise"],
      ["message", "2"],
      ["dot", "1"],
      ["rounds_mode", "offsets"],
      // Each round is a chip with its own field; an empty "Add a round" adds nothing.
      ["offsets", "-2"],
      ["offsets", "0"],
      ["offsets", ""],
      ["end_crew", "yes"],
      ["sound", "first"],
      // Dragged: the title card first, then the countdown and the sting.
      ["order", "2,0,1"],
    ];
    const save = (extra: [string, string][], k: string, revision: string) =>
      w.call(
        "admin",
        "POST",
        "/storyboards/midnight/save",
        [
          ...fields.filter(
            ([n]) => n !== "idempotency_key" && n !== "revision" && !extra.some(([x]) => x === n),
          ),
          ["idempotency_key", k],
          ["revision", revision],
          ...extra,
        ],
        form,
      );
    const saved = await save([["step", "0"]], key, "0");
    expect(saved.headers.location).toContain("done=");
    let doc = await w.tx("demo", (c) => ensureStories(c));
    const story = () => doc.stories.find((s) => s.key === "midnight");
    expect(story()?.rounds).toEqual({ mode: "offsets", offsets_minutes: [-2, 0] });
    expect(story()?.round.steps.map((s) => s.template)).toEqual([
      "title_card",
      "countdown",
      "sting",
    ]);
    // The marks travel with their steps.
    expect(story()?.round.steps.map((s) => [s.message, s.on_the_dot])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
    // "Move later" on the first step (the countdown, field s0, before the drag) saves it moved.
    const moved = await save(
      [
        ["order", "0,1,2"],
        ["move", "0:1"],
      ],
      "k-move",
      "1",
    );
    expect(moved.headers.location).toContain("step=1");
    doc = await w.tx("demo", (c) => ensureStories(c));
    expect(story()?.round.steps.map((s) => s.template)).toEqual([
      "sting",
      "countdown",
      "title_card",
    ]);
    // A step added through its button opens at once.
    const added = await save([["add_step", "yes"]], "k-add", "2");
    expect(added.headers.location).toContain("step=3");
  });
});
