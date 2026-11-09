import { withTenant } from "@canccu/kit";
import { assertTenantIsolation } from "@canccu/kit/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedMainZone } from "../src/zones.js";
import { DATABASE_URL, call, code, events, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Zone {
  key: string;
  name: string;
  layout_id: string | null;
  regions: Record<string, Record<string, unknown>>;
  sound: { enabled: boolean; device_id: string | null };
  revision: number;
}

describe.skipIf(!DATABASE_URL)("zones", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  const admin = (host = "alpha.test") => ({ host, session: "admin" });
  const zones = async (host = "alpha.test") =>
    (await call(h, "GET", "/api/screen/zones", admin(host))).json<{ zones: Zone[] }>().zones;
  const epoch = async (tenant: string, key: string) =>
    (
      await h.pool.query<{ epoch: string }>(
        "SELECT epoch FROM screen_zones WHERE tenant_id = $1 AND key = $2",
        [tenant, key],
      )
    ).rows[0]?.epoch;

  it("starts an event with one zone, main, once: a deleted main stays deleted", async () => {
    expect(await zones()).toEqual([
      {
        key: "main",
        name: "Main",
        layout_id: null,
        regions: { hero: { idle: "next" } },
        sound: { enabled: true, device_id: null },
        revision: 1,
      },
    ]);
    expect(events(h, "screen.zone.saved")).toContainEqual(
      expect.objectContaining({ zone_key: "main", revision: 1, actor_user_id: null }),
    );
    expect((await call(h, "DELETE", "/api/screen/zones/main", admin())).statusCode).toBe(204);
    expect(await zones()).toEqual([]);
    expect(events(h, "screen.zone.removed").at(-1)).toEqual({
      zone_key: "main",
      actor_user_id: "u_admin",
    });
  });

  it("seeds main when tenants.tenant.created arrives, and only once", async () => {
    const seed = seedMainZone(h.db, h.bus);
    await withTenant("beta", () => seed());
    await withTenant("beta", () => seed());
    expect((await zones("beta.test")).map((z) => z.key)).toEqual(["main"]);
    expect(events(h, "screen.zone.saved", "beta")).toHaveLength(1);
  });

  it("adds, reads, replaces with the revision read, and removes a zone", async () => {
    const zone = {
      key: "cafe",
      name: "Café",
      layout_id: "pulse_portrait",
      regions: { hero: { widgets: [{ widget: "checkin_qr" }], dwell_seconds: 20 } },
    };
    const added = await call(h, "POST", "/api/screen/zones", { ...admin(), body: zone });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toEqual({
      ...zone,
      sound: { enabled: true, device_id: null },
      revision: 1,
    });
    const again = await call(h, "POST", "/api/screen/zones", { ...admin(), body: zone });
    expect([again.statusCode, code(again)]).toEqual([409, "zone_exists"]);
    const loud = await call(h, "POST", "/api/screen/zones", {
      ...admin(),
      body: { ...zone, sound: { device_id: "dv_any" } },
    });
    expect([loud.statusCode, code(loud)]).toEqual([409, "zone_exists"]);
    expect((await call(h, "GET", "/api/screen/zones/cafe", admin())).json()).toMatchObject({
      key: "cafe",
      revision: 1,
    });

    const saved = await call(h, "PUT", "/api/screen/zones/cafe", {
      ...admin(),
      body: { ...zone, name: "Café corner", revision: 1 },
    });
    expect(saved.json()).toMatchObject({ name: "Café corner", revision: 2 });
    expect(events(h, "screen.zone.saved").at(-1)).toEqual({
      zone_key: "cafe",
      revision: 2,
      changed: ["name"],
      actor_user_id: "u_admin",
    });
    // An unchanged save keeps the revision and emits nothing.
    const savedEvents = events(h, "screen.zone.saved").length;
    const same = await call(h, "PUT", "/api/screen/zones/cafe", {
      ...admin(),
      body: { ...zone, name: "Café corner", revision: 2 },
    });
    expect(same.json()).toMatchObject({ name: "Café corner", revision: 2 });
    expect(events(h, "screen.zone.saved")).toHaveLength(savedEvents);
    const stale = await call(h, "PUT", "/api/screen/zones/cafe", {
      ...admin(),
      body: { ...zone, name: "Lost update", revision: 1 },
    });
    expect([stale.statusCode, code(stale)]).toEqual([409, "version_conflict"]);
    for (const body of [
      { ...zone },
      { ...zone, key: "other", revision: 2 },
      { ...zone, revision: "2" },
    ]) {
      expect(code(await call(h, "PUT", "/api/screen/zones/cafe", { ...admin(), body }))).toBe(
        "invalid_request",
      );
    }
    const missing = await call(h, "PUT", "/api/screen/zones/nowhere", {
      ...admin(),
      body: { ...zone, key: "nowhere", revision: 1 },
    });
    expect([missing.statusCode, code(missing)]).toEqual([404, "not_found"]);

    expect((await call(h, "DELETE", "/api/screen/zones/cafe", admin())).statusCode).toBe(204);
    expect((await call(h, "GET", "/api/screen/zones/cafe", admin())).statusCode).toBe(404);
    expect((await call(h, "DELETE", "/api/screen/zones/cafe", admin())).statusCode).toBe(404);
  });

  it("gives a zone made again under the same key a new epoch", async () => {
    const body = { key: "stage", name: "Stage" };
    await call(h, "POST", "/api/screen/zones", { ...admin(), body });
    const first = await epoch("alpha", "stage");
    await call(h, "DELETE", "/api/screen/zones/stage", admin());
    await call(h, "POST", "/api/screen/zones", { ...admin(), body });
    const second = await epoch("alpha", "stage");
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it("refuses zones that break the contract's shape", async () => {
    const bad: unknown[] = [
      [],
      { key: "A", name: "x" },
      { key: "a", name: "x" },
      { key: "-ab", name: "x" },
      { key: "a".repeat(33), name: "x" },
      { key: "ok", name: "" },
      { key: "ok", name: "x".repeat(81) },
      { key: "ok", name: "x", layout_id: 7 },
      { key: "ok", name: "x", layout_id: "Pulse!" },
      { key: "ok", name: "x", regions: [] },
      { key: "ok", name: "x", regions: { _full: {} } },
      { key: "ok", name: "x", regions: { hero: { role: "sidebar" } } },
      { key: "ok", name: "x", regions: { hero: { rotation: "random" } } },
      { key: "ok", name: "x", regions: { hero: { dwell_seconds: 4 } } },
      { key: "ok", name: "x", regions: { hero: { dwell_seconds: 1.5 } } },
      { key: "ok", name: "x", regions: { hero: { skip_empty: "yes" } } },
      { key: "ok", name: "x", regions: { hero: { idle: "dark" } } },
      { key: "ok", name: "x", regions: { hero: { colour: "red" } } },
      { key: "ok", name: "x", regions: { hero: { widgets: Array(13).fill({ widget: "clock" }) } } },
      { key: "ok", name: "x", regions: { hero: { widgets: [{ widget: "Clock" }] } } },
      {
        key: "ok",
        name: "x",
        regions: { hero: { widgets: [{ widget: "clock", props: { a: {} } }] } },
      },
      { key: "ok", name: "x", sound: { enabled: "no" } },
      { key: "ok", name: "x", sound: { device_id: "dv_nobody" } },
    ];
    for (const body of bad) {
      const res = await call(h, "POST", "/api/screen/zones", { ...admin(), body });
      expect([res.statusCode, code(res)], JSON.stringify(body)).toEqual([400, "invalid_request"]);
    }
    expect((await zones()).map((z) => z.key)).not.toContain("ok");
  });

  it("reads with screen.devices.read or screen.content.read, writes with screen.zones.write", async () => {
    for (const session of ["crew", "content"]) {
      expect((await call(h, "GET", "/api/screen/zones", { session })).statusCode).toBe(200);
    }
    expect((await call(h, "GET", "/api/screen/zones", { session: "nobody" })).statusCode).toBe(403);
    expect((await call(h, "GET", "/api/screen/zones")).statusCode).toBe(401);
    const res = await call(h, "POST", "/api/screen/zones", {
      session: "crew",
      body: { key: "crew", name: "Crew" },
    });
    expect([res.statusCode, code(res)]).toEqual([403, "missing_right"]);
    const archived = await call(h, "POST", "/api/screen/zones", {
      host: "gamma.test",
      session: "admin",
      body: { key: "late", name: "Late" },
    });
    expect([archived.statusCode, code(archived)]).toEqual([409, "event_archived"]);
  });

  it("keeps a zone while a device is assigned to it or mirrors it (zone_in_use)", async () => {
    await call(h, "POST", "/api/screen/zones", { ...admin(), body: { key: "hall", name: "Hall" } });
    const { id } = await pairDevice(h, "alpha.test", "Hall screen");
    const assign = (body: unknown) =>
      call(h, "PUT", `/api/screen/devices/${id}/assignment`, { ...admin(), body });
    for (const body of [{ zone_key: "hall" }, { mirror_of: { zone_key: "hall" } }]) {
      expect((await assign(body)).statusCode).toBe(200);
      const res = await call(h, "DELETE", "/api/screen/zones/hall", admin());
      expect([res.statusCode, code(res)]).toEqual([409, "zone_in_use"]);
    }
    await call(h, "DELETE", `/api/screen/devices/${id}/assignment`, admin());
    expect((await call(h, "DELETE", "/api/screen/zones/hall", admin())).statusCode).toBe(204);
  });

  it("keeps every zone path inside its own event (cross-event leak tests)", async () => {
    await assertTenantIsolation(
      {
        seed: async (tenant, marker) => {
          const res = await call(h, "POST", "/api/screen/zones", {
            ...admin(`${tenant}.test`),
            body: { key: "shared", name: marker },
          });
          expect(res.statusCode).toBe(201);
        },
        read: async (tenant) => ({
          list: await zones(`${tenant}.test`),
          one: (
            await call(h, "GET", "/api/screen/zones/shared", admin(`${tenant}.test`))
          ).json<Zone>(),
        }),
      },
      ["alpha", "beta"],
    );

    await call(h, "POST", "/api/screen/zones", {
      ...admin(),
      body: { key: "alpha-only", name: "Alpha only" },
    });
    for (const [method, body] of [
      ["GET", undefined],
      ["PUT", { key: "alpha-only", name: "Taken", revision: 1 }],
      ["DELETE", undefined],
    ] as const) {
      const res = await call(h, method, "/api/screen/zones/alpha-only", {
        ...admin("beta.test"),
        ...(body ? { body } : {}),
      });
      expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
    }
    expect(await zones()).toContainEqual(
      expect.objectContaining({ key: "alpha-only", name: "Alpha only" }),
    );

    // A sound device must be one of this event's devices: another event's id is unknown here.
    const { id } = await pairDevice(h, "alpha.test", "Alpha speaker");
    const res = await call(h, "POST", "/api/screen/zones", {
      ...admin("beta.test"),
      body: { key: "loud", name: "Loud", sound: { device_id: id } },
    });
    expect(code(res)).toBe("invalid_request");

    // RLS: beta's transactions see none of alpha's zone rows or its seed marker.
    const seen = await withTenant("beta", () =>
      h.db.tenant(async (c) => ({
        zones: (await c.query("SELECT tenant_id FROM screen_zones")).rows.map((r) => r.tenant_id),
        seeds: (await c.query("SELECT tenant_id FROM screen_zone_seeds")).rows.map(
          (r) => r.tenant_id,
        ),
      })),
    );
    expect(new Set([...seen.zones, ...seen.seeds])).toEqual(new Set(["beta"]));
  });
});
