/**
 * Moments' sounds on the zone's screens (contracts/screen.md, Sound; step 4 plan D14): the latest
 * `moments.sound.played` of a zone composed into `ScreenState.sound.play` with its `play_at`, the
 * heartbeat's played sounds returned so a reload never repeats one, a claim's `effect`, and the
 * two internal paths Moments asks.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceIdentity, newId, withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { applyOverrideEvent } from "../src/compose/overrides.js";
import { applySceneEvent } from "../src/compose/scenes.js";
import { applySoundEvent } from "../src/moments-sound.js";
import { DATABASE_URL, SERVICE_KEY, call, harness, pairDevice, png, upload } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Play {
  id: string;
  url: string | null;
  voice_url: string | null;
  volume: number;
  play_at: string;
  catch_up_until: string;
  interrupts: boolean;
}
interface State {
  sound: { enabled: boolean; sounded_claims: string[]; play: Play | null };
  regions: { id: string; claim: { effect?: unknown } | null }[];
}

describe.skipIf(!DATABASE_URL)("Moments' sounds on the screens", () => {
  let h: Harness;
  let sound = { id: "", token: "" };
  let other = { id: "", token: "" };
  const moments = new ServiceIdentity({ module: "moments", key: SERVICE_KEY });

  beforeAll(async () => {
    h = await harness();
    h.sources.event = { name: "Demo Event" };
    h.sources.agenda = { current: [], next: [] };
    sound = await pairDevice(h);
    other = await pairDevice(h, "alpha.test", "Second screen");
    await call(h, "GET", "/api/screen/zones", { session: "admin" });
    for (const d of [sound, other]) {
      await call(h, "PUT", `/api/screen/devices/${d.id}/assignment`, {
        session: "admin",
        body: { zone_key: "main" },
      });
    }
    const zone = (await call(h, "GET", "/api/screen/zones/main", { session: "admin" })).json<
      Record<string, unknown>
    >();
    const saved = await call(h, "PUT", "/api/screen/zones/main", {
      session: "admin",
      body: { ...zone, sound: { enabled: true, device_id: sound.id } },
    });
    expect(saved.statusCode).toBe(200);
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    h.clock.now = Date.parse("2026-01-01T12:00:00Z");
    await withTenant("alpha", () =>
      h.db.tenant(async (c) => {
        await c.query("DELETE FROM screen_zone_sounds");
        await c.query("DELETE FROM screen_scenes");
      }),
    );
  });

  const event = (type: string, data: Record<string, unknown>): Event => ({
    id: newId(),
    type,
    version: 1,
    time: new Date(h.clock.now).toISOString(),
    source: "moments",
    tenant: "alpha",
    data,
  });
  const play = (id: string, o: Partial<Play> = {}) =>
    event("moments.sound.played", {
      zone_key: "main",
      sound: {
        id,
        cue: "pizza.placed",
        category: "result",
        url: "/api/moments/sounds/pack/ding.ogg",
        voice_url: null,
        volume: 0.64,
        play_at: new Date(h.clock.now + 400).toISOString(),
        catch_up_until: new Date(h.clock.now + 120_400).toISOString(),
        interrupts: false,
        ...o,
      },
    });
  const apply = (e: Event) => withTenant("alpha", () => applySoundEvent(h.db, e));
  const state = async (token: string) =>
    (
      await call(h, "GET", "/api/screen/device/state", { cookies: { canccu_device: token } })
    ).json<State>();

  it("gives every screen of the zone the sound with its play_at; only the sound screen plays it", async () => {
    await apply(play("snd_1"));
    const s = await state(sound.token);
    expect(s.sound.enabled).toBe(true);
    expect(s.sound.play).toMatchObject({
      id: "snd_1",
      url: "/api/moments/sounds/pack/ding.ogg",
      volume: 0.64,
      play_at: "2026-01-01T12:00:00.400Z",
      interrupts: false,
    });
    const o = await state(other.token);
    expect(o.sound.enabled).toBe(false);
    expect(o.sound.play?.id).toBe("snd_1");
  });

  it("keeps the newest sound of a zone, whatever order the events come in", async () => {
    const first = play("snd_1");
    const second = play("snd_2");
    await apply(second);
    await apply(first);
    expect((await state(sound.token)).sound.play?.id).toBe("snd_2");
  });

  it("drops the sound from the state once its catch-up window has passed", async () => {
    await apply(play("snd_1"));
    h.clock.now += 121_000;
    expect((await state(sound.token)).sound.play).toBeNull();
  });

  it("returns what the device's heartbeat said it played, so a reload never repeats it", async () => {
    await apply(play("snd_1"));
    const beat = await call(h, "POST", "/api/screen/device/heartbeat", {
      cookies: { canccu_device: sound.token },
      body: {
        state_version: 1,
        bundle_version: "b1",
        theme_revision: 0,
        claims_sounded: ["snd_1"],
      },
    });
    expect(beat.statusCode).toBe(200);
    expect((await state(sound.token)).sound.sounded_claims).toEqual(["snd_1"]);
    expect((await state(other.token)).sound.sounded_claims).toEqual([]);
  });

  it("hands a claim's effect to its region", async () => {
    await withTenant("alpha", () =>
      applyOverrideEvent(
        h.db,
        event("moments.override.started", {
          actor_user_id: null,
          override: {
            id: "ov_fx",
            kind: "block",
            zones: ["main"],
            rank: 80,
            source: { module: "moments", event_id: null, ref: null },
            template: "announcement",
            content: { title: "Hi", body: "", level: "info", starts_at: "2026-01-01T12:00:00Z" },
            regions: ["rail"],
            expires_at: "2026-01-01T12:05:00Z",
            effect: { name: "ripple", hold_seconds: 90, fade_seconds: 10 },
            sound: null,
            steps: null,
            on_end: "resume",
            starts_at: "2026-01-01T12:00:00Z",
            ends_at: null,
          },
        }),
      ),
    );
    const rail = (await state(sound.token)).regions.find((r) => r.id === "rail");
    expect(rail?.claim?.effect).toEqual({ name: "ripple", hold_seconds: 90, fade_seconds: 10 });
  });

  describe("for Moments", () => {
    const internal = (url: string, signed = true) =>
      h.app.inject({
        method: "GET",
        url,
        headers: { host: "screen:8080", ...(signed ? moments.headers("screen") : {}) },
      });

    it("names a zone's energy and its sound screen", async () => {
      const r = await internal("/internal/screen/zones/main/sound?tenant_id=alpha");
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({
        energy: "lively",
        device: { id: sound.id, name: "Hall left", online: true, audio_unlocked: null },
      });
    });

    it("reads the zone's scene in the day's phase's place: its quiet mode and its sound switch", async () => {
      const scene = (then: Record<string, unknown>) =>
        withTenant("alpha", () =>
          applySceneEvent(
            h.db,
            event("moments.scene.changed", {
              zone_key: "main",
              scene: {
                key: "late",
                name: "Late",
                motion: null,
                layout: null,
                stage_mood: null,
                palette: null,
                sound: null,
                quiet: false,
                hero_off: [],
                blend_seconds: 0,
                ...then,
              },
              since: new Date(h.clock.now).toISOString(),
              why: "test",
              heartbeat_bpm: 8,
              actor_user_id: null,
            }),
          ),
        );
      const answer = async () =>
        (await internal("/internal/screen/zones/main/sound?tenant_id=alpha")).json<{
          energy: string;
          device: { id: string } | null;
        }>();
      await scene({ quiet: true });
      expect(await answer()).toMatchObject({ energy: "quiet", device: { id: sound.id } });
      await scene({ sound: false });
      expect(await answer()).toEqual({ energy: "lively", device: null });
      await scene({ sound: true, motion: "party" });
      expect(await answer()).toMatchObject({ energy: "party", device: { id: sound.id } });
    });

    it("answers only Moments' service identity, and 404 for a zone or event it does not know", async () => {
      expect(
        (await internal("/internal/screen/zones/main/sound?tenant_id=alpha", false)).statusCode,
      ).toBe(401);
      expect((await internal("/internal/screen/zones/nope/sound?tenant_id=alpha")).statusCode).toBe(
        404,
      );
      expect((await internal("/internal/screen/zones/main/sound?tenant_id=zzz")).statusCode).toBe(
        404,
      );
    });

    it("reads one of the event's assets", async () => {
      const up = (
        await upload(h, "/api/screen/assets", await png(), "a.png", { session: "admin" })
      ).json<{ id: string }>();
      const r = await internal(`/internal/screen/assets/${up.id}?tenant_id=alpha`);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ id: up.id, kind: "image" });
      expect((await internal("/internal/screen/assets/as_none?tenant_id=alpha")).statusCode).toBe(
        404,
      );
    });
  });
});
