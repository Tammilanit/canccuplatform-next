/**
 * What reaches an open stream without a zone change: the event's own changes (heard on its
 * tenant stream, with the cached context forgotten by the hub itself), a rename, a lost race
 * between two builders, and the offline event of a device seen only through its stream.
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { noSources } from "../src/compose/sources.js";
import { refreshZone } from "../src/push/device-state.js";
import { MemoryFanout, MemoryZoneStore } from "../src/push/store.js";
import type { Entry, ZoneRecord } from "../src/push/store.js";
import { DATABASE_URL, TENANTS, call, context, events, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { pushClient } from "./sse.js";

const tenantsEvent = (type: string): Event => ({
  id: `ev_${type}`,
  type,
  version: 1,
  time: new Date().toISOString(),
  source: "tenants",
  tenant: "alpha",
  data: { tenant_id: "alpha" },
});

describe.skipIf(!DATABASE_URL)("an open stream between zone changes", () => {
  let h: Harness;
  let client: ReturnType<typeof pushClient>;

  beforeAll(async () => {
    h = await harness();
    await h.app.listen({ host: "127.0.0.1", port: 0 });
    client = pushClient(h, (h.app.server.address() as AddressInfo).port);
    h.sources.event = { name: "Demo Event" };
  });
  afterAll(async () => {
    await h.close();
  });

  it("redraws at once when the event is archived, with no cache cleared by hand", async () => {
    const { token } = await client.screen();
    const sse = client.open(token);
    expect((await sse.next("state")).data.tenant).toMatchObject({ status: "live" });
    const before = TENANTS["alpha.test"];
    TENANTS["alpha.test"] = context("alpha", { status: "archived" });
    try {
      h.app.pushHub.handleEvent(tenantsEvent("tenants.status.changed"));
      const redrawn = await sse.next("state", 1000);
      expect(redrawn.data.tenant).toMatchObject({ status: "archived" });
    } finally {
      TENANTS["alpha.test"] = before as (typeof TENANTS)[string];
      h.app.pushHub.handleEvent(tenantsEvent("tenants.status.changed"));
      sse.close();
    }
  });

  it("sends a new state at the next ping after the device is renamed", async () => {
    const { id, token } = await client.screen();
    const sse = client.open(token);
    expect((await sse.next("state")).data.device).toMatchObject({ name: "Hall left" });
    const res = await call(h, "PATCH", `/api/screen/devices/${id}`, {
      session: "admin",
      body: { name: "Hall right" },
    });
    expect(res.statusCode).toBe(200);
    expect((await sse.next("state")).data.device).toMatchObject({ name: "Hall right" });
    sse.close();
  });

  it("builds again when another builder stored older inputs first", async () => {
    await client.screen();
    const fanout = new MemoryFanout();
    const inner = new MemoryZoneStore(fanout);
    let raced = false;
    // The other builder read the same version, composed from older inputs and finished first.
    const zones = Object.assign(Object.create(inner) as MemoryZoneStore, {
      advance: async (zone: string, expected: number, record: ZoneRecord, entry: Entry) => {
        if (raced) return inner.advance(zone, expected, record, entry);
        raced = true;
        await inner.advance(zone, expected, { ...record, fingerprint: "older" }, entry);
        return false;
      },
    });
    const deps = {
      db: h.db,
      kv: h.kv,
      sources: noSources,
      settings: { ensure: () => Promise.resolve(), get: (_k: string, f: unknown) => f },
      bundleVersion: "test",
      zones,
    } as Parameters<typeof refreshZone>[0];
    const record = await withTenant("alpha", () =>
      refreshZone(deps, context("alpha"), "alpha.test", "main"),
    );
    expect(record?.version).toBe(2);
    expect(record?.fingerprint).not.toBe("older");
    expect((await withTenant("alpha", () => inner.read("main")))?.fingerprint).toBe(
      record?.fingerprint,
    );
  });

  it("reports a device seen only through its stream offline with that time", async () => {
    const { id, token } = await client.screen();
    const sse = client.open(token);
    await sse.next("state");
    const seenAt = new Date(h.clock.now).toISOString();
    sse.close();
    await sse.ended;
    h.clock.now += 60_000;
    await h.sweep();
    expect(events(h, "screen.device.offline").find((e) => e.device_id === id)).toMatchObject({
      last_seen_at: seenAt,
    });
  });
});
