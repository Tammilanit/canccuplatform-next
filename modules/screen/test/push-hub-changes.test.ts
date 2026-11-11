/**
 * The hub's planned rebuild at a zone's next content change (PushHub.plan): a container whose last
 * stream on the zone has gone must not take the claim, or the container that still has a stream
 * loses it and the change waits for the 10 s refresh. A container that loses the claim keeps the
 * zone planned, and the tick's stored playback reaches every container's streams.
 */
import { tenantKey, withTenant } from "@canccu/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COALESCE_MS, FOLLOW_MS, PushHub } from "../src/push/hub.js";
import type { HubDeps } from "../src/push/hub.js";
import type { DeviceStream } from "../src/push/stream.js";
import { MemoryFanout } from "../src/push/store.js";

const T0 = Date.parse("2026-03-14T18:00:00Z");
const TENANT = "alpha";

const stream = (zoneKey: string) =>
  ({
    tenant: TENANT,
    zoneKey,
    mirror: false,
    req: { host: "alpha.test" },
  }) as unknown as DeviceStream;

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
    hub = new PushHub({
      kv,
      fanout: new MemoryFanout(),
      now: () => Date.now(),
    } as unknown as HubDeps);
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

/** Two containers on one Valkey: claims, the planned marker and the fan-out are shared. */
describe("a zone shown in two containers", () => {
  let values: Map<string, string>;
  let builds: string[];
  let failing: Set<string>;
  let hubs: Record<"a" | "b", PushHub>;

  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    values = new Map();
    builds = [];
    failing = new Set();
    const kv = {
      get: (key: string) => Promise.resolve(values.get(key) ?? null),
      set: (key: string, value: string) => {
        values.set(key, value);
        return Promise.resolve();
      },
      setIfAbsent: (key: string, value: string) => {
        if (values.has(key)) return Promise.resolve(false);
        values.set(key, value);
        return Promise.resolve(true);
      },
    };
    const fanout = new MemoryFanout();
    // A build reaches `contextOf` first; answering null ends it there, as a moved hostname does.
    const hub = (name: "a" | "b") =>
      new PushHub({
        kv,
        fanout,
        now: () => Date.now(),
        contextOf: () => {
          builds.push(name);
          return failing.has(name) ? Promise.reject(new Error("down")) : Promise.resolve(null);
        },
      } as unknown as HubDeps);
    hubs = { a: hub("a"), b: hub("b") };
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rebuilds the zone in every container that shows it when the tick stored its playback", async () => {
    hubs.a.add(stream("stage"));
    hubs.b.add(stream("stage"));
    hubs.b.add(stream("foyer"));
    // The tick ran in container a; the notice reaches b too, and only for the zone it named.
    hubs.a.played(TENANT, ["stage", "lobby"]);
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(builds.sort()).toEqual(["a", "b"]);
  });

  it("builds in the container that lost the claim when the winner's stream went", async () => {
    const winner = stream("stage");
    hubs.a.add(winner);
    hubs.b.add(stream("stage"));
    // a plans first, so it takes the claim; its stream goes before its build runs.
    hubs.a.plan(TENANT, "stage", T0 + 5_000);
    hubs.b.plan(TENANT, "stage", T0 + 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    hubs.a.remove(winner);
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(builds).toEqual([]);
    await vi.advanceTimersByTimeAsync(FOLLOW_MS);
    expect(builds).toEqual(["b"]);
  });

  it("plans the winner's next change in the container that lost the claim", async () => {
    const first = stream("stage");
    hubs.a.add(first);
    hubs.b.add(stream("stage"));
    hubs.a.plan(TENANT, "stage", T0 + 5_000);
    hubs.b.plan(TENANT, "stage", T0 + 5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    // As a's build would leave it: built after the change, the next one 20 s on.
    const planned = withTenant(TENANT, () => tenantKey("screen", "zone", "stage", "planned"));
    values.set(planned, JSON.stringify({ builtAt: T0 + 5_050, at: T0 + 25_000 }));
    await vi.advanceTimersByTimeAsync(FOLLOW_MS);
    expect(builds).toEqual(["a"]);
    // b planned 25 s; with a's stream gone, b alone takes that change.
    hubs.a.remove(first);
    await vi.advanceTimersByTimeAsync(19_000 + COALESCE_MS);
    expect(builds).toEqual(["a", "b"]);
  });

  it("tries a failed build again soon", async () => {
    failing.add("a");
    hubs.a.add(stream("stage"));
    hubs.a.played(TENANT, ["stage"]);
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(builds).toEqual(["a"]);
    failing.clear();
    await vi.advanceTimersByTimeAsync(FOLLOW_MS + COALESCE_MS);
    expect(builds).toEqual(["a", "a"]);
  });
});
