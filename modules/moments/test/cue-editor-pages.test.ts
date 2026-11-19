/**
 * The sound desk's cue editor (#626, the step 4 polish sheets 02 and 04): Sound and Picture on the
 * content grid, Try it and the default pack beside them, Save and Cancel in a pending row; drawn
 * and posted as a browser does. The script's part is cue-editor.browser.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DATABASE_URL, T0, freshDatabase } from "./helpers.js";
import { appWorld, json } from "./app.js";
import type { AppWorld } from "./app.js";

const run = DATABASE_URL ? describe : describe.skip;
const form = { form: true };
const text = (body: string) =>
  body
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replaceAll("&#39;", "'");
const STOPS = "0,30,60,120,300,600";

/** What the editor posts for tournament.start as the seed has it, before any change. */
const seedForm = (o: Record<string, string> = {}) => ({
  category: "something_new",
  enabled: "on",
  level: "100",
  cooldown_step: "0",
  cooldown_stops: STOPS,
  catch_up_minutes: "2",
  once_per_source: "on",
  sounds: "pack.gong,pack.drum-roll",
  voice_line: "",
  effects: "ripple,pop",
  hold_seconds: "120",
  revision: "0",
  ...o,
});

run("the cue editor", () => {
  let pool: pg.Pool;
  let w: AppWorld;
  beforeAll(async () => {
    pool = await freshDatabase();
    w = await appWorld(pool);
  });
  afterAll(async () => {
    await w.app.close();
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query(
      `TRUNCATE moments_zones, moments_outbox, moments_idempotency, moments_cues,
        moments_sound_settings, moments_sound_zones, moments_sound_log, moments_sounds`,
    );
    w.now = T0;
    w.zoneStatus.clear();
    for (const z of ["main", "cafe"])
      await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ($1)`, [z]));
  });
  const cue = async (name: string) =>
    (
      json(await w.call("reader", "GET", "/api/moments/cues")).cues as Record<string, unknown>[]
    ).find((c) => c.name === name);

  it("draws Sound, Picture, Try it and the default pack, with no typed numbers", async () => {
    const page = await w.call("admin", "GET", "/cues/edit/tournament.start");
    expect(page.statusCode).toBe(200);
    const words = text(page.body);
    expect(words).toContain("Tournament starts");
    expect(words).toContain("tournament.start");
    for (const card of ["Sound", "Picture", "Try it", "From the default pack"])
      expect(page.body).toContain(`<h2 class="canccu-card__title">${card}</h2>`);
    // The category as six chips, the chosen one checked, and what it means in words.
    expect(page.body).toMatch(/type="radio" name="category" value="something_new" checked/);
    expect(words).toContain(
      "Something new plays at 80 %, waits behind urgent, result and attention, and is silent at calm.",
    );
    // The chosen sounds are players; the rest of the library are add-chips.
    expect(page.body).toMatch(/data-chosen[\s\S]*data-sound="\/api\/moments\/sounds\/pack\/gong.ogg"/);
    expect(page.body).toMatch(/name="sounds" value="pack.gong" checked/);
    expect(page.body).toMatch(/name="sounds" value="pack.chime-soft"(?! checked)/);
    expect(words).toContain("Add from the library");
    expect(page.body).toMatch(/name="voice_line" value="" checked/);
    // Level, not again for and holds for are sliders; catch-up a stepper; once per source a switch.
    expect(page.body).toMatch(/type="range"[^>]*name="level"[^>]*value="100"/);
    expect(words).toContain("Heard at 64 %: master 80 % × Something new 80 % × this cue 100 %.");
    expect(page.body).toMatch(/type="range"[^>]*name="cooldown_step"[^>]*max="5"[^>]*value="0"/);
    expect(page.body).toContain(`name="cooldown_stops" value="${STOPS}"`);
    for (const stop of ["Off", "30 s", "1 min", "2 min", "5 min", "10 min"])
      expect(words).toContain(stop);
    expect(page.body).toMatch(/name="catch_up_minutes"[^>]*value="2"/);
    expect(page.body).toMatch(/role="switch"[^>]*name="once_per_source"[^>]*checked/);
    expect(page.body).toMatch(/type="range"[^>]*name="hold_seconds"[^>]*min="60"[^>]*max="120"/);
    expect(page.body).toMatch(/type="checkbox" name="effects" value="ripple" checked/);
    // Try it here or on a zone; the pending row; the seed as it is.
    expect(page.body).toMatch(/name="try_zone" value="here" checked/);
    expect(page.body).toMatch(/name="try_zone" value="main"/);
    expect(words).toContain("Play sound and picture");
    expect(page.body).toContain("canccu-savebar");
    expect(words).toContain("Cancel");
    expect(words).toContain("Same as the default pack.");
    expect(page.body).not.toContain('type="number" min="0" max="100"');
  });

  it("saves what the editor posts, the stops and minutes in seconds", async () => {
    const r = await w.call(
      "admin",
      "POST",
      "/cues/edit/tournament.start",
      seedForm({
        level: "90",
        cooldown_step: "3",
        catch_up_minutes: "2.5",
        sounds: "pack.gong",
        voice_line: "pack.chime-soft",
        hold_seconds: "60",
      }),
      form,
    );
    expect(r.headers.location).toMatch(/^\/moments\/cues\?done=/);
    expect(await cue("tournament.start")).toMatchObject({
      level: 90,
      cooldown_seconds: 120,
      catch_up_seconds: 150,
      sounds: ["pack.gong"],
      voice_line: "pack.chime-soft",
      hold_seconds: 60,
    });
    const words = text((await w.call("admin", "GET", "/cues/edit/tournament.start")).body);
    expect(words).toContain(
      "Changed here: Drum roll removed, voice line Chime, soft, level 90 %, not again for 2 min, catch-up 150 s, picture holds 60 s.",
    );
    expect(words).toContain("Reset to default");
  });

  it("keeps a not-again-for the stops do not name as a stop of its own", async () => {
    await w.call("admin", "POST", "/cues/edit/chrome.hot", {
      ...seedForm({ category: "ambient", sounds: "pack.nudge", effects: "glow" }),
      cooldown_stops: "0,900",
      cooldown_step: "1",
      hold_seconds: "90",
    }, form);
    expect(await cue("chrome.hot")).toMatchObject({ cooldown_seconds: 900 });
    const page = await w.call("admin", "GET", "/cues/edit/chrome.hot");
    expect(page.body).toContain('name="cooldown_stops" value="0,30,60,120,300,600,900"');
    expect(page.body).toMatch(/name="cooldown_step"[^>]*max="6"[^>]*value="6"/);
    expect(text(page.body)).toContain("15 min");
  });

  it("refuses a step outside the stops", async () => {
    const r = await w.call(
      "admin",
      "POST",
      "/cues/edit/tournament.start",
      seedForm({ cooldown_step: "9" }),
      form,
    );
    expect(r.headers.location).toMatch(/^\/moments\/cues\/edit\/tournament.start\?error=/);
  });

  it("turns a cue on and off from its row", async () => {
    const r = await w.call("admin", "POST", "/cues/edit/poll.open/toggle", {}, form);
    expect(r.headers.location).toMatch(/^\/moments\/cues\?done=/);
    expect(await cue("poll.open")).toMatchObject({ enabled: true, sounds: ["pack.happy-beep"] });
    await w.call("admin", "POST", "/cues/edit/poll.open/toggle", {}, form);
    expect(await cue("poll.open")).toMatchObject({ enabled: false });
    expect((await w.call("reader", "POST", "/cues/edit/poll.open/toggle", {}, form)).statusCode).toBe(
      403,
    );
  });

  it("tries the form's first sound on a zone, and says Here needs the script", async () => {
    const before = w.events("demo").length;
    const r = await w.call(
      "admin",
      "POST",
      "/cues/edit/tournament.start/try",
      seedForm({ try_zone: "main", sounds: "pack.drum-roll", idempotency_key: "k-try-00001" }),
      form,
    );
    expect(r.headers.location).toMatch(/^\/moments\/cues\/edit\/tournament.start\?done=/);
    const sent = w
      .events("demo")
      .slice(before)
      .filter((e) => e.type === "moments.sound.played");
    expect(sent.map((e) => [e.data.zone_key, (e.data.sound as { url: string }).url])).toEqual([
      ["main", "/api/moments/sounds/pack/drum-roll.ogg"],
    ]);
    const here = await w.call(
      "admin",
      "POST",
      "/cues/edit/tournament.start/try",
      seedForm({ try_zone: "here" }),
      form,
    );
    expect(decodeURIComponent(here.headers.location as string)).toContain("the page's script");
    // Trying sends nothing that saves the cue.
    expect(await cue("tournament.start")).toMatchObject({ sounds: ["pack.gong", "pack.drum-roll"] });
  });

  it("adds a cue of the event's own, named by a story, and says why a bad one is refused", async () => {
    const blank = await w.call("admin", "GET", "/cues/new?name=story.raffle.draw");
    expect(blank.body).toMatch(/name="name"[^>]*value="story.raffle.draw"/);
    expect(blank.body).not.toContain("From the default pack");
    const add = (name: string) =>
      w.call("admin", "POST", "/cues/new", { ...seedForm({ category: "result" }), name }, form);
    expect((await add("raffle.draw")).headers.location).toMatch(/done=/);
    const words = text((await w.call("admin", "GET", "/cues")).body);
    expect(words).toContain("Raffle draw raffle.draw");
    const own = text((await w.call("admin", "GET", "/cues/edit/raffle.draw")).body);
    expect(own).toContain("The event's own");
    expect(own).toContain("Remove this cue");
    expect((await add("Bad Name")).headers.location).toMatch(/^\/moments\/cues\/new\?error=/);
  });

  it("sends an unknown cue back to the list with a reason", async () => {
    const r = await w.call("admin", "GET", "/cues/edit/no.such");
    expect(r.headers.location).toMatch(/^\/moments\/cues\?error=/);
  });
});
