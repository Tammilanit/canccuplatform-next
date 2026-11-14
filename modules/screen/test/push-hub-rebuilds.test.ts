/**
 * Which events rebuild which zones in the hub: a pairing straight into a zone recounts every zone's
 * screens (`show_name`), a change of the event's screen settings composes every zone again, and a
 * count rebuilds only the zones whose widgets read it.
 */
import type { Event } from "@canccu/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryKv } from "../src/kv.js";
import { COALESCE_MS, PushHub } from "../src/push/hub.js";
import type { HubDeps } from "../src/push/hub.js";
import type { DeviceStream } from "../src/push/stream.js";
import { MemoryFanout } from "../src/push/store.js";
import type { ZoneRecord } from "../src/push/store.js";

const T0 = Date.parse("2026-03-14T18:00:00Z");
const TENANT = "alpha";

// The stream's host names its zone, so a build (which asks for the host's context first) says
// which zone it was for.
const stream = (zoneKey: string) =>
  ({ tenant: TENANT, zoneKey, mirror: false, req: { host: zoneKey } }) as unknown as DeviceStream;

const event = (source: string, type: string, data: Record<string, unknown>): Event =>
  ({ id: "e1", source, type, tenant: TENANT, data, version: 1 }) as unknown as Event;

describe("the hub's rebuilds", () => {
  let builds: string[];
  let records: Record<string, Partial<ZoneRecord>>;
  let hub: PushHub;

  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    builds = [];
    records = {};
    hub = new PushHub({
      kv: new MemoryKv(() => Date.now()),
      fanout: new MemoryFanout(),
      zones: { read: (zone: string) => Promise.resolve(records[zone] ?? null) },
      now: () => Date.now(),
      tenantChanged: () => undefined,
      contextOf: (host: string) => {
        builds.push(host);
        return Promise.resolve(null);
      },
    } as unknown as HubDeps);
    for (const zone of ["stage", "foyer", "lobby"]) hub.add(stream(zone));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const built = async () => {
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    return builds.sort();
  };

  it("recounts every zone when a device is paired straight into a zone", async () => {
    hub.handleEvent(event("screen", "screen.device.paired", { device_id: "dv_9", zone_key: null }));
    expect(await built()).toEqual([]);
    hub.handleEvent(
      event("screen", "screen.device.paired", { device_id: "dv_9", zone_key: "stage" }),
    );
    expect(await built()).toEqual(["foyer", "lobby", "stage"]);
  });

  it("composes every zone again once the event's screen settings changed", async () => {
    hub.settingsChanged(TENANT);
    expect(await built()).toEqual(["foyer", "lobby", "stage"]);
  });

  it("rebuilds on a count only the zones whose widgets read it", async () => {
    // Lobby's record was stored before records named their counts: it reads every one.
    records = { stage: { counts: ["presence", "checkins"] }, foyer: { counts: ["presence"] } };
    records.lobby = {};
    hub.handleEvent(event("notify", "notify.checkin.recorded", { purpose: "arrival" }));
    expect(await built()).toEqual(["lobby", "stage"]);
    builds = [];
    records.foyer = { counts: [] };
    hub.handleEvent(
      event("bot", "bot.presence.counted", {
        counted_at: new Date(T0).toISOString(),
        interval_seconds: 60,
        members: 400,
        online: 212,
        idle: 0,
        dnd: 0,
        in_voice: 36,
      }),
    );
    expect(await built()).toEqual(["lobby", "stage"]);
  });
});
