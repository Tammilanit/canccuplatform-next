import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DATABASE_URL, call, code, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Region {
  id: string;
  role: string | null;
  idle: string;
  idle_view: { widget: string; view: Record<string, unknown> } | null;
  widgets: { widget: string; view: Record<string, unknown> }[];
}
interface State {
  state_version: number;
  tenant: { id: string; name: string; status: string };
  device: { id: string; mirror: boolean };
  zone: { key: string; epoch: string } | null;
  bundle: { version: string };
  theme: { revision: number };
  layout: { id: string } | null;
  regions: Region[];
  sound: { enabled: boolean; sounded_claims: string[] };
  offline: { marker_after_seconds: number };
}

const NEXT = {
  id: "it_1",
  title: "Dinner",
  kind: "meal",
  starts_at: "2026-01-01T13:00:00Z",
  ends_at: "2026-01-01T14:00:00Z",
  delay_minutes: 0,
  location: null,
  visibility: "public",
};

describe.skipIf(!DATABASE_URL)("the composed state", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(() => {
    h.sources.agenda = { current: [], next: [NEXT] };
    h.sources.event = { name: "Demo Event" };
    h.sources.venue = null;
    h.sources.theme = null;
  });

  const state = async (token: string) =>
    call(h, "GET", "/api/screen/device/state", {
      host: "alpha.test",
      cookies: { canccu_device: token },
    });
  const assignMain = async (id: string) => {
    await call(h, "GET", "/api/screen/zones", { host: "alpha.test", session: "admin" });
    const res = await call(h, "PUT", `/api/screen/devices/${id}/assignment`, {
      host: "alpha.test",
      session: "admin",
      body: { zone_key: "main" },
    });
    expect(res.statusCode).toBe(200);
  };

  it("refuses a browser without a device", async () => {
    const res = await call(h, "GET", "/api/screen/device/state", { host: "alpha.test" });
    expect(res.statusCode).toBe(401);
    expect(code(res)).toBe("device_unknown");
  });

  it("gives an unassigned device the same shape with no zone", async () => {
    const { id, token } = await pairDevice(h);
    const body = (await state(token)).json<State>();
    expect(body).toMatchObject({
      state_version: 0,
      tenant: { id: "alpha", name: "Demo Event", status: "live" },
      device: { id, mirror: false },
      zone: null,
      bundle: { version: "test" },
      theme: { revision: 0 },
      layout: null,
      regions: [],
      offline: { marker_after_seconds: 10 },
    });
  });

  it("composes the main zone: pulse, and an idle hero counting down to the next item", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Hall");
    await assignMain(id);
    const body = (await state(token)).json<State>();
    expect(body.zone?.key).toBe("main");
    expect(body.zone?.epoch).toEqual(expect.any(String));
    expect(body.layout?.id).toBe("pulse");
    const hero = body.regions.find((r) => r.id === "hero");
    expect(hero?.idle).toBe("next");
    expect(hero?.idle_view).toMatchObject({ widget: "countdown", view: { label: "Dinner" } });
    expect(body.regions.map((r) => r.id)).toContain("_full");
    expect(body.sound).toEqual({ enabled: false, sounded_claims: [] });
    expect(h.sources.hosts.at(-1)).toBe("alpha.test");
    // Module reads by the event's id: the info-page mode cannot refuse them, as it does a guest.
    expect(h.sources.tenants.slice(-2)).toEqual(["alpha", "alpha"]);
  });

  it("moves `state_version` only when what the screen draws changes", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Bar");
    await assignMain(id);
    const first = (await state(token)).json<State>().state_version;
    h.clock.now += 60_000;
    expect((await state(token)).json<State>().state_version).toBe(first);
    h.sources.agenda = { current: [], next: [{ ...NEXT, title: "Dinner, moved" }] };
    expect((await state(token)).json<State>().state_version).toBe(first + 1);
  });

  it("draws the portrait built-in for a device that reports a portrait viewport", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Door");
    await assignMain(id);
    await call(h, "POST", "/api/screen/device/heartbeat", {
      host: "alpha.test",
      cookies: { canccu_device: token },
      body: {
        state_version: 0,
        bundle_version: "test",
        theme_revision: 0,
        viewport: { width: 1080, height: 1920 },
      },
    });
    expect((await state(token)).json<State>().layout?.id).toBe("pulse_portrait");
  });

  it("keeps a screen drawing when every source is down", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Lobby");
    await assignMain(id);
    h.sources.agenda = null;
    h.sources.event = null;
    const body = (await state(token)).json<State>();
    const rail = body.regions.find((r) => r.id === "rail");
    expect(rail?.widgets.every((w) => w.view.empty === true && w.view.stale === true)).toBe(true);
    expect(body.regions.find((r) => r.id === "hero")?.idle_view).toBeNull();
  });

  describe("the hub's view", () => {
    it("shows the hub only the listed widget types", async () => {
      h.sources.venue = {
        wifi: [{ ssid: "Guests", password: "welcome", note: null, visibility: "public" }],
        floor_plan: null,
      };
      const res = await call(h, "GET", "/api/screen/now?zone=main", { host: "alpha.test" });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ zone: { key: string }; regions: Region[] }>();
      expect(body.zone.key).toBe("main");
      const types = body.regions.flatMap((r) => r.widgets.map((w) => w.widget));
      expect(types).toContain("agenda_now");
      expect(types).toContain("clock");
      for (const hidden of ["venue_info", "playlist", "photo", "checkin_qr", "qr", "embed"]) {
        expect(types).not.toContain(hidden);
      }
    });

    it("answers 400 for a bad key and 404 for a zone the event does not have", async () => {
      expect(
        (await call(h, "GET", "/api/screen/now?zone=Bad!", { host: "alpha.test" })).statusCode,
      ).toBe(400);
      const missing = await call(h, "GET", "/api/screen/now?zone=nowhere", { host: "alpha.test" });
      expect(missing.statusCode).toBe(404);
    });
  });
});

