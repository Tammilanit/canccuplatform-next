/**
 * On air rebalanced (#638; docs/design/moments-on-air.svg): one grid, crew actions first, no rank
 * numbers, one item picker and one Fire… chooser, Fire's result in words; and zones by the names
 * Screen gives them on every Moments page that shows one (P2–P9, P14–P17).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { applyClaims } from "../src/placements.js";
import { storeAgenda } from "../src/scene-store.js";
import { addZone } from "../src/store.js";
import { DATABASE_URL, claims, freshDatabase } from "./helpers.js";
import { appWorld, idOf } from "./app.js";
import type { AppWorld } from "./app.js";
import { ITEM, TABLES } from "./story-kit.js";

const form = { form: true };

describe.skipIf(!DATABASE_URL)("On air and the zones' names", () => {
  let pool: pg.Pool;
  let w: AppWorld;
  beforeAll(async () => {
    pool = await freshDatabase();
  });
  afterAll(async () => {
    await w.app.close();
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`TRUNCATE ${TABLES}, moments_idempotency`);
    w = await appWorld(pool);
    w.now = new Date("2026-01-01T18:40:00Z");
    w.zoneNames.set("main", "Main hall").set("entrance", "Entrance");
    await w.tx("demo", async (c) => {
      await addZone(c, "main");
      await addZone(c, "entrance");
      await storeAgenda(c, { agenda_version: 1, items: [ITEM] });
    });
  });

  it("puts crew actions first, then Storyboards, the zones and Scenes, in one grid", async () => {
    const page = (await w.call("admin", "GET", "/on-air")).body;
    const at = (cls: string) => page.indexOf(`moments-onair__${cls}`);
    expect(at("crew")).toBeGreaterThan(-1);
    expect(at("crew")).toBeLessThan(at("stories"));
    expect(at("stories")).toBeLessThan(at("zones"));
    expect(at("zones")).toBeLessThan(at("scenes"));
  });

  it("draws a zone by its name and a moment without its rank", async () => {
    const top = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "Pizza is here",
    });
    await w.tx("demo", (c) => applyClaims(c, claims("main", [[idOf(top), "hero"]], []), w.now));
    const page = (await w.call("crew", "GET", "/on-air")).body;
    expect(page).toContain("Main hall</h2>");
    expect(page).toContain("Entrance</h2>");
    expect(page).not.toMatch(/>\s*main\s*</);
    expect(page).not.toMatch(/rank \d/);
    expect(page).toContain("Pizza is here");
  });

  it("keeps the zone's key while Screen does not name it", async () => {
    w.zoneNames.clear();
    const page = (await w.call("crew", "GET", "/on-air")).body;
    expect(page).toContain("main</h2>");
  });

  it("fires from one item picker and one Fire… chooser of the presets", async () => {
    const page = (await w.call("crew", "GET", "/on-air")).body;
    expect(page.match(/name="item_id"/g)).toHaveLength(1);
    expect(page).toContain("Demo Game Cup final · 19:00");
    expect(page).toMatch(/<summary[^>]*>\s*Fire…\s*<\/summary>/);
    expect(page).toContain('formaction="/moments/storyboards/starting_soon/fire"');
    expect(page).toContain('formaction="/moments/storyboards/champion/fire"');
  });

  it("says after Fire when the story plays, and On air says the loop's next round", async () => {
    const fired = await w.call(
      "crew",
      "POST",
      "/storyboards/starting_soon/fire",
      { idempotency_key: "k-fire-638", item_id: "it_final", back: "on-air" },
      form,
    );
    expect(fired.statusCode).toBe(303);
    const done = new URL(String(fired.headers.location), "http://x").searchParams.get("done");
    expect(done).toBe("Starting soon starts at 18:45, at T−15.");
    const live = (await w.call("crew", "GET", "/on-air")).body;
    expect(live).toContain("next round 18:45 (T−15)");
    expect(live).not.toContain("between rounds");
  });

  it("refuses Fire on an item the story does not take, in words", async () => {
    await w.tx("demo", (c) =>
      storeAgenda(c, {
        agenda_version: 2,
        items: [ITEM, { ...ITEM, id: "it_meal", title: "Dinner", kind: "meal" }],
      }),
    );
    const fired = await w.call(
      "crew",
      "POST",
      "/storyboards/starting_soon/fire",
      { idempotency_key: "k-fire-meal", item_id: "it_meal", back: "on-air" },
      form,
    );
    const error = new URL(String(fired.headers.location), "http://x").searchParams.get("error");
    expect(error).toBe("Starting soon does not take Dinner: pick a tournament or ceremony item.");
  });

  it("names the zones on the spotlight form, the rules, History, the sound desk and Test-fire", async () => {
    const pages = {
      spotlight: (await w.call("crew", "GET", "/spotlight")).body,
      priorities: (await w.call("admin", "GET", "/priorities")).body,
      history: (await w.call("admin", "GET", "/history")).body,
      cues: (await w.call("admin", "GET", "/cues")).body,
      limits: (await w.call("admin", "GET", "/cues/limits")).body,
      builder: (await w.call("admin", "GET", "/storyboards?edit=starting_soon")).body,
    };
    for (const [name, body] of Object.entries(pages)) {
      expect(body, name).toContain("Main hall");
      expect(body, name).not.toMatch(/>\s*main\s*</);
    }
    // Cue pickers by name (#638): no `tournament.start` as an option's words.
    expect(pages.priorities).not.toMatch(/<option[^>]*>\s*[a-z]+\.[a-z_.]+\s*<\/option>/);
    expect(pages.builder).toContain("Test-fire on <span data-zone-name>Main hall</span>");
    const test = await w.call(
      "admin",
      "POST",
      "/storyboards/starting_soon/test",
      { idempotency_key: "k-test-638", zone: "main" },
      form,
    );
    expect(decodeURIComponent(String(test.headers.location))).toContain(
      "One test round on Main hall.",
    );
  });
});
