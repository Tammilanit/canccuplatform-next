/**
 * The zone store and fan-out, in memory and, with `CANCCU_VALKEY_URL`, on a real Valkey (the
 * Lua step that advances a version, logs and publishes at once).
 */
import { Valkey } from "iovalkey";
import { afterAll, describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import {
  MemoryFanout,
  MemoryZoneStore,
  ValkeyFanout,
  ValkeyZoneStore,
  keys,
} from "../src/push/store.js";
import type { Entry, Fanout, ZoneRecord, ZoneStore } from "../src/push/store.js";

const VALKEY_URL = process.env.CANCCU_VALKEY_URL;
/** Its own database: the render-queue tests empty 15. Pub/sub spans databases; channels carry the tenant. */
const TEST_DB = 14;

const record = (version: number): ZoneRecord => ({
  version,
  fingerprint: `f${version}`,
  zone: { key: "main", name: "Main", epoch: "e1" },
  eventName: "Demo Event",
  theme: {},
  ticker: {},
  sound: { enabled: false, device_id: null },
  views: {
    landscape: { layout: null, regions: [] },
    portrait: { layout: null, regions: [] },
  },
});
const entry = (version: number): Entry => ({
  version,
  epoch: "e1",
  messages: { landscape: [], portrait: null },
});

const clients: Valkey[] = [];
afterAll(async () => {
  await Promise.all(clients.map((c) => c.quit()));
});

const kinds: [string, () => Promise<{ store: ZoneStore; fanout: Fanout }> | null][] = [
  [
    "memory",
    () => {
      const fanout = new MemoryFanout();
      return Promise.resolve({ store: new MemoryZoneStore(fanout), fanout });
    },
  ],
  [
    "valkey",
    () => {
      if (!VALKEY_URL) return null;
      const client = new Valkey(VALKEY_URL, { db: TEST_DB });
      const subscriber = new Valkey(VALKEY_URL, { db: TEST_DB });
      clients.push(client, subscriber);
      return client.flushdb().then(() => ({
        store: new ValkeyZoneStore(client),
        fanout: new ValkeyFanout(subscriber, client),
      }));
    },
  ],
];

for (const [kind, make] of kinds) {
  describe.skipIf(kind === "valkey" && !VALKEY_URL)(`the ${kind} zone store`, () => {
    // A tenant per kind, so the two never share a channel.
    const tenant = `store${kind}`;
    it("advances one version at a time, logs and publishes each change", async () => {
      const { store, fanout } = (await make()) as { store: ZoneStore; fanout: Fanout };
      await withTenant(tenant, async () => {
        const heard: Entry[] = [];
        const stop = fanout.subscribe(keys.zoneChannel("main"), (m) => {
          heard.push(JSON.parse(m) as Entry);
        });
        // Subscribing is asynchronous on Valkey; a ping round trip on the same connection settles it.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(await store.version("main")).toBe(0);
        expect(await store.read("main")).toBeNull();
        expect(await store.advance("main", 0, record(1), entry(1))).toBe(true);
        // A second container that built from version 0 loses: it reads the winner instead.
        expect(await store.advance("main", 0, record(1), entry(1))).toBe(false);
        expect(await store.advance("main", 1, record(2), entry(2))).toBe(true);
        expect(await store.version("main")).toBe(2);
        expect((await store.read("main"))?.fingerprint).toBe("f2");
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(heard.map((e) => e.version)).toEqual([1, 2]);
        stop();
      });
    });

    it("resumes from the log only when it holds every change since", async () => {
      const { store } = (await make()) as { store: ZoneStore; fanout: Fanout };
      await withTenant(tenant, async () => {
        const zone = "resume";
        expect(await store.since(zone, 0)).toEqual([]);
        for (let v = 1; v <= 3; v++) await store.advance(zone, v - 1, record(v), entry(v));
        expect((await store.since(zone, 1))?.map((e) => e.version)).toEqual([2, 3]);
        expect(await store.since(zone, 3)).toEqual([]);
        // Ahead of the zone (another zone's ids, or a reset count): not resumable.
        expect(await store.since(zone, 9)).toBeNull();
      });
    });
  });
}

describe("the memory zone store's log", () => {
  it("forgets changes older than five minutes, so an older resume gets a state", async () => {
    const clock = { now: 0 };
    const store = new MemoryZoneStore(new MemoryFanout(), () => clock.now);
    await withTenant("alpha", async () => {
      await store.advance("main", 0, record(1), entry(1));
      clock.now = 4 * 60_000;
      await store.advance("main", 1, record(2), entry(2));
      clock.now = 5 * 60_000 + 1;
      expect(await store.since("main", 0)).toBeNull();
      expect((await store.since("main", 1))?.map((e) => e.version)).toEqual([2]);
    });
  });
});