describe.skipIf(!DATABASE_URL)("the composed state after review", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    h.sources.agenda = { current: [], next: [NEXT] };
    h.sources.event = { name: "Demo Event" };
  });
  afterAll(async () => {
    await h.close();
  });

  const host = "alpha.test";
  const version = async (token: string) =>
    (
      await call(h, "GET", "/api/screen/device/state", { host, cookies: { canccu_device: token } })
    ).json<State>().state_version;
  const placeIn = async (id: string) => {
    await call(h, "GET", "/api/screen/zones", { host, session: "admin" });
    await call(h, "PUT", `/api/screen/devices/${id}/assignment`, {
      host,
      session: "admin",
      body: { zone_key: "main" },
    });
  };

  it("keeps one version for a landscape and a portrait screen of one zone", async () => {
    const wide = await pairDevice(h, host, "Wide");
    const tall = await pairDevice(h, host, "Tall");
    await placeIn(wide.id);
    await placeIn(tall.id);
    await call(h, "POST", "/api/screen/device/heartbeat", {
      host,
      cookies: { canccu_device: tall.token },
      body: {
        state_version: 0,
        bundle_version: "test",
        theme_revision: 0,
        viewport: { width: 1080, height: 1920 },
      },
    });
    const first = await version(wide.token);
    expect(await version(tall.token)).toBe(first);
    expect(await version(wide.token)).toBe(first);
    expect(await version(tall.token)).toBe(first);
  });

  it("moves the version when the zone's sound device changes", async () => {
    const screen = await pairDevice(h, host, "Sound");
    await placeIn(screen.id);
    const before = await version(screen.token);
    const zone = (await call(h, "GET", "/api/screen/zones/main", { host, session: "admin" })).json<{
      name: string;
      layout_id: string | null;
      regions: Record<string, unknown>;
      revision: number;
    }>();
    const saved = await call(h, "PUT", "/api/screen/zones/main", {
      host,
      session: "admin",
      body: {
        key: "main",
        name: zone.name,
        layout_id: zone.layout_id,
        regions: zone.regions,
        sound: { enabled: true, device_id: screen.id },
        revision: zone.revision,
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(await version(screen.token)).toBe(before + 1);
  });

  it("draws `header` and `hub_qr` as the zone sets them, and moves the version with each", async () => {
    const screen = await pairDevice(h, host, "Options");
    await placeIn(screen.id);
    const read = async () =>
      (
        await call(h, "GET", "/api/screen/device/state", {
          host,
          cookies: { canccu_device: screen.token },
        })
      ).json<State>();
    const first = await read();
    const ids = (s: State) => s.regions.map((r) => r.id);
    expect(ids(first)).toEqual(expect.arrayContaining(["header-2", "venue_rail-2"]));
    expect(first.layout).toMatchObject({ id: "pulse" });
    const save = async (options: Record<string, string>) => {
      const zone = (
        await call(h, "GET", "/api/screen/zones/main", { host, session: "admin" })
      ).json<Record<string, unknown>>();
      const res = await call(h, "PUT", "/api/screen/zones/main", {
        host,
        session: "admin",
        body: { ...zone, ...options },
      });
      expect(res.statusCode).toBe(200);
    };
    await save({ header: "shared" });
    const shared = await read();
    expect(shared.state_version).toBe(first.state_version + 1);
    expect(ids(shared)).not.toContain("header-2");
    expect(ids(shared)).toContain("venue_rail-2");
    await save({ header: "shared", hub_qr: "rotate" });
    const rotating = await read();
    expect(rotating.state_version).toBe(first.state_version + 2);
    expect(ids(rotating)).not.toContain("venue_rail-2");
    expect(
      rotating.regions.find((r) => r.id === "venue_rail")?.widgets.map((w) => w.widget),
    ).toEqual(["qr", "venue_info", "food_status"]);
  });

  it("serves a public event's hub when admin is down for a signed-in viewer", async () => {
    const res = await call(h, "GET", "/api/screen/now?zone=main", { host, session: "admin-down" });
    expect(res.statusCode).toBe(200);
  });
});
