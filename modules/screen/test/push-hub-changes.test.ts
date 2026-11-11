/**
 * The hub's planned rebuild at a zone's next content change (PushHub.plan): a container whose last
 * stream on the zone has gone must not take the claim, or the container that still has a stream
 * loses it and the change waits for the 10 s refresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushHub } from "../src/push/hub.js";
import type { HubDeps } from "../src/push/hub.js";
import type { DeviceStream } from "../src/push/stream.js";

const T0 = Date.parse("2026-03-14T18:00:00Z");
const TENANT = "alpha";

const stream = (zoneKey: string) =>
  ({ tenant: TENANT, zoneKey, mirror: false }) as unknown as DeviceStream;

describe("a planned content change", () => {
  let claims: string[];
  let hub: PushHub;

  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    claims = [];
    const kv = {
      setIfAbsent: (key: string) => {
        claims.push(key);
        return Promise.resolve(true);
      },
    };
    hub = new PushHub({ kv, now: () => Date.now() } as unknown as HubDeps);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is claimed while a stream here still shows the zone", async () => {
    hub.add(stream("stage"));
    hub.plan(TENANT, "stage", T0 + 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(claims.some((k) => k.includes("change"))).toBe(true);
  });

  it("is dropped when the zone's last stream here goes, so it takes no claim", async () => {
    const a = stream("stage");
    const b = stream("stage");
    hub.add(a);
    hub.add(b);
    hub.plan(TENANT, "stage", T0 + 5_000);
    hub.remove(a);
    hub.remove(b);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(claims).toEqual([]);
  });

  it("takes no claim when the zone's stream moved to another zone before it fired", async () => {
    const a = stream("stage");
    hub.add(a);
    hub.plan(TENANT, "stage", T0 + 5_000);
    a.zoneKey = "foyer";
    await vi.advanceTimersByTimeAsync(5_000);
    expect(claims.filter((k) => k.includes("stage"))).toEqual([]);
  });
});
