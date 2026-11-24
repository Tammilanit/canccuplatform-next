/**
 * Studio → Cues, the sound desk (#626, the step 4 polish sheets 01, 03 and 04): the four sub-pages
 * under one master strip, drawn and used as a browser does. The editor is cue-editor-pages.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { DATABASE_URL, T0, freshDatabase } from "./helpers.js";
import { appWorld, json } from "./app.js";
import type { AppWorld } from "./app.js";

const run = DATABASE_URL ? describe : describe.skip;
const form = { form: true };
/** The text of a page with its tags and runs of white space taken out. */
/** The page with each run of white space one space, as the formatter may wrap a tag. */
const flat = (body: string) => body.replace(/\s+/g, " ");
const text = (body: string) =>
  body
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replaceAll("&#39;", "'");

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
      `TRUNCATE moments, moment_overrides, moment_placements, moment_slots, moments_zone_air, moments_history, moments_zones,
        moments_outbox, moments_idempotency, moments_cues, moments_sound_settings,
        moments_sound_zones, moments_sound_sources, moments_sound_log, moments_sounds`,
    );
    w.now = T0;
    w.zoneStatus.clear();
    for (const z of ["main", "cafe"])
      await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ($1)`, [z]));
  });
  /** The café's sound screen is locked, and one spotlight sounded: main played, café missed. */
  const spotlight = async () => {
    w.zoneStatus.set("cafe", {
      energy: "calm",
      device: { ...w.soundScreen, audio_unlocked: false },
    });
    await w.call("crew", "POST", "/api/moments/spotlight", { show: "message", title: "Hi" });
  };

  it("splits the desk into four sub-pages, each under the same master strip", async () => {
    for (const [path, sub] of [
      ["/cues", "cues"],
      ["/cues/library", "library"],
      ["/cues/limits", "limits"],
      ["/cues/log", "log"],
    ] as const) {
      const page = await w.call("admin", "GET", path);
      expect(page.statusCode).toBe(200);
      expect(flat(page.body)).toMatch(new RegExp(`data-sub="${sub}"[^>]*aria-current="page"`));
      const words = text(page.body);
      for (const pill of ["Cues 33", "Library 12", "Limits and categories", "Log"])
        expect(words).toContain(pill);
      expect(flat(page.body)).toContain('class="moments-master');
      expect(words).toContain("Mute all 15 min");
      expect(words).toContain("Sound check");
    }
  });

  it("draws the master as a switch and a slider, and each zone's hour in a line", async () => {
    await spotlight();
    const page = await w.call("admin", "GET", "/cues");
    expect(flat(page.body)).toMatch(
      /role="switch"[^>]*name="enabled"|name="enabled"[^>]*role="switch"/,
    );
    expect(flat(page.body)).toMatch(/type="range"[^>]*name="volume"[^>]*value="80"/);
    expect(flat(page.body)).not.toContain('type="number"');
    const words = text(page.body);
    expect(words).toContain("80 %");
    // The hour counts live in the fake Valkey across tests: the words matter here, not the count.
    expect(words).toMatch(/main \d+ of 20 this hour/);
    expect(words).toMatch(/cafe \d+ of 20 this hour audio locked/);
    expect(words).toContain("Limits and categories ›");
  });

  it("lists the cues by plain name, grouped under their category, with the id second", async () => {
    const page = await w.call("admin", "GET", "/cues");
    const words = text(page.body);
    expect(words).toContain("Urgent announcement announce.urgent · Alarm");
    expect(words).toContain("Tournament starts tournament.start · Gong, Drum roll");
    expect(words).toContain("Urgent level 100 % · interrupts");
    expect(words).toContain("Something new level 80 % · silent at calm");
    expect(words).toContain("Ripple, pop · holds 120 s");
    expect(words).toContain("New cue");
    // The row opens the editor; its level is a bar, its On a switch, and its play button
    // carries the first sound.
    expect(flat(page.body)).toContain('href="/moments/cues/edit/tournament.start"');
    expect(flat(page.body)).toContain('data-sound="/api/moments/sounds/pack/gong.ogg"');
    expect(flat(page.body)).toMatch(/<meter[^>]*value="100"/);
    // Something new comes after urgent, in the categories' order.
    expect(words.indexOf("Something new level")).toBeGreaterThan(words.indexOf("Urgent level"));
  });

  it("filters the cues by category chip, and finds one by name or id", async () => {
    const urgent = text((await w.call("admin", "GET", "/cues?category=urgent")).body);
    expect(urgent).toContain("Emergency");
    expect(urgent).not.toContain("Tournament starts");
    const byName = text((await w.call("admin", "GET", "/cues?q=pizza%20is")).body);
    expect(byName).toContain("Pizza is here");
    expect(byName).not.toContain("Tournament starts");
    const byId = text((await w.call("admin", "GET", "/cues?q=tournament.post")).body);
    expect(byId).toContain("Tournament over");
    expect(byId).not.toContain("Pizza is here");
    const none = text((await w.call("admin", "GET", "/cues?q=nothing-like-this")).body);
    expect(none).toContain("No cue matches");
  });

  it("shows the library as cards with themed players, licence and the cues that use each", async () => {
    const page = await w.call("admin", "GET", "/cues/library");
    const words = text(page.body);
    expect(words).toContain("Upload a sound");
    expect(words).toContain("Or drop MP3 or OGG files here.");
    expect(words).toContain("Gong 5.6 s");
    // The sounds A to Z by title, whatever their source, under one count (sheet 03).
    expect(words).toContain("12 sounds · A to Z");
    expect(page.body.match(/<li class="moments-sound">/g)).toHaveLength(12);
    expect(words.indexOf("Airplane chime")).toBeLessThan(words.indexOf("Alarm"));
    expect(words.indexOf("Alarm")).toBeLessThan(words.indexOf("Gong"));
    expect(words).toContain("Default pack · CC0 · 3 cues");
    expect(words).toContain("Tournament starts, Finals start +1");
    expect(flat(page.body)).toContain('data-player data-sound="/api/moments/sounds/pack/gong.ogg"');
    expect(flat(page.body)).not.toContain("<audio controls>");
  });

  it("draws Limits and categories with sliders, and what each zone lets through in words", async () => {
    await spotlight();
    const page = await w.call("admin", "GET", "/cues/limits");
    const words = text(page.body);
    expect(words).toContain("Budget per zone");
    expect(words).toContain("Urgent always passes and still counts");
    expect(words).toContain("Urgent, result and attention (calm)");
    expect(words).toContain("Every category (lively)");
    expect(words).toContain("Main hall sound");
    expect(flat(page.body)).toMatch(/type="range"[^>]*name="hourly_budget"/);
    expect(flat(page.body)).toMatch(/type="range"[^>]*name="per_minute"/);
    expect(flat(page.body)).toMatch(/type="range"[^>]*name="ambient.level"[^>]*value="35"/);
    expect(flat(page.body)).toMatch(/role="switch"[^>]*name="result.enabled"/);
    expect(words).toContain("Interrupts Waits");
    expect(words).toContain("Plays Silent");
    expect(flat(page.body)).not.toContain('type="number" min="0" max="100"');
  });

  it("tells a zone without a sound screen where to set one", async () => {
    w.zoneStatus.set("cafe", { energy: "lively", device: null });
    const words = text((await w.call("admin", "GET", "/cues/limits")).body);
    expect(words).toContain("None · Set one in Devices ›");
    expect(text((await w.call("admin", "GET", "/cues")).body)).toMatch(
      /cafe \d+ of 20 this hour no sound screen/,
    );
  });

  it("writes the log in words, the reason code second, and filters it", async () => {
    await spotlight();
    const page = await w.call("admin", "GET", "/cues/log");
    const words = text(page.body);
    expect(words).toContain("Announcement announce.attention");
    expect(words).toMatch(/Played (Chime|Happy beep)/);
    expect(words).toContain("Missed The sound screen's audio is locked");
    expect(words).toContain("audio_locked");
    const missed = text((await w.call("admin", "GET", "/cues/log?outcome=missed")).body);
    expect(missed).toContain("audio_locked");
    expect(missed).not.toMatch(/Played (Chime|Happy beep)/);
    const main = text((await w.call("admin", "GET", "/cues/log?zone=main")).body);
    expect(main).not.toContain("audio_locked");
    const found = text((await w.call("admin", "GET", "/cues/log?q=audio_locked")).body);
    expect(found).toContain("audio_locked");
    expect(found).not.toMatch(/Played (Chime|Happy beep)/);
  });

  it("shows a reader everything and lets them change nothing", async () => {
    for (const path of ["/cues", "/cues/library", "/cues/limits", "/cues/log"]) {
      const page = await w.call("reader", "GET", path);
      expect(page.statusCode).toBe(200);
      expect(flat(page.body)).not.toContain("Mute all 15 min");
      expect(flat(page.body)).not.toContain("New cue");
      expect(flat(page.body)).not.toContain("Upload a sound");
      expect(flat(page.body)).toMatch(/name="volume"[^>]*disabled/);
    }
    expect((await w.call("nobody", "GET", "/cues/log")).headers.location).toBe("/admin/sign-in");
  });

  it("mutes for 15 minutes back on the sub-page it came from, counts down, and unmutes", async () => {
    const r = await w.call(
      "crew",
      "POST",
      "/cues/mute",
      { minutes: "15", back: "log", idempotency_key: "k-mute-0001" },
      form,
    );
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toMatch(/^\/moments\/cues\/log\?done=/);
    const desk = json(await w.call("reader", "GET", "/api/moments/sound"));
    expect((desk.settings as Record<string, unknown>).muted_until).not.toBeNull();
    const page = await w.call("crew", "GET", "/cues/log");
    expect(flat(page.body)).toContain("moments-master--muted");
    expect(text(page.body)).toContain("(15:00 left)");
    expect(flat(page.body)).toMatch(/data-until="[^"]+"/);
    expect(text(page.body)).toContain("Unmute now");
    // A back that is not a sub-page goes to Cues.
    const odd = await w.call(
      "crew",
      "POST",
      "/cues/mute",
      { minutes: "0", back: "//elsewhere", idempotency_key: "k-mute-0002" },
      form,
    );
    expect(odd.headers.location).toMatch(/^\/moments\/cues\?done=/);
  });

  it("runs a sound check on one zone and reports in words what each zone did", async () => {
    w.zoneStatus.set("cafe", { energy: "lively", device: null });
    const before = w.events("demo").length;
    const r = await w.call(
      "crew",
      "POST",
      "/cues/check",
      { zone_key: "", back: "library", idempotency_key: "k-check-0001" },
      form,
    );
    expect(r.statusCode).toBe(303);
    expect(r.headers.location).toMatch(/^\/moments\/cues\/library\?checked=1/);
    const sent = w
      .events("demo")
      .slice(before)
      .filter((e) => e.type === "moments.sound.played");
    expect(sent.map((e) => e.data.zone_key)).toContain("main");
    const words = text(
      (await w.call("crew", "GET", (r.headers.location as string).replace(/^\/moments/, ""))).body,
    );
    expect(words).toContain("Sound check sent to every zone at");
    expect(words).toContain("main played it");
    expect(words).toContain("cafe has no sound screen, so nothing was heard there");
  });

  it("saves the master's switch and volume and keeps the limits", async () => {
    const r = await w.call(
      "admin",
      "POST",
      "/cues/master",
      { volume: "55", revision: "0", back: "limits" },
      form,
    );
    expect(r.headers.location).toMatch(/^\/moments\/cues\/limits\?done=/);
    const s = json(await w.call("reader", "GET", "/api/moments/sound")).settings as Record<
      string,
      unknown
    >;
    expect(s).toMatchObject({ enabled: false, volume: 55, hourly_budget: 20, per_minute: 3 });
    const stale = await w.call(
      "admin",
      "POST",
      "/cues/master",
      { enabled: "on", volume: "80", revision: "0" },
      form,
    );
    expect(stale.headers.location).toMatch(/error=/);
  });

  it("draws a level or volume nobody rounded to 5 as it is stored", async () => {
    const saved = await w.call(
      "admin",
      "POST",
      "/cues/settings",
      {
        enabled: "on",
        volume: "72",
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
        "ambient.level": "33",
      },
      form,
    );
    expect(saved.headers.location).toMatch(/done=/);
    const limits = flat((await w.call("admin", "GET", "/cues/limits")).body);
    expect(limits).toMatch(/type="range"[^>]*name="ambient.level"[^>]*value="33"/);
    expect(limits).not.toMatch(/name="ambient.level"[^>]*step="5"/);
    const strip = flat((await w.call("admin", "GET", "/cues")).body);
    expect(strip).toMatch(/type="range"[^>]*name="volume"[^>]*value="72"/);
    expect(strip).not.toMatch(/name="volume"[^>]*step="5"/);
  });

  it("saves the limits and the categories", async () => {
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
    expect(r.headers.location).toMatch(/^\/moments\/cues\/limits\?done=/);
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
    expect(r.headers.location).toMatch(/^\/moments\/cues\/library\?done=/);
    const words = text((await w.call("admin", "GET", "/cues/library")).body);
    expect(words).toContain("Drumroll");
    expect(words).toContain("Uploaded · no cue");
    expect(words).toContain("over 10 s");
    expect(words).toContain("Remove");
  });
});
