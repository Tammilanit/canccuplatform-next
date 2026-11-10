/**
 * A device leaving an event (revoke, move, park, delete): what each event hears when parts of
 * the after-commit work fail, the health a late heartbeat must not bring back, and what the
 * registry audits (#316).
 */
import { TenantResolver, withTenant } from "@canccu/kit";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { healthOf, recordHeartbeat } from "../src/health.js";
import {
  DATABASE_URL,
  SUPERADMIN_HOST,
  call,
  code,
  events,
  harness,
  pairDevice,
} from "./helpers.js";
import type { Call, Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("a device leaving an event", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const root: Call = { host: SUPERADMIN_HOST, session: "root" };
  const move = (id: string, body: unknown) =>
    call(h, "PATCH", `/api/screen/registry/devices/${id}`, { ...root, body });
  const beat = { state_version: 1, bundle_version: "b1", theme_revision: 1 };
  const heartbeat = (token: string) =>
    call(h, "POST", "/api/screen/device/heartbeat", {
      cookies: { canccu_device: token },
      body: beat,
    });
  const revoke = (id: string) =>
    call(h, "POST", `/api/screen/devices/${id}/revoke`, { session: "admin" });
  /** The ids the event's offline sweep reports, an hour on. */
  async function reportedOffline(tenant = "alpha"): Promise<unknown[]> {
    h.clock.now += 3600_000;
    await h.sweep();
    return events(h, "screen.device.offline", tenant).map((e) => e.device_id);
  }
  const health = (tenant: string, id: string) =>
    withTenant(tenant, async () => (await healthOf(h.kv, [id], h.clock.now)).get(id));

  it("tells the new event and forgets the health even when the old event cannot be told", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Unheard");
    await heartbeat(token);
    const publish = h.bus.publish.bind(h.bus);
    vi.spyOn(h.bus, "publish").mockImplementation((type, ...rest) =>
      type === "screen.device.released"
        ? Promise.reject(new Error("the bus is down"))
        : publish(type, ...rest),
    );
    expect((await move(id, { current_tenant_id: "beta" })).statusCode).toBe(200);
    expect(events(h, "screen.device.moved", "beta").at(-1)).toMatchObject({ device_id: id });
    expect(await reportedOffline()).not.toContain(id);
  });

  it("tells both events even when forgetting the health fails", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Remembered");
    vi.spyOn(h.kv, "del").mockRejectedValueOnce(new Error("valkey is down"));
    expect((await move(id, { current_tenant_id: "beta" })).statusCode).toBe(200);
    expect(events(h, "screen.device.released").at(-1)).toMatchObject({ device_id: id });
    expect(events(h, "screen.device.moved", "beta").at(-1)).toMatchObject({ device_id: id });
  });

  it("keeps a heartbeat that was in flight during the move from bringing the health back", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Late beat");
    expect((await move(id, { current_tenant_id: "beta" })).statusCode).toBe(200);
    // The heartbeat passed its device check before the move and writes after the forget.
    const deps = {
      db: h.db,
      kv: h.kv,
      bus: h.bus,
      now: () => h.clock.now,
      settings: { ensure: () => Promise.resolve(), get: (_k: string, d: unknown) => d },
    };
    await withTenant("alpha", () =>
      recordHeartbeat(
        deps as Parameters<typeof recordHeartbeat>[0],
        id,
        { ...beat, now_playing: null },
        h.clock.now,
      ),
    );
    expect(await health("alpha", id)).toMatchObject({ online: false, last_seen_at: null });
    expect(events(h, "screen.device.online").map((e) => e.device_id)).not.toContain(id);
    expect(await reportedOffline()).not.toContain(id);
  });

  it("forgets the health on an event revoke, as on a move or a delete", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Revoked");
    await heartbeat(token);
    expect((await revoke(id)).statusCode).toBe(204);
    expect(await reportedOffline()).not.toContain(id);
  });

  it("tells an event that heard `revoked` nothing more when the device is parked or deleted", async () => {
    for (const leave of [
      (id: string) => move(id, { current_tenant_id: null }),
      (id: string) => call(h, "DELETE", `/api/screen/registry/devices/${id}`, root),
    ]) {
      const { id } = await pairDevice(h, "alpha.test", "Revoked earlier");
      expect((await revoke(id)).statusCode).toBe(204);
      expect([200, 204]).toContain((await leave(id)).statusCode);
      const heard = [
        ...events(h, "screen.device.released"),
        ...events(h, "screen.device.revoked"),
      ].filter((e) => e.device_id === id);
      expect(heard).toHaveLength(1);
    }
  });

  it("looks the target event up before it locks the device", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Unlocked");
    // Called below with the resolver as `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const byId = TenantResolver.prototype.byId;
    const locked: boolean[] = [];
    vi.spyOn(TenantResolver.prototype, "byId").mockImplementation(async function (
      this: TenantResolver,
      tenant: string,
    ) {
      const probe = await h.pool
        .query("SELECT 1 FROM devices WHERE id = $1 FOR UPDATE NOWAIT", [id])
        .then(() => false)
        .catch(() => true);
      locked.push(probe);
      return byId.call(this, tenant);
    });
    expect((await move(id, { current_tenant_id: "beta" })).statusCode).toBe(200);
    expect(locked).toContain(false);
    expect(locked).not.toContain(true);
  });

  it("answers 404 on an event hostname whatever the body", async () => {
    for (const [type, payload] of [
      ["application/json", "{not json"],
      ["text/plain", "x"],
    ] as const) {
      const res = await h.app.inject({
        method: "PATCH",
        url: "/api/screen/registry/devices/dv_x",
        headers: { host: "alpha.test", "content-type": type, cookie: "canccu_session=root" },
        payload,
      });
      expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
    }
  });

  it("audits `moved` only for a change of event, and nothing for no change", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Labelled");
    const last = () => h.audits.filter((a) => a.target.id === id).at(-1);
    expect((await move(id, { current_tenant_id: null })).statusCode).toBe(200);
    expect(last()).toMatchObject({ action: "screen.device.moved" });

    expect((await move(id, { venue_id: "v_2" })).statusCode).toBe(200);
    expect(last()).toMatchObject({
      action: "screen.device.rehomed",
      changes: { venue_id: { from: "v_1", to: "v_2" } },
    });

    const count = h.audits.length;
    for (const body of [{}, { venue_id: "v_2" }, { name: "Labelled" }]) {
      const res = await move(id, body);
      expect(res.json()).toMatchObject({ id, name: "Labelled", venue_id: "v_2" });
    }
    expect(h.audits).toHaveLength(count);

    expect((await move(id, { name: "Renamed" })).statusCode).toBe(200);
    expect(last()).toMatchObject({ action: "screen.device.renamed" });
  });
});
