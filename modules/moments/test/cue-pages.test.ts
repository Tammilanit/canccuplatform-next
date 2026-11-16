/** Studio → Cues, the sound desk (mockup 12), drawn and used as a browser does. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DATABASE_URL, T0, freshDatabase } from "./helpers.js";
import { appWorld, json } from "./app.js";
import type { AppWorld } from "./app.js";

const run = DATABASE_URL ? describe : describe.skip;
const form = { form: true };

run("the sound desk", () => {
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
      `TRUNCATE moments, moment_overrides, moment_placements, moments_history, moments_zones,
        moments_outbox, moments_idempotency, moments_cues, moments_sound_settings,
        moments_sound_zones, moments_sound_sources, moments_sound_log, moments_sounds`,
    );
    w.now = T0;
    w.zoneStatus.clear();
    for (const z of ["main", "cafe"])
      await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ($1)`, [z]));
  });

  it("draws the budget per zone, the master, what each zone lets through, the categories, cues, library and log", async () => {
    w.zoneStatus.set("cafe", {
      energy: "calm",
      device: { ...w.soundScreen, audio_unlocked: false },
    });
    await w.call("crew", "POST", "/api/moments/spotlight", { show: "message", title: "Hi" });
    const page = await w.call("admin", "GET", "/cues");
    expect(page.statusCode).toBe(200);
    for (const text of [
      "Budget per zone",
      "1 / 3",
      "1 / 20",
      "Urgent always passes and still counts",
      "Mute all for 15 min",
      "Sound check",
      "urgent, result, attention",
      "audio locked",
      "Categories",
      "something new",
      "pizza.placed",
      "+ Add a cue",
      "Library",
      "Chime, soft",
      "default pack · CC0",
      "Sound log",
    ])
      expect(page.body).toContain(text);
    // The café's sound screen is locked: the log says the sound was missed, and why.
    expect(page.body).toContain("missed");
  });

  it("shows a reader everything and lets them change nothing", async () => {
    const page = await w.call("reader", "GET", "/cues");
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain("Mute all for 15 min");
    expect(page.body).not.toContain("+ Add a cue");
    expect((await w.call("nobody", "GET", "/cues")).headers.location).toBe("/admin/sign-in");
  });

  it("mutes for 15 minutes, and unmutes", async () => {
    const r = await w.call(
      "crew",
      "POST",
      "/cues/mute",
      { minutes: "15", idempotency_key: "k-mute-0001" },
      form,
    );
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toMatch(/^\/moments\/cues\?done=/);
    const desk = json(await w.call("reader", "GET", "/api/moments/sound"));
    expect((desk.settings as Record<string, unknown>).muted_until).not.toBeNull();
    expect((await w.call("crew", "GET", "/cues")).body).toContain("Unmute");
  });

  it("runs a sound check on one zone", async () => {
    const before = w.events("demo").length;
    const r = await w.call(
      "crew",
      "POST",
      "/cues/check",
      { zone_key: "main", idempotency_key: "k-check-0001" },
      form,
    );
    expect(r.statusCode).toBe(303);
    const sent = w
      .events("demo")
      .slice(before)
      .filter((e) => e.type === "moments.sound.played");
    expect(sent.map((e) => e.data.zone_key)).toEqual(["main"]);
  });

  it("saves the master and the categories", async () => {
    const r = await w.call(
      "admin",
      "POST",
      "/cues/settings",
      {
        enabled: "on",
        volume: "60",
        hourly_budget: "15",
        per_minute: "3",
        per_source_seconds: "10",
        revision: "0",
        "urgent.enabled": "on",
        "urgent.level": "100",
        "result.enabled": "on",
        "result.level": "70",
        "attention.enabled": "on",
        "attention.level": "80",
        "something_new.level": "80",
        "ended.enabled": "on",
        "ended.level": "80",
        "ambient.enabled": "on",
        "ambient.level": "35",
      },
      form,
    );
    expect(r.headers.location).toMatch(/done=/);
    const s = json(await w.call("reader", "GET", "/api/moments/sound")).settings as Record<
      string,
      unknown
    >;
    expect(s).toMatchObject({ volume: 60, hourly_budget: 15 });
    expect((s.categories as Record<string, unknown>).something_new).toEqual({
      enabled: false,
      level: 80,
    });
  });

  it("edits a cue's sounds, voice line, effects and hold", async () => {
    const edit = await w.call("admin", "GET", "/cues/edit/tournament.start");
    expect(edit.statusCode).toBe(200);
    expect(edit.body).toContain("Voice line");
    const r = await w.call(
      "admin",
      "POST",
      "/cues/edit/tournament.start",
      {
        category: "something_new",
        enabled: "on",
        level: "90",
        cooldown_seconds: "0",
        catch_up_seconds: "120",
        once_per_source: "on",
        sounds: "pack.gong,pack.drum-roll",
        voice_line: "pack.chime-soft",
        effects: "ripple,pop",
        hold_seconds: "120",
        revision: "0",
      },
      form,
    );
    expect(r.headers.location).toMatch(/^\/moments\/cues\?done=/);
    const cue = (
      json(await w.call("reader", "GET", "/api/moments/cues")).cues as Record<string, unknown>[]
    ).find((c) => c.name === "tournament.start");
    expect(cue).toMatchObject({
      level: 90,
      sounds: ["pack.gong", "pack.drum-roll"],
      voice_line: "pack.chime-soft",
    });
  });

  it("adds a cue of the event's own, and says why a bad one is refused", async () => {
    const add = (name: string) =>
      w.call(
        "admin",
        "POST",
        "/cues/new",
        {
          name,
          category: "result",
          enabled: "on",
          level: "80",
          cooldown_seconds: "0",
          catch_up_seconds: "120",
          sounds: "pack.drum-roll",
          voice_line: "",
          effects: "pop",
          hold_seconds: "60",
          revision: "0",
        },
        form,
      );
    expect((await add("raffle.draw")).headers.location).toMatch(/done=/);
    expect((await w.call("admin", "GET", "/cues")).body).toContain("raffle.draw");
    expect((await add("Bad Name")).headers.location).toMatch(/error=/);
  });

  it("links an uploaded sound to the library", async () => {
    w.assets.set("as_9", {
      id: "as_9",
      kind: "audio",
      title: "Drumroll",
      url: "/api/screen/files/x.mp3",
      size_bytes: 1000,
      duration_seconds: 12,
    });
    const r = await w.call("admin", "POST", "/cues/library", { asset_id: "as_9" }, form);
    expect(r.headers.location).toMatch(/done=/);
    const page = await w.call("admin", "GET", "/cues");
    expect(page.body).toContain("Drumroll");
    expect(page.body).toContain("over 10 s");
  });
});
