/**
 * The push channel end to end on a listening server (inject cannot read a response that never
 * ends): the first state, pushed changes, resume, commands, reassignment, revocation, and an
 * open stream counting as seen. The bus is fed to the hub by hand, as main's subscription does.
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { applyOverrideEvent } from "../src/compose/overrides.js";
import { DATABASE_URL, TENANTS, call, context, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { pushClient } from "./sse.js";
import type { Frame } from "./sse.js";

describe.skipIf(!DATABASE_URL)("the push channel", () => {
  let h: Harness;
  let client: ReturnType<typeof pushClient>;
  const pump = () => {
    client.pump();
  };
  const open = (token: string, lastEventId?: string) => client.open(token, lastEventId);
  const screen = (zone?: string) => client.screen(zone);

  beforeAll(async () => {
    h = await harness();
    await h.app.listen({ host: "127.0.0.1", port: 0 });
    client = pushClient(h, (h.app.server.address() as AddressInfo).port);
    h.sources.event = { name: "Demo Event" };
  });
  afterAll(async () => {
    await h.close();
  });

  const ticker = (text: string) =>
    call(h, "PUT", "/api/screen/ticker", { session: "admin", body: { text, until: null } });

  it("refuses a browser without a device", async () => {
    const sse = open("nope");
    expect(await sse.status).toBe(401);
    sse.close();
  });

  it("opens with the whole state, then pushes a ticker change as one `ticker` message", async () => {
    const { token } = await screen();
    const sse = open(token);
    expect(await sse.status).toBe(200);
    const first = await sse.next();
    expect(first.event).toBe("state");
    const zone = first.data.zone as { key: string; epoch: string };
    const version = first.data.state_version as number;
    expect(first.id).toBe(`main.${zone.epoch}.${version}`);

    const started = Date.now();
    expect((await ticker("Doors close at ten")).statusCode).toBe(200);
    pump();
    const pushed = await sse.next();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(pushed).toMatchObject({
      event: "ticker",
      id: `main.${zone.epoch}.${version + 1}`,
      data: { state_version: version + 1, ticker: { text: "Doors close at ten" } },
    });
    sse.close();
  });

  it("resumes with the changes since Last-Event-ID, and sends a state when it cannot", async () => {
    const { token } = await screen();
    const sse = open(token);
    const first = await sse.next("state");
    sse.close();
    await sse.ended;
    // No stream is open now: the next read builds the change, as a polling screen's would.
    await ticker("Bring your own cup");
    await call(h, "GET", "/api/screen/device/state", { cookies: { canccu_device: token } });

    const resumed = open(token, first.id);
    const missed = await resumed.next();
    expect(missed.event).toBe("ticker");
    expect(missed.data.ticker).toMatchObject({ text: "Bring your own cup" });
    resumed.close();

    const epoch = (first.data.zone as { epoch: string }).epoch;
    for (const stale of [`main.other.${String(first.data.state_version)}`, `main.${epoch}.999`]) {
      const fresh = open(token, stale);
      expect((await fresh.next()).event).toBe("state");
      fresh.close();
    }
  });

  it("resumes a zone whose epoch has the base64url `-` and `_`", async () => {
    // Epochs are random base64url, so about one zone in five has one of these characters.
    const zone = { key: "foyer", name: "Foyer" };
    expect(
      (await call(h, "POST", "/api/screen/zones", { session: "admin", body: zone })).statusCode,
    ).toBe(201);
    await h.pool.query(
      "UPDATE screen_zones SET epoch = '-a_B-c_D' WHERE tenant_id = 'alpha' AND key = 'foyer'",
    );
    const { token } = await screen("foyer");
    const sse = open(token);
    const first = await sse.next("state");
    expect(first.id).toMatch(/^foyer\.-a_B-c_D\.\d+$/);
    sse.close();
    await sse.ended;
    await ticker("Mind the step");
    await call(h, "GET", "/api/screen/device/state", { cookies: { canccu_device: token } });
    const resumed = open(token, first.id);
    const missed = await resumed.next();
    expect(missed.event).toBe("ticker");
    expect(missed.data.ticker).toMatchObject({ text: "Mind the step" });
    resumed.close();
  });

  it("rebuilds a zone with streams on the refresh too, in one container per period", async () => {
    const { token } = await screen();
    const sse = open(token);
    await sse.next("state");
    // A change whose event no container read (it came while none ran).
    await ticker("Late shuttle at two");
    await h.app.pushHub.refreshAll();
    const pushed = await sse.next();
    expect(pushed.data.ticker).toMatchObject({ text: "Late shuttle at two" });
    // The claim for this period is taken: another container's refresh builds nothing.
    await ticker("Later shuttle at three");
    await h.app.pushHub.refreshAll();
    const later: Frame[] = [];
    await sse
      .next(undefined, 400)
      .then((f) => later.push(f))
      .catch(() => undefined);
    // Only the rest of the first change (the ticker widget's view) may still arrive.
    expect(later.every((f) => f.data.state_version === pushed.data.state_version)).toBe(true);
    sse.close();
  });

  it("pushes a content widget's own change (a code rotates) when it is due, with no event", async () => {
    const at = (ms: number) => new Date(h.clock.now + ms).toISOString();
    const code = (c: string, rotatesIn: number) => ({
      purpose: "arrival",
      code: c,
      url: `/notify/check-in?p=arrival&c=${c}`,
      valid_until: at(60_000),
      rotates_at: at(rotatesIn),
    });
    h.sources.checkin = code("first", 300);
    const zone = {
      key: "door",
      name: "Door",
      regions: { hero: { widgets: [{ widget: "checkin_qr" }] } },
    };
    expect(
      (await call(h, "POST", "/api/screen/zones", { session: "admin", body: zone })).statusCode,
    ).toBe(201);
    const { token } = await screen("door");
    const sse = open(token);
    await sse.next("state");
    h.clock.now += 300;
    h.sources.checkin = code("second", 30_000);
    const pushed = await sse.next("widget", 3_000);
    expect(pushed.data.view).toMatchObject({
      url: "https://alpha.test/notify/check-in?p=arrival&c=second",
    });
    sse.close();
  });

  it("delivers a command once, as a `command` message", async () => {
    const { id, token } = await screen();
    const sse = open(token);
    await sse.next("state");
    const sent = await call(h, "POST", `/api/screen/devices/${id}/commands`, {
      session: "admin",
      body: { command: "identify" },
    });
    expect(sent.statusCode).toBe(202);
    const command = await sse.next("command");
    expect(command.data).toMatchObject({ command: "identify" });
    expect(typeof command.data.expires_at).toBe("string");
    await sse.next("ping");
    await sse.next("ping");
    await expect(sse.next("command", 300)).rejects.toThrow();
    sse.close();
  });

  it("sends a new state when the device moves to another zone", async () => {
    const { id, token } = await screen();
    const zone = { key: "cafe", name: "Café", layout_id: "pulse", regions: {} };
    expect(
      (await call(h, "POST", "/api/screen/zones", { session: "admin", body: zone })).statusCode,
    ).toBe(201);
    const sse = open(token);
    await sse.next("state");
    await call(h, "PUT", `/api/screen/devices/${id}/assignment`, {
      session: "admin",
      body: { zone_key: "cafe" },
    });
    pump();
    const moved = await sse.next();
    expect(moved.event).toBe("state");
    expect(moved.data.zone).toMatchObject({ key: "cafe" });
    expect(moved.id.startsWith("cafe.")).toBe(true);
    sse.close();
  });

  it("ends the stream when the device is revoked", async () => {
    const { id, token } = await screen();
    const sse = open(token);
    await sse.next("state");
    await call(h, "POST", `/api/screen/devices/${id}/revoke`, { session: "admin" });
    pump();
    await sse.ended;
    const again = open(token);
    expect(await again.status).toBe(401);
    again.close();
  });

  it("ends the stream at the next ping once the venue check refuses the screen", async () => {
    const { token } = await screen();
    const sse = open(token);
    await sse.next("state");
    const before = TENANTS["alpha.test"];
    TENANTS["alpha.test"] = context("alpha", {
      venue: { id: "v_1", name: "Demo Hall", addresses: ["10.1.0.0/24"] },
    });
    try {
      h.tenants.handleEvent({ source: "tenants", tenant: "alpha" } as Event);
      await sse.ended;
      const again = open(token);
      expect(await again.status).toBe(403);
      again.close();
    } finally {
      TENANTS["alpha.test"] = before as (typeof TENANTS)[string];
      h.tenants.handleEvent({ source: "tenants", tenant: "alpha" } as Event);
    }
  });

  it("counts an open stream as seen, and shows the lag behind the zone", async () => {
    const { id, token } = await screen();
    const health = async () =>
      (await call(h, "GET", "/api/screen/devices", { session: "admin" }))
        .json<{ devices: { id: string; health: Record<string, unknown> }[] }>()
        .devices.find((d) => d.id === id)?.health;
    const sse = open(token);
    const first = await sse.next("state");
    expect(await health()).toMatchObject({ online: true });
    expect(typeof (await health())?.last_seen_at).toBe("string");
    h.clock.now += 40_000;
    await sse.next("ping");
    await sse.next("ping");
    expect(await health()).toMatchObject({
      online: true,
      last_seen_at: new Date(h.clock.now).toISOString(),
    });
    const version = first.data.state_version as number;
    const beat = await call(h, "POST", "/api/screen/device/heartbeat", {
      cookies: { canccu_device: token },
      body: { state_version: version - 1, bundle_version: "test", theme_revision: 0 },
    });
    expect(beat.statusCode).toBe(200);
    expect((await health())?.state_lag).toBe(1);
    sse.close();
  });

  it("pushes a claim to the region it takes, once Moments' event is kept", async () => {
    const { token } = await screen();
    const sse = open(token);
    const first = await sse.next("state");
    const event: Event = {
      id: newId(),
      type: "moments.override.started",
      version: 1,
      time: new Date(h.clock.now).toISOString(),
      source: "moments",
      tenant: "alpha",
      data: {
        override: {
          id: "ov_10",
          kind: "block",
          zones: [],
          rank: 80,
          source: { module: "moments", event_id: null, ref: null },
          template: "announcement",
          content: { title: "Dinner is served", body: "Café", level: "info", starts_at: null },
          regions: ["rail"],
          starts_at: new Date(h.clock.now).toISOString(),
          ends_at: null,
        },
        actor_user_id: null,
      },
    };
    // As main's moments subscription does: keep the override, then tell the hub.
    await withTenant("alpha", () => applyOverrideEvent(h.db, event));
    h.app.pushHub.handleEvent(event);
    const pushed = await sse.next("region");
    expect(pushed.data).toMatchObject({
      state_version: (first.data.state_version as number) + 1,
      region: { id: "rail", claim: { override_id: "ov_10", role: "rail", hidden: false } },
    });
    sse.close();
  });
});
