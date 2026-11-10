import { withTenant } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DATABASE_URL,
  SIGNIN_HOST,
  SUPERADMIN_HOST,
  call,
  code,
  events,
  harness,
  pairDevice,
} from "./helpers.js";
import type { Call, Harness } from "./helpers.js";

interface Registered {
  id: string;
  name: string;
  venue_id: string | null;
  current_tenant_id: string | null;
  revoked_at: string | null;
}

describe.skipIf(!DATABASE_URL)("the superadmin's device registry", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    await call(h, "POST", "/api/screen/zones", {
      session: "admin",
      body: { key: "stage", name: "Stage" },
    });
  });
  afterAll(async () => {
    await h.close();
  });

  const root = (extra: Call = {}): Call => ({ host: SUPERADMIN_HOST, session: "root", ...extra });
  const move = (id: string, body: unknown, c: Call = root()) =>
    call(h, "PATCH", `/api/screen/registry/devices/${id}`, { ...c, body });
  const listed = async (host: string) =>
    (await call(h, "GET", "/api/screen/devices", { host, session: "admin" }))
      .json<{ devices: { id: string; zone_key: string | null }[] }>()
      .devices.map((d) => d.id);
  const rows = (tenant: string, sql: string) =>
    withTenant(tenant, () => h.db.tenant(async (c) => (await c.query(sql)).rows));

  it("answers only the superadmin, and only on the superadmin hostname", async () => {
    const { id } = await pairDevice(h);
    const list = await call(h, "GET", "/api/screen/registry/devices", root());
    expect(list.statusCode).toBe(200);
    expect(list.json<{ devices: Registered[] }>().devices).toContainEqual(
      expect.objectContaining({
        id,
        venue_id: "v_1",
        current_tenant_id: "alpha",
        revoked_at: null,
      }),
    );
    // A tenant's hostname or the sign-in host learns nothing, not even with the superadmin's cookie.
    for (const host of ["alpha.test", SIGNIN_HOST]) {
      for (const [method, path] of [
        ["GET", "/api/screen/registry/devices"],
        ["PATCH", `/api/screen/registry/devices/${id}`],
        ["DELETE", `/api/screen/registry/devices/${id}`],
      ] as const) {
        const res = await call(h, method, path, { host, session: "root", body: { name: "x" } });
        expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
      }
    }
    expect(
      code(await call(h, "GET", "/api/screen/registry/devices", root({ session: "admin" }))),
    ).toBe("missing_right");
    expect(code(await call(h, "GET", "/api/screen/registry/devices", root({ session: "" })))).toBe(
      "not_signed_in",
    );
    // The superadmin hostname is no event: every event route is 404 there.
    for (const [method, path] of [
      ["GET", "/api/screen/devices"],
      ["POST", "/api/screen/pairing"],
      ["GET", "/api/screen/pairing/pr_x"],
      ["GET", "/api/screen/device/home"],
      ["GET", "/api/screen/zones"],
    ] as const) {
      const res = await call(h, method, path, root());
      expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
    }
    // Filtered by venue.
    const far = await call(h, "GET", "/api/screen/registry/devices?venue_id=v_2", root());
    expect(far.json<{ devices: Registered[] }>().devices).toEqual([]);
  });

  it("moves a device to another event at its venue, leaving nothing behind (cross-event leak tests)", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Moving");
    const { id: mirror } = await pairDevice(h, "alpha.test", "Mirror");
    const admin = { session: "admin" };
    await call(h, "PUT", `/api/screen/devices/${id}/assignment`, {
      ...admin,
      body: { zone_key: "stage" },
    });
    await call(h, "PUT", `/api/screen/devices/${mirror}/assignment`, {
      ...admin,
      body: { mirror_of: { device_id: id } },
    });
    const sound = await call(h, "GET", "/api/screen/zones/stage", admin);
    await call(h, "PUT", "/api/screen/zones/stage", {
      ...admin,
      body: { ...sound.json<Record<string, unknown>>(), sound: { enabled: true, device_id: id } },
    });
    expect(
      (await call(h, "GET", "/api/screen/zones/stage", admin)).json<{ sound: unknown }>().sound,
    ).toEqual({ enabled: true, device_id: id });

    const moved = await move(id, { current_tenant_id: "beta", name: "Moved" });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({
      id,
      name: "Moved",
      venue_id: "v_1",
      current_tenant_id: "beta",
    });
    expect(h.audits.at(-1)).toEqual({
      tenant_id: null,
      actor_user_id: "u_root",
      action: "screen.device.moved",
      target: { type: "device", id },
      changes: {
        current_tenant_id: { from: "alpha", to: "beta" },
        name: { from: "Moving", to: "Moved" },
      },
    });
    // Each event hears only its side, and neither names the other.
    expect(events(h, "screen.device.released", "alpha").at(-1)).toEqual({
      device_id: id,
      actor_user_id: "u_root",
    });
    expect(events(h, "screen.device.moved", "beta").at(-1)).toEqual({
      device_id: id,
      name: "Moved",
      actor_user_id: "u_root",
    });
    expect(JSON.stringify(events(h, "screen.device.moved", "beta"))).not.toContain("alpha");
    expect(events(h, "screen.device.moved", "alpha")).toEqual([]);
    // No dangling references in alpha: the mirror is unassigned, the zone plays no sound on it.
    expect(events(h, "screen.device.assigned", "alpha").at(-1)).toMatchObject({
      device_id: mirror,
      mirror_of: null,
    });
    const stage = await call(h, "GET", "/api/screen/zones/stage", admin);
    expect(stage.json<{ sound: { device_id: string | null } }>().sound.device_id).toBeNull();

    // alpha's routes no longer reach it; beta's do, with no zone of alpha's carried over.
    expect(await listed("alpha.test")).not.toContain(id);
    expect(await listed("beta.test")).toContain(id);
    for (const [method, path, body] of [
      ["PATCH", `/api/screen/devices/${id}`, { name: "taken" }],
      ["POST", `/api/screen/devices/${id}/revoke`, undefined],
      ["PUT", `/api/screen/devices/${id}/assignment`, { zone_key: "stage" }],
      ["DELETE", `/api/screen/devices/${id}/assignment`, undefined],
      ["POST", `/api/screen/devices/${id}/commands`, { command: "reload" }],
    ] as const) {
      const res = await call(h, method, path, { ...admin, ...(body ? { body } : {}) });
      expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
    }
    expect(await rows("alpha", `SELECT 1 FROM assignments WHERE device_id = '${id}'`)).toEqual([]);
    expect(
      await rows(
        "beta",
        `SELECT zone_key, mirror_device_id FROM assignments WHERE device_id = '${id}'`,
      ),
    ).toEqual([{ zone_key: null, mirror_device_id: null }]);
  });

  it("forgets the device's health in the event it left", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Seen");
    const beat = { state_version: 1, bundle_version: "b1", theme_revision: 1 };
    await call(h, "POST", "/api/screen/device/heartbeat", {
      cookies: { canccu_device: token },
      body: beat,
    });
    expect((await move(id, { current_tenant_id: "beta" })).statusCode).toBe(200);
    h.clock.now += 3600_000;
    await h.sweep();
    expect(events(h, "screen.device.offline", "alpha").map((e) => e.device_id)).not.toContain(id);
  });

  it("parks a device, and refuses an event elsewhere, unknown or archived", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Parked");
    const parked = await move(id, { current_tenant_id: null });
    expect(parked.json()).toMatchObject({ current_tenant_id: null });
    expect(events(h, "screen.device.released", "alpha").at(-1)).toMatchObject({ device_id: id });

    for (const [body, status, err] of [
      [{ current_tenant_id: "far" }, 400, "invalid_request"],
      [{ current_tenant_id: "nowhere" }, 400, "invalid_request"],
      [{ current_tenant_id: "Not An Id" }, 400, "invalid_request"],
      [{ current_tenant_id: "gamma" }, 409, "event_archived"],
      [{ current_tenant_id: "delta" }, 409, "no_venue"],
      [{ name: "" }, 400, "invalid_request"],
      [{ venue_id: 7 }, 400, "invalid_request"],
    ] as const) {
      const res = await move(id, body);
      expect([res.statusCode, code(res)]).toEqual([status, err]);
    }
    // A new venue and an event there, in one move.
    const rehomed = await move(id, { venue_id: "v_2", current_tenant_id: "far" });
    expect(rehomed.json()).toMatchObject({ venue_id: "v_2", current_tenant_id: "far" });
    // A venue that is not the current event's would leave the device at the wrong place.
    expect(code(await move(id, { venue_id: "v_1" }))).toBe("invalid_request");
    expect(code(await move("dv_none", { name: "x" }))).toBe("not_found");
  });

  it("deletes a device: the token stops, the row goes, its event hears revoked", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Gone");
    const { id: mirror } = await pairDevice(h, "alpha.test", "Its mirror");
    await call(h, "PUT", `/api/screen/devices/${mirror}/assignment`, {
      session: "admin",
      body: { mirror_of: { device_id: id } },
    });
    const del = await call(h, "DELETE", `/api/screen/registry/devices/${id}`, root());
    expect(del.statusCode).toBe(204);
    expect(h.audits.at(-1)).toMatchObject({
      tenant_id: null,
      actor_user_id: "u_root",
      action: "screen.device.deleted",
      target: { type: "device", id },
    });
    expect(events(h, "screen.device.revoked", "alpha").at(-1)).toEqual({
      device_id: id,
      actor_user_id: "u_root",
    });
    expect(events(h, "screen.device.assigned", "alpha").at(-1)).toMatchObject({
      device_id: mirror,
    });
    const probe = await call(h, "GET", "/api/screen/device/_probe", {
      cookies: { canccu_device: token },
    });
    expect(code(probe)).toBe("device_unknown");
    expect((await h.pool.query("SELECT 1 FROM devices WHERE id = $1", [id])).rows).toEqual([]);
    expect(code(await call(h, "DELETE", `/api/screen/registry/devices/${id}`, root()))).toBe(
      "not_found",
    );
  });
});
