/** Studio → Moments → Scenes (sheet 12) and the scene on On air (mockup 14), as a browser uses them. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { loadScenes } from "../src/scene-store.js";
import { DATABASE_URL, freshDatabase } from "./helpers.js";
import { appWorld } from "./app.js";
import type { AppWorld } from "./app.js";

const run = DATABASE_URL ? describe : describe.skip;
const form = { form: true };

run("the Scenes page", () => {
  let pool: pg.Pool | undefined;
  let w: AppWorld;
  beforeEach(async () => {
    if (pool !== undefined) {
      await w.app.close();
      await pool.end();
    }
    pool = await freshDatabase();
    w = await appWorld(pool, {
      agenda: () =>
        Promise.resolve({
          agenda_version: 1,
          items: [
            {
              id: "ai_1",
              kind: "tournament",
              zone: null,
              visibility: "public",
              status: "scheduled",
              starts_at: "2026-01-01T20:00:00Z",
              ends_at: "2026-01-01T22:00:00Z",
            },
          ],
        }),
    });
    await w.tx("demo", (c) =>
      c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main'), ('stage')`),
    );
  });
  afterAll(async () => {
    await w.app.close();
    await pool?.end();
  });

  const stored = () => w.tx("demo", (c) => loadScenes(c));

  it("draws the band chart, the list in order and each zone's scene, read-only for a reader", async () => {
    const page = await w.call("reader", "GET", "/scenes");
    expect(page.statusCode).toBe(200);
    for (const text of ["The event at a glance", "Quiet", "Wind down", "Doors", "Peak", "Daytime"])
      expect(page.body).toContain(text);
    expect(page.body).toContain("tournament or ceremony on the run of show");
    expect(page.body).toContain('class="moments-band');
    expect(page.body).not.toContain("Reset to default");
    expect(page.body).not.toContain("Peak now");
  });

  it("adds a scene from a preset, edits its conditions and changes, moves and deletes it", async () => {
    const add = await w.call(
      "admin",
      "POST",
      "/scenes/add",
      { preset: "peak", revision: "0" },
      form,
    );
    expect(add.statusCode).toBe(303);
    expect(add.headers.location).toBe("/moments/scenes?edit=peak-2");
    const edit = await w.call("admin", "GET", "/scenes?edit=peak-2");
    expect(edit.body).toContain('name="time_from"');
    expect(edit.body).toContain('value="Peak (copy)"');
    const save = await w.call(
      "admin",
      "POST",
      "/scenes/save",
      {
        key: "peak-2",
        revision: "1",
        name: "Late peak",
        zone: "main",
        time_from: "22:00",
        time_to: "03:00",
        online_over: "150",
        games: "yes",
        crew_minutes: "45",
        motion: "party",
        layout_main: "dashboard",
        stage_mood: "peak",
        palette_on: "yes",
        palette_primary: "#112233",
        palette_accent: "#445566",
        sound: "on",
        hero_off: "playlist",
        hold_minutes: "20",
        blend_seconds: "30",
      },
      form,
    );
    expect(save.statusCode).toBe(303);
    expect(save.headers.location).toContain("done=");
    const late = (await stored()).scenes.find((s) => s.key === "peak-2");
    expect(late).toEqual({
      key: "peak-2",
      name: "Late peak",
      preset: "peak",
      zones: ["main"],
      when: [
        { type: "time", from: "22:00", to: "03:00" },
        { type: "presence", over: 150 },
        { type: "games" },
        { type: "crew", minutes: 45 },
      ],
      then: {
        motion: "party",
        layouts: { main: "dashboard" },
        stage_mood: "peak",
        palette: { primary: "#112233", accent: "#445566" },
        sound: true,
        quiet: false,
        hero_off: ["playlist"],
      },
      hold_minutes: 20,
      blend_seconds: 30,
    });
    const bad = await w.call(
      "admin",
      "POST",
      "/scenes/save",
      { key: "peak-2", revision: "2", name: "Bad", time_from: "25:00", time_to: "03:00" },
      form,
    );
    expect(bad.headers.location).toContain("error=");
    const up = await w.call(
      "admin",
      "POST",
      "/scenes/move",
      { key: "peak-2", by: "-1", revision: "2" },
      form,
    );
    expect(up.headers.location).toContain("done=");
    // A copy goes just above its preset, so it wins over it; ▲ moves it one up.
    expect((await stored()).scenes.map((s) => s.key)).toEqual([
      "quiet",
      "wind_down",
      "peak-2",
      "doors",
      "peak",
      "daytime",
    ]);
    await w.call("admin", "POST", "/scenes/delete", { key: "peak-2", revision: "3" }, form);
    expect((await stored()).scenes.map((s) => s.key)).not.toContain("peak-2");
    const reset = await w.call("admin", "POST", "/scenes/reset", { revision: "4" }, form);
    expect(reset.headers.location).toContain("done=");
  });

  it("shows each zone's scene on On air and puts Peak on with one tap", async () => {
    await w.call("admin", "POST", "/scenes/reset", { revision: "0" }, form);
    const onAir = await w.call("crew", "GET", "/on-air");
    expect(onAir.body).toContain("Scene: Daytime");
    expect(onAir.body).toContain("Peak now");
    const tap = await w.call(
      "crew",
      "POST",
      "/scenes/peak/take",
      { from: "on-air", idempotency_key: "tap-0000001" },
      form,
    );
    expect(tap.statusCode).toBe(303);
    expect(tap.headers.location).toMatch(/^\/moments\/on-air\?done=/);
    const after = await w.call("crew", "GET", "/on-air");
    expect(after.body).toContain("Scene: Peak");
    expect(after.body).toContain("the crew pressed it");
    expect(after.body).toContain("End Peak");
    const reader = await w.call("reader", "POST", "/scenes/peak/take", { from: "on-air" }, form);
    expect(reader.statusCode).toBe(403);
  });
});
