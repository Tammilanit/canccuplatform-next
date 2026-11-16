/** The cues and sound API (contracts/moments.md, Cues and sound): rights, validation, audit. */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appWorld, errorOf, json } from "./app.js";
import type { AppWorld } from "./app.js";
import { DATABASE_URL, T0, freshDatabase } from "./helpers.js";

const live = DATABASE_URL ? describe : describe.skip;
type Row = Record<string, unknown>;

live("the cues and sound API", () => {
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
    await pool.query(
      `TRUNCATE moments, moment_overrides, moment_placements, moments_history, moments_zones,
        moments_outbox, moments_idempotency,
        moments_cues, moments_sound_settings, moments_sound_zones, moments_sound_sources,
        moments_sound_log, moments_sounds`,
    );
    w = await appWorld(pool);
    w.now = T0;
    await w.tx("demo", (c) => c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main')`));
  });

  const cueOf = async (name: string) =>
    (json(await w.call("reader", "GET", "/api/moments/cues")).cues as Row[]).find(
      (c) => c.name === name,
    ) as Row;

  it("lists the 25 seeded cues, the six categories and the effects; reading needs moments.read", async () => {
    const r = await w.call("reader", "GET", "/api/moments/cues");
    expect(r.statusCode).toBe(200);
    const body = json(r);
    expect((body.cues as Row[]).filter((c) => c.builtin)).toHaveLength(25);
    expect((body.categories as Row[]).map((c) => c.name)).toEqual([
      "urgent",
      "result",
      "attention",
      "something_new",
      "ended",
      "ambient",
    ]);
    expect(body.effects).toContain("ring_burst");
    expect((await w.call("nobody", "GET", "/api/moments/cues")).statusCode).toBe(403);
  });

  it("changes a cue: several sounds and a voice line, audited; a stale revision is refused", async () => {
    const before = await cueOf("tournament.start");
    const body = {
      ...before,
      level: 90,
      sounds: ["pack.gong", "pack.drum-roll"],
      voice_line: "pack.chime-soft",
      hold_seconds: 90,
    };
    const r = await w.call("admin", "PUT", "/api/moments/cues/tournament.start", body);
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ level: 90, voice_line: "pack.chime-soft", revision: 1 });
    expect(w.audit.at(-1)).toMatchObject({
      action: "moments.cue.changed",
      target: { type: "cue", id: "tournament.start" },
    });
    const stale = await w.call("admin", "PUT", "/api/moments/cues/tournament.start", body);
    expect(errorOf(stale).code).toBe("version_conflict");
    expect(
      (await w.call("crew", "PUT", "/api/moments/cues/tournament.start", body)).statusCode,
    ).toBe(403);
  });

  it("refuses what the model does not allow: a new category, a sound not in the library, a hold out of 60–120 s", async () => {
    const before = await cueOf("pizza.placed");
    const put = (o: Row) =>
      w.call("admin", "PUT", "/api/moments/cues/pizza.placed", { ...before, ...o });
    expect(errorOf(await put({ category: "fanfare" })).code).toBe("invalid_request");
    expect(errorOf(await put({ sounds: ["pack.nope"] })).code).toBe("invalid_request");
    expect(errorOf(await put({ hold_seconds: 30 })).code).toBe("invalid_request");
    expect(errorOf(await put({ effects: ["spin"] })).code).toBe("invalid_request");
    expect(errorOf(await put({ level: 101 })).code).toBe("invalid_request");
  });

  it("an event adds a cue of its own and removes it; a built-in goes back to its seed", async () => {
    const own = {
      category: "result",
      enabled: true,
      level: 80,
      cooldown_seconds: 0,
      catch_up_seconds: 120,
      catch_up_before_start: null,
      once_per_source: false,
      sounds: ["pack.drum-roll"],
      voice_line: null,
      effects: ["pop"],
      hold_seconds: 60,
      revision: 0,
    };
    const r = await w.call("admin", "PUT", "/api/moments/cues/raffle.draw", own);
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ name: "raffle.draw", builtin: false });
    expect((await w.call("admin", "DELETE", "/api/moments/cues/raffle.draw")).statusCode).toBe(204);
    expect(await cueOf("raffle.draw")).toBeUndefined();
    const hot = await cueOf("chrome.hot");
    await w.call("admin", "PUT", "/api/moments/cues/chrome.hot", { ...hot, level: 10 });
    expect((await cueOf("chrome.hot")).level).toBe(10);
    expect((await w.call("admin", "DELETE", "/api/moments/cues/chrome.hot")).statusCode).toBe(204);
    expect((await cueOf("chrome.hot")).level).toBe(100);
    const bad = await w.call("admin", "PUT", "/api/moments/cues/Bad Name", own);
    expect(bad.statusCode).toBe(400);
  });

  it("saves the sound settings, validated and audited", async () => {
    const desk = json(await w.call("reader", "GET", "/api/moments/sound"));
    const settings = desk.settings as Row;
    const ok = await w.call("admin", "PUT", "/api/moments/sound/settings", {
      ...settings,
      hourly_budget: 12,
      categories: { ...(settings.categories as Row), ambient: { enabled: false, level: 20 } },
    });
    expect(ok.statusCode).toBe(200);
    expect(json(ok)).toMatchObject({ hourly_budget: 12, revision: 1 });
    expect(w.audit.at(-1)?.action).toBe("moments.sound.changed");
    const extra = await w.call("admin", "PUT", "/api/moments/sound/settings", {
      ...json(ok),
      categories: { ...(settings.categories as Row), fanfare: { enabled: true, level: 50 } },
    });
    expect(errorOf(extra).code).toBe("invalid_request");
    const budget = await w.call("admin", "PUT", "/api/moments/sound/settings", {
      ...json(ok),
      hourly_budget: -1,
    });
    expect(errorOf(budget).code).toBe("invalid_request");
  });

  it("a timed mute silences every zone until it ends, and the log says muted", async () => {
    const r = await w.call("crew", "POST", "/api/moments/sound/mute", { minutes: 15 });
    expect(r.statusCode).toBe(200);
    expect(json(r).muted_until).toBe(new Date(T0.getTime() + 15 * 60_000).toISOString());
    await w.call("crew", "POST", "/api/moments/spotlight", { show: "message", title: "Hi" });
    const log = json(await w.call("reader", "GET", "/api/moments/sound/log")).rows as Row[];
    expect(log[0]).toMatchObject({ zone_key: "main", cue: "announce.attention", reason: "muted" });
    const off = await w.call("crew", "POST", "/api/moments/sound/mute", { minutes: 0 });
    expect(json(off).muted_until).toBeNull();
    expect(w.audit.filter((a) => a.action === "moments.sound.muted")).toHaveLength(2);
  });

  it("a sound check plays on the zone's sound screen, crew only, with a key", async () => {
    const r = await w.call("crew", "POST", "/api/moments/sound/check", { zones: ["main"] });
    expect(r.statusCode).toBe(200);
    const sent = w.events("demo").filter((e) => e.type === "moments.sound.played");
    expect(sent.map((e) => e.data.zone_key)).toEqual(["main"]);
    expect((await w.call("reader", "POST", "/api/moments/sound/check", {})).statusCode).toBe(403);
  });

  it("the desk shows each zone's budget, what it lets through and its sound screen", async () => {
    w.zoneStatus.set("main", { energy: "calm", device: w.soundScreen });
    await w.call("crew", "POST", "/api/moments/spotlight", { show: "message", title: "Hi" });
    const desk = json(await w.call("reader", "GET", "/api/moments/sound"));
    expect(desk.zones).toEqual([
      {
        zone_key: "main",
        minute: 1,
        hour: 1,
        energy: "calm",
        lets_through: ["urgent", "result", "attention"],
        sound_screen: w.soundScreen,
      },
    ]);
  });

  describe("the library", () => {
    const asset = (id: string, o: Row = {}) =>
      w.assets.set(id, {
        id,
        kind: "audio",
        title: "Drumroll",
        url: `/api/screen/files/${"a".repeat(64)}.mp3`,
        size_bytes: 400_000,
        duration_seconds: 18,
        ...o,
      });

    it("links Screen's audio asset, warns over 10 s, and lets any cue use it", async () => {
      asset("as_1");
      const r = await w.call("admin", "POST", "/api/moments/sounds", { asset_id: "as_1" });
      expect(r.statusCode).toBe(201);
      const sound = json(r);
      expect(sound).toMatchObject({ title: "Drumroll", length_ms: 18_000, source: "upload" });
      expect(sound.warning).toMatch(/over 10 s/);
      const cue = await cueOf("pizza.placed");
      const put = await w.call("admin", "PUT", "/api/moments/cues/pizza.placed", {
        ...cue,
        sounds: [sound.id],
      });
      expect(put.statusCode).toBe(200);
      const lib = json(await w.call("reader", "GET", "/api/moments/sounds")).sounds as Row[];
      expect(lib.find((s) => s.id === sound.id)?.used_by).toEqual(["pizza.placed"]);
      expect(lib.filter((s) => s.source === "pack")).toHaveLength(11);
      const busy = await w.call("admin", "DELETE", `/api/moments/sounds/${String(sound.id)}`);
      expect(errorOf(busy).code).toBe("sound_in_use");
      expect(w.audit.at(-1)?.action).toBe("moments.cue.changed");
    });

    it("refuses an asset over 1 MiB or 30 s, not audio, or not the event's", async () => {
      asset("big", { size_bytes: 1_048_577 });
      asset("long", { duration_seconds: 30.5 });
      asset("pic", { kind: "image" });
      const link = (id: string) => w.call("admin", "POST", "/api/moments/sounds", { asset_id: id });
      expect(errorOf(await link("big")).code).toBe("invalid_request");
      expect(errorOf(await link("long")).code).toBe("invalid_request");
      expect(errorOf(await link("pic")).code).toBe("invalid_request");
      expect((await link("gone")).statusCode).toBe(404);
    });
  });

  it("serves the default pack to anyone, and nothing else from there", async () => {
    const r = await w.call(null, "GET", "/api/moments/sounds/pack/gong.ogg");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("audio/ogg");
    expect(r.headers["cache-control"]).toContain("max-age");
    expect((await w.call(null, "GET", "/api/moments/sounds/pack/CREDITS.md")).statusCode).toBe(404);
    // Refused before the handler (400) or by it (404): never a file outside the pack.
    const climb = await w.call(null, "GET", "/api/moments/sounds/pack/..%2Fmoments.js");
    expect([400, 404]).toContain(climb.statusCode);
  });
});
