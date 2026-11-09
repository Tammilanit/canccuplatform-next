import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, call, code, events, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Health {
  online: boolean;
  last_seen_at: string | null;
  now_playing?: unknown;
  bundle_version?: string | null;
  theme_revision?: number | null;
  audio_unlocked?: boolean;
  viewport?: unknown;
  clock_offset_ms: number | null;
  flags: string[];
}

const BASE = { state_version: 3, bundle_version: "b1", theme_revision: 2 };

describe.skipIf(!DATABASE_URL)("heartbeat and health", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  const beat = (token: string, body: Record<string, unknown> = {}, host = "alpha.test") =>
    call(h, "POST", "/api/screen/device/heartbeat", {
      host,
      cookies: { canccu_device: token },
      body: { ...BASE, ...body },
    });
  const health = async (id: string, host = "alpha.test"): Promise<Health | undefined> =>
    (await call(h, "GET", "/api/screen/devices", { host, session: "crew" }))
      .json<{ devices: { id: string; health: Health }[] }>()
      .devices.find((d) => d.id === id)?.health;
  const later = (seconds: number) => {
    h.clock.now += seconds * 1000;
  };
  const iso = (ms: number) => new Date(ms).toISOString();
  const forDevice = (type: string, id: string, tenant = "alpha") =>
    events(h, type, tenant).filter((e) => e.device_id === id);

  it("answers the server time and keeps what the device reported", async () => {
    const { id, token } = await pairDevice(h);
    await call(h, "PUT", `/api/screen/devices/${id}/assignment`, {
      session: "admin",
      body: { zone_key: "main" },
    });
    expect(await health(id)).toEqual({
      online: false,
      last_seen_at: null,
      now_playing: null,
      clock_offset_ms: null,
      flags: [],
    });
    const res = await beat(token, {
      now_playing: { region_id: "hero", widget: "playlist", item_id: "it_1" },
      audio_unlocked: true,
      viewport: { width: 1920, height: 1080 },
      claims_sounded: ["cl_1"],
      errors: [{ code: "ready_timeout", item_id: "it_1" }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ server_time: iso(h.clock.now) });
    expect(await health(id)).toEqual({
      online: true,
      last_seen_at: iso(h.clock.now),
      now_playing: { region_id: "hero", widget: "playlist", item_id: "it_1", claim_id: null },
      bundle_version: "b1",
      theme_revision: 2,
      audio_unlocked: true,
      viewport: { width: 1920, height: 1080 },
      clock_offset_ms: null,
      flags: [],
    });
    expect(forDevice("screen.device.online", id)).toEqual([
      { device_id: id, zone_key: "main", last_seen_at: iso(h.clock.now) },
    ]);
  });

  it("refuses a malformed heartbeat and one without a valid device", async () => {
    const { token } = await pairDevice(h);
    for (const bad of [
      { state_version: -1 },
      { bundle_version: 7 },
      { theme_revision: "2" },
      { viewport: { width: 0, height: 10 } },
      { client_time: "yesterday" },
      { rtt_ms: 600_001 },
      { instance_id: "short" },
      { now_playing: { widget: "clock" } },
      { claims_sounded: Array.from({ length: 51 }, (_, i) => `c${i}`) },
      { errors: [{ detail: "no code" }] },
    ]) {
      const res = await beat(token, bad);
      expect([res.statusCode, code(res)], JSON.stringify(bad)).toEqual([400, "invalid_request"]);
    }
    expect(code(await beat("not-a-token"))).toBe("device_unknown");
    // Another event at the same venue: the token is valid, the event is not the device's.
    expect(code(await beat(token, {}, "beta.test"))).toBe("device_moved");
  });

  it("goes offline once after offline_after_seconds, through the sweep, and back online", async () => {
    const { id, token } = await pairDevice(h);
    await beat(token);
    const seen = h.clock.now;
    later(44);
    await h.sweep();
    expect(forDevice("screen.device.offline", id)).toEqual([]);
    expect((await health(id))?.online).toBe(true);

    later(2);
    expect((await health(id))?.online).toBe(false);
    await h.sweep();
    await h.sweep();
    expect(forDevice("screen.device.offline", id)).toEqual([
      { device_id: id, zone_key: null, last_seen_at: iso(seen) },
    ]);
    expect(await health(id)).toMatchObject({ online: false, last_seen_at: iso(seen) });

    await beat(token);
    await beat(token);
    expect(forDevice("screen.device.online", id)).toHaveLength(2);
  });

  it("clamps offline_after_seconds to at least twice heartbeat_seconds", async () => {
    h.settings.beta = { heartbeat_seconds: 60, offline_after_seconds: 15 };
    const { id, token } = await pairDevice(h, "beta.test");
    await beat(token, {}, "beta.test");
    later(119);
    await h.sweep();
    expect((await health(id, "beta.test"))?.online).toBe(true);
    later(2);
    await h.sweep();
    expect(forDevice("screen.device.offline", id, "beta")).toHaveLength(1);

    h.settings.beta = { heartbeat_seconds: 10, offline_after_seconds: 30 };
    await beat(token, {}, "beta.test");
    later(31);
    expect((await health(id, "beta.test"))?.online).toBe(false);
  });

  it("emits playing_changed at most once per device per 10 seconds", async () => {
    const { id, token } = await pairDevice(h);
    const playing = (item_id: string) => ({
      now_playing: { region_id: "hero", widget: "playlist", item_id },
    });
    const changes = () =>
      forDevice("screen.device.playing_changed", id).map(
        (e) => (e.now_playing as { item_id: string }).item_id,
      );
    await beat(token, playing("a"));
    later(5);
    await beat(token, playing("b"));
    await beat(token, playing("b"));
    expect(changes()).toEqual(["a"]);
    later(5);
    await beat(token, playing("b"));
    later(15);
    await beat(token, playing("b"));
    expect(changes()).toEqual(["a", "b"]);
    expect(forDevice("screen.device.playing_changed", id).at(-1)).toEqual({
      device_id: id,
      zone_key: null,
      now_playing: { region_id: "hero", widget: "playlist", item_id: "b", claim_id: null },
    });
    // Back to what was last announced within 10 seconds: nothing changed for admin.
    later(2);
    await beat(token, playing("c"));
    await beat(token, playing("b"));
    await beat(token, playing("c"));
    later(15);
    await beat(token, playing("c"));
    expect(changes()).toEqual(["a", "b", "c"]);
  });

  it("works out the clock offset and flags a drift over 2 seconds", async () => {
    const { id, token } = await pairDevice(h);
    await beat(token, { client_time: iso(h.clock.now + 1500), rtt_ms: 800 });
    expect(await health(id)).toMatchObject({ clock_offset_ms: 1900, flags: [] });
    await beat(token, { client_time: iso(h.clock.now - 2600), rtt_ms: 400 });
    expect(await health(id)).toMatchObject({ clock_offset_ms: -2400, flags: ["clock_drift"] });
    // A heartbeat without the time keeps the last offset.
    await beat(token);
    expect(await health(id)).toMatchObject({ clock_offset_ms: -2400, flags: ["clock_drift"] });
    await beat(token, { client_time: iso(h.clock.now + 2000) });
    expect(await health(id)).toMatchObject({ clock_offset_ms: 2000, flags: [] });
  });

  it("flags one token used by two page loads at once, but never a reload", async () => {
    const { id, token } = await pairDevice(h);
    const flags = async () => (await health(id))?.flags;
    const a = "aaaaaaaaaaaaaaaa";
    const b = "bbbbbbbbbbbbbbbb";
    const c = "cccccccccccccccc";

    // A reload: the old page stops as the new one starts.
    await beat(token, { instance_id: a });
    later(15);
    await beat(token, { instance_id: a });
    later(1);
    await beat(token, { instance_id: b });
    expect(await flags()).toEqual([]);
    later(15);
    await beat(token, { instance_id: b });
    expect(await flags()).toEqual([]);
    later(15);
    await beat(token, { instance_id: b });
    expect(await flags()).toEqual([]);

    // A second kiosk with a copy of the cookie.
    later(1);
    await beat(token, { instance_id: c });
    later(14);
    await beat(token, { instance_id: b });
    later(1);
    await beat(token, { instance_id: c });
    expect(await flags()).toEqual(["shared_token"]);
    // The copy is unplugged: the flag clears within two heartbeats.
    later(14);
    await beat(token, { instance_id: b });
    later(15);
    await beat(token, { instance_id: b });
    expect(await flags()).toEqual([]);
  });

  it("keeps health inside its own event (cross-event leak tests)", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Alpha health");
    await beat(token, { now_playing: { region_id: "hero", widget: "clock" } });
    const beta = await call(h, "GET", "/api/screen/devices", {
      host: "beta.test",
      session: "admin",
    });
    expect(beta.json<{ devices: { id: string }[] }>().devices.map((d) => d.id)).not.toContain(id);
    for (const type of ["online", "playing_changed"]) {
      expect(forDevice(`screen.device.${type}`, id, "beta")).toEqual([]);
    }
    later(100);
    await h.sweep();
    expect(forDevice("screen.device.offline", id, "beta")).toEqual([]);
    expect(forDevice("screen.device.offline", id)).toHaveLength(1);
    expect((await call(h, "GET", "/api/screen/devices", { session: "content" })).statusCode).toBe(
      403,
    );
  });
});
