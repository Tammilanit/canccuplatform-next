import { withTenant } from "@canccu/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { takeCommands } from "../src/assignments.js";
import { DATABASE_URL, call, code, events, harness, pairDevice, setCookie } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Device {
  id: string;
  zone_key: string | null;
  mirror_of: { device_id: string } | { zone_key: string } | null;
}

describe.skipIf(!DATABASE_URL)("assignments", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    for (const key of ["foyer", "stage"]) {
      await call(h, "POST", "/api/screen/zones", {
        session: "admin",
        body: { key, name: key },
      });
    }
  });
  afterAll(async () => {
    await h.close();
  });

  const admin = (host = "alpha.test") => ({ host, session: "admin" });
  const assign = (id: string, body: unknown, host = "alpha.test") =>
    call(h, "PUT", `/api/screen/devices/${id}/assignment`, { ...admin(host), body });
  const listed = async (id: string, host = "alpha.test") =>
    (await call(h, "GET", "/api/screen/devices", admin(host)))
      .json<{ devices: Device[] }>()
      .devices.find((d) => d.id === id);
  const zone = async (key: string) =>
    (await call(h, "GET", `/api/screen/zones/${key}`, admin())).json<{
      revision: number;
      sound: { enabled: boolean; device_id: string | null };
    }>();

  it("pairs straight into a zone, and refuses a zone the event does not have", async () => {
    const start = await call(h, "POST", "/api/screen/pairing");
    const { code: shown } = start.json<{ code: string }>();
    const unknown = await call(h, "POST", "/api/screen/devices", {
      ...admin(),
      body: { code: shown, name: "Door", zone_key: "nowhere" },
    });
    expect([unknown.statusCode, code(unknown)]).toEqual([400, "unknown_zone"]);
    // Nothing was paired, so the same code still works.
    const paired = await call(h, "POST", "/api/screen/devices", {
      ...admin(),
      body: { code: shown, name: "Door", zone_key: "foyer" },
    });
    expect(paired.json()).toMatchObject({ name: "Door", zone_key: "foyer", mirror_of: null });
    const id = paired.json<{ id: string }>().id;
    expect(events(h, "screen.device.paired").at(-1)).toMatchObject({
      device_id: id,
      zone_key: "foyer",
    });
    expect(await listed(id)).toMatchObject({ zone_key: "foyer", mirror_of: null });
  });

  it("assigns, mirrors and unassigns a device (audited, with events)", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Bar");
    const { id: target } = await pairDevice(h, "alpha.test", "Bar main");

    const toZone = await assign(id, { zone_key: "stage" });
    expect(toZone.json()).toMatchObject({ id, name: "Bar", zone_key: "stage", mirror_of: null });
    expect(h.audits.at(-1)).toEqual({
      tenant_id: "alpha",
      actor_user_id: "u_admin",
      action: "screen.device.assigned",
      target: { type: "device", id },
      changes: { zone_key: { from: null, to: "stage" }, mirror_of: { from: null, to: null } },
    });
    expect(events(h, "screen.device.assigned").at(-1)).toEqual({
      device_id: id,
      zone_key: "stage",
      mirror_of: null,
      actor_user_id: "u_admin",
    });

    const mirror = await assign(id, { mirror_of: { device_id: target } });
    expect(mirror.json()).toMatchObject({ zone_key: null, mirror_of: { device_id: target } });
    expect(await listed(id)).toMatchObject({ zone_key: null, mirror_of: { device_id: target } });
    expect((await assign(id, { mirror_of: { zone_key: "foyer" } })).json()).toMatchObject({
      mirror_of: { zone_key: "foyer" },
    });
    expect(events(h, "screen.device.assigned").at(-1)).toMatchObject({
      zone_key: null,
      mirror_of: { zone_key: "foyer" },
    });

    const off = await call(h, "DELETE", `/api/screen/devices/${id}/assignment`, admin());
    expect(off.statusCode).toBe(204);
    expect(await listed(id)).toMatchObject({ zone_key: null, mirror_of: null });
    expect(events(h, "screen.device.assigned").at(-1)).toEqual({
      device_id: id,
      zone_key: null,
      mirror_of: null,
      actor_user_id: "u_admin",
    });
    expect(h.audits.at(-1)).toMatchObject({
      action: "screen.device.assigned",
      changes: { mirror_of: { from: { zone_key: "foyer" }, to: null } },
    });
  });

  it("refuses assignments the contract does not allow", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Rules");
    const { id: other } = await pairDevice(h, "alpha.test", "Rules target");
    const unknown = await assign(id, { zone_key: "nowhere" });
    expect([unknown.statusCode, code(unknown)]).toEqual([400, "unknown_zone"]);
    expect(code(await assign(id, { mirror_of: { zone_key: "nowhere" } }))).toBe("unknown_zone");
    for (const body of [
      {},
      [],
      { zone_key: "stage", mirror_of: { zone_key: "stage" } },
      { zone_key: "Stage!" },
      { mirror_of: {} },
      { mirror_of: { device_id: other, zone_key: "stage" } },
      { mirror_of: { device_id: id } },
      { mirror_of: { device_id: "dv_nobody" } },
    ]) {
      const res = await assign(id, body);
      expect([res.statusCode, code(res)], JSON.stringify(body)).toEqual([400, "invalid_request"]);
    }
    // No chains: a mirror shows a zone or a device that is not itself a mirror.
    expect((await assign(id, { mirror_of: { device_id: other } })).statusCode).toBe(200);
    const { id: third } = await pairDevice(h, "alpha.test", "Rules third");
    expect(code(await assign(third, { mirror_of: { device_id: id } }))).toBe("invalid_request");
    expect(code(await assign(other, { mirror_of: { zone_key: "stage" } }))).toBe("invalid_request");
    // Rights and archived events.
    const crew = await call(h, "PUT", `/api/screen/devices/${id}/assignment`, {
      session: "crew",
      body: { zone_key: "stage" },
    });
    expect(crew.statusCode).toBe(403);
    expect(
      (await call(h, "DELETE", `/api/screen/devices/${id}/assignment`, { session: "crew" }))
        .statusCode,
    ).toBe(403);
  });

  it("names only a device of the zone as its sound device, and clears it when the device leaves", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Speaker");
    const save = async (deviceId: string | null) => {
      const { revision } = await zone("stage");
      return call(h, "PUT", "/api/screen/zones/stage", {
        ...admin(),
        body: { key: "stage", name: "stage", sound: { device_id: deviceId }, revision },
      });
    };
    expect(code(await save(id))).toBe("invalid_request");
    await assign(id, { zone_key: "stage" });
    expect((await save(id)).json()).toMatchObject({ sound: { enabled: true, device_id: id } });
    const before = (await zone("stage")).revision;
    await assign(id, { zone_key: "foyer" });
    expect(await zone("stage")).toMatchObject({
      revision: before + 1,
      sound: { device_id: null },
    });
    expect(events(h, "screen.zone.saved").at(-1)).toEqual({
      zone_key: "stage",
      revision: before + 1,
      changed: ["sound"],
      actor_user_id: "u_admin",
    });
  });

  it("never saves a sound device that left the zone while the save waited (race)", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Racing speaker");
    await assign(id, { zone_key: "stage" });
    const { revision } = await zone("stage");
    // Holds the device as a reassignment does (FOR UPDATE), then moves it out of the zone.
    const mover = await h.pool.connect();
    try {
      await mover.query("BEGIN");
      await mover.query("SELECT 1 FROM devices WHERE id = $1 FOR UPDATE", [id]);
      const saving = call(h, "PUT", "/api/screen/zones/stage", {
        ...admin(),
        body: { key: "stage", name: "stage", sound: { device_id: id }, revision },
      });
      let settled = false;
      void saving.then(() => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await mover.query("UPDATE assignments SET zone_key = 'foyer' WHERE device_id = $1", [id]);
      await mover.query("COMMIT");
      expect(code(await saving)).toBe("invalid_request");
    } finally {
      mover.release();
    }
    expect(await zone("stage")).toMatchObject({ revision, sound: { device_id: null } });
  });

  it("refuses to mirror a screen that has no assignment row in this event", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Rowless");
    const { id: copy } = await pairDevice(h, "alpha.test", "Rowless copy");
    // What a device the superadmin moves here (#221) looks like before it is assigned.
    await h.pool.query("DELETE FROM assignments WHERE device_id = $1", [id]);
    const res = await assign(copy, { mirror_of: { device_id: id } });
    expect([res.statusCode, code(res)]).toEqual([400, "invalid_request"]);
  });

  it("leaves no dangling references when a device is revoked", async () => {
    const { id: main } = await pairDevice(h, "alpha.test", "Main hall");
    const { id: copy } = await pairDevice(h, "alpha.test", "Main hall copy");
    await assign(main, { zone_key: "stage" });
    await assign(copy, { mirror_of: { device_id: main } });
    const { revision } = await zone("stage");
    await call(h, "PUT", "/api/screen/zones/stage", {
      ...admin(),
      body: { key: "stage", name: "stage", sound: { device_id: main }, revision },
    });

    const res = await call(h, "POST", `/api/screen/devices/${main}/revoke`, admin());
    expect(res.statusCode).toBe(204);
    expect(await listed(copy)).toMatchObject({ zone_key: null, mirror_of: null });
    expect(events(h, "screen.device.assigned").at(-1)).toEqual({
      device_id: copy,
      zone_key: null,
      mirror_of: null,
      actor_user_id: "u_admin",
    });
    expect(h.audits.map((a) => [a.action, a.target.id])).toContainEqual([
      "screen.device.assigned",
      copy,
    ]);
    expect(await zone("stage")).toMatchObject({
      revision: revision + 2,
      sound: { device_id: null },
    });
    expect(events(h, "screen.zone.saved").at(-1)).toMatchObject({
      zone_key: "stage",
      changed: ["sound"],
    });
  });

  it("queues reload and identify for the push channel, for 60 seconds", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Commanded");
    const send = (body: unknown, session = "admin") =>
      call(h, "POST", `/api/screen/devices/${id}/commands`, { session, body });
    expect((await send({ command: "reload" })).statusCode).toBe(202);
    expect((await send({ command: "identify" })).statusCode).toBe(202);
    expect(code(await send({ command: "reboot" }))).toBe("invalid_request");
    expect((await send({ command: "reload" }, "crew")).statusCode).toBe(403);

    const queued = await withTenant("alpha", () => takeCommands(h.kv, id, h.clock.now));
    expect(queued.map((c) => c.command).sort()).toEqual(["identify", "reload"]);
    expect(queued[0]?.expires_at).toBe(new Date(h.clock.now + 60_000).toISOString());
    // Taken once: the stream delivers each command a single time.
    expect(await withTenant("alpha", () => takeCommands(h.kv, id, h.clock.now))).toEqual([]);

    await send({ command: "reload" });
    h.clock.now += 61_000;
    expect(await withTenant("alpha", () => takeCommands(h.kv, id, h.clock.now))).toEqual([]);
  });

  it("leaves a parked device (no current event) to no event's routes", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Parked");
    const { id: other } = await pairDevice(h, "alpha.test", "Still here");
    // What the superadmin's move to `null` (#221) leaves on the global row.
    await h.pool.query("UPDATE devices SET current_tenant_id = NULL WHERE id = $1", [id]);
    for (const host of ["alpha.test", "beta.test"]) {
      expect(await listed(id, host)).toBeUndefined();
      for (const [method, path, body] of [
        ["PUT", `/api/screen/devices/${id}/assignment`, { zone_key: "stage" }],
        ["DELETE", `/api/screen/devices/${id}/assignment`, undefined],
        ["POST", `/api/screen/devices/${id}/commands`, { command: "reload" }],
      ] as const) {
        const res = await call(h, method, path, { ...admin(host), ...(body ? { body } : {}) });
        expect([res.statusCode, code(res)], `${host} ${method} ${path}`).toEqual([
          404,
          "not_found",
        ]);
      }
    }
    expect(code(await assign(other, { mirror_of: { device_id: id } }))).toBe("invalid_request");
  });

  it("keeps assignments and commands inside their own event (cross-event leak tests)", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Alpha only");
    await assign(id, { zone_key: "stage" });
    const beta = admin("beta.test");
    await call(h, "POST", "/api/screen/zones", { ...beta, body: { key: "stage", name: "Beta" } });

    for (const [method, path, body] of [
      ["PUT", `/api/screen/devices/${id}/assignment`, { zone_key: "stage" }],
      ["DELETE", `/api/screen/devices/${id}/assignment`, undefined],
      ["POST", `/api/screen/devices/${id}/commands`, { command: "identify" }],
    ] as const) {
      const res = await call(h, method, path, { ...beta, ...(body ? { body } : {}) });
      expect([res.statusCode, code(res)], `${method} ${path}`).toEqual([404, "not_found"]);
    }
    expect(await withTenant("beta", () => takeCommands(h.kv, id, h.clock.now))).toEqual([]);
    expect(await withTenant("alpha", () => takeCommands(h.kv, id, h.clock.now))).toEqual([]);
    expect(await listed(id)).toMatchObject({ zone_key: "stage" });

    // Beta cannot mirror alpha's device, nor pair into a zone only alpha has.
    const { id: betaDevice } = await pairDevice(h, "beta.test", "Beta screen");
    const res = await assign(betaDevice, { mirror_of: { device_id: id } }, "beta.test");
    expect(code(res)).toBe("invalid_request");
    expect(code(await assign(betaDevice, { zone_key: "foyer" }, "beta.test"))).toBe("unknown_zone");
    const start = await call(h, "POST", "/api/screen/pairing", { host: "beta.test" });
    expect(setCookie(start, "canccu_pairing")).toBeTruthy();
    const claim = await call(h, "POST", "/api/screen/devices", {
      ...beta,
      body: { code: start.json<{ code: string }>().code, name: "x", zone_key: "foyer" },
    });
    expect(code(claim)).toBe("unknown_zone");

    // Beta's zone of the same key is beta's own: alpha's device is not in it.
    const betaStage = await call(h, "DELETE", "/api/screen/zones/stage", beta);
    expect(betaStage.statusCode).toBe(204);
  });
});
