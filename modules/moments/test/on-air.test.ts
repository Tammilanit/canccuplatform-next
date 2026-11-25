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
import { DEFAULT_SETTINGS, writeStories } from "../src/story/store.js";
import { DATABASE_URL, claims, freshDatabase } from "./helpers.js";
import { appWorld, idOf } from "./app.js";
import type { AppWorld } from "./app.js";
import { ITEM, TABLES, step, story } from "./story-kit.js";

const form = { form: true };
const doneOf = (r: { headers: Record<string, unknown> }) =>
  new URL(String(r.headers.location), "http://x").searchParams.get("done");

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

  it("puts the crew band first, then the zones' grid, then Storyboards and Scenes in a band (sheet 02)", async () => {
    const page = (await w.call("admin", "GET", "/on-air")).body;
    const at = (s: string) => page.indexOf(s);
    expect(at("moments-onair__crew")).toBeGreaterThan(-1);
    expect(at("moments-onair__crew")).toBeLessThan(at("canccu-grid moments-onair__zones"));
    expect(at("canccu-grid moments-onair__zones")).toBeLessThan(
      at("canccu-band moments-onair__panels"),
    );
    expect(at("canccu-band moments-onair__panels")).toBeLessThan(at("moments-firepanel"));
    expect(at("moments-firepanel")).toBeLessThan(at("moments-onair__scenes"));
  });

  it("lists the zones in Screen's order, by key, and a zone's queue as a list in its order (#777)", async () => {
    w.zoneNames.set("bar", "Bar").set("stage", "Stage");
    await w.tx("demo", async (c) => {
      await addZone(c, "stage");
      await addZone(c, "bar");
    });
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await w.call("crew", "POST", "/api/moments/spotlight", {
        show: "message",
        title: `Note ${String(n)}`,
        zones: ["bar"],
      });
    }
    const page = (await w.call("crew", "GET", "/on-air")).body;
    const names = [
      ...page.matchAll(/<li class="canccu-card moments-zone">\s*<h2[^>]*>([^<]*)</g),
    ].map((m) => m[1]);
    expect(names).toEqual(["Bar", "Entrance", "Main hall", "Stage"]);
    const bar = page.slice(page.indexOf(">Bar</h2>"), page.indexOf(">Entrance</h2>"));
    // Each crew spotlight cuts the one before (a person's action), which waits in the queue.
    expect(bar.match(/class="moments-item /g)).toHaveLength(1);
    expect(bar.match(/moments-queue__item/g)).toHaveLength(5);
    expect(bar.indexOf("Note 1")).toBeGreaterThan(-1);
    expect(bar).toContain("Move forward");
    expect(bar).toMatch(/>\s*Skip\s*</);
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

  it("counts what is on air and what waits in a zone's summary (#777)", async () => {
    const ids = [];
    for (const title of ["On now", "Under the full screen", "In the queue"])
      ids.push(
        idOf(await w.call("crew", "POST", "/api/moments/spotlight", { show: "message", title })),
      );
    const on = (ids as [string, string, string])[2];
    await w.tx("demo", (c) =>
      applyClaims(c, claims("main", [[`${on}.main`, "hero"]]), w.now, w.engine),
    );
    const page = (await w.call("crew", "GET", "/on-air")).body;
    const main = page.slice(page.indexOf(">Main hall</h2>"));
    expect(main).toMatch(/<p class="canccu-small canccu-muted">\s*1 on air · 2 waiting\s*<\/p>/);
  });

  it("says a story fired on no item is on now, by the take's own clock", async () => {
    const now = Date.parse("2026-01-01T18:40:00Z");
    let reads = 0;
    // Every read of the clock is a second later: the page's own read comes before the take's.
    Object.defineProperty(w, "now", {
      get: () => new Date(now + 1000 * reads++),
      set: () => undefined,
      configurable: true,
    });
    await w.tx("demo", (c) =>
      writeStories(
        c,
        [
          story({
            key: "loop",
            name: "Loop",
            rounds: { mode: "every", every_minutes: 10, from_minutes: 0 },
            end: {
              rounds: null,
              for_minutes: null,
              until_clock: null,
              until_event: null,
              crew: true,
            },
          }),
        ],
        DEFAULT_SETTINGS,
        1,
      ),
    );
    const fired = await w.call(
      "crew",
      "POST",
      "/storyboards/loop/fire",
      { idempotency_key: "k-fire-now", back: "on-air" },
      form,
    );
    expect(doneOf(fired)).toBe("Loop is on now.");
  });

  it("names no round at or after the loop's end event in the Fire notice", async () => {
    w.now = new Date("2026-01-01T18:55:00Z");
    const loop = story({
      key: "loop",
      name: "Loop",
      triggers: [
        { kind: "item", kinds: ["tournament"], item_id: null, anchor: "start" },
        { kind: "take" },
      ],
      rounds: { mode: "every", every_minutes: 10, from_minutes: -30 },
      end: {
        rounds: null,
        for_minutes: null,
        until_clock: null,
        until_event: { kind: "item_starts" },
        crew: true,
      },
    });
    await w.tx("demo", (c) => writeStories(c, [loop], DEFAULT_SETTINGS, 1));
    const fired = await w.call(
      "crew",
      "POST",
      "/storyboards/loop/fire",
      { idempotency_key: "k-fire-end", item_id: "it_final", back: "on-air" },
      form,
    );
    expect(doneOf(fired)).toBe("Loop has no round left to play.");
  });

  it("asks a free variable once per story that uses it, and sends it only with that story", async () => {
    const said = (key: string, name: string) =>
      story({
        key,
        name,
        round: {
          steps: [
            step({
              message: true,
              content: { title: "At {place}", subtitle: "", image_url: null },
            }),
          ],
          repeat: null,
          hold_seconds: null,
        },
      });
    await w.tx("demo", (c) =>
      writeStories(
        c,
        [said("prize", "Prize draw"), said("photo", "Group photo")],
        DEFAULT_SETTINGS,
        1,
      ),
    );
    const page = (await w.call("crew", "GET", "/on-air")).body;
    expect(page.match(/name="var-[a-z_]+-place"/g)).toEqual([
      'name="var-prize-place"',
      'name="var-photo-place"',
    ]);
    expect(page).toMatch(
      /<label[^>]*for="fire-prize-place"[^>]*>\s*Prize draw: \{place\}\s*<\/label>/,
    );
    expect(page).toMatch(
      /<label[^>]*for="fire-photo-place"[^>]*>\s*Group photo: \{place\}\s*<\/label>/,
    );
    const fired = await w.call(
      "crew",
      "POST",
      "/storyboards/photo/fire",
      {
        idempotency_key: "k-fire-vars",
        "var-prize-place": "the stage",
        "var-photo-place": "the lobby",
        back: "on-air",
      },
      form,
    );
    expect(fired.statusCode).toBe(303);
    const sent = w.audit.find((e) => e.action === "moments.storyboard.fired");
    expect(sent?.target).toEqual({ type: "storyboard", id: "photo" });
    expect(sent?.changes?.variables).toEqual({ old: null, new: { place: "the lobby" } });
  });
});
