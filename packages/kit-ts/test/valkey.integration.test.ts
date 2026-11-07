/**
 * Integration test of ValkeyStreamStore and Bus against a real Valkey.
 * Runs only when CANCCU_VALKEY_URL is set; see README, Integration test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validate as isUuid, version as uuidVersion } from "uuid";
import { Valkey } from "iovalkey";
import {
  Bus,
  STREAM_MAXLEN,
  ValkeyStreamStore,
  currentTenant,
  newId,
  streamName,
  tenantStream,
  withTenant,
} from "../src/index.js";
import type { Event } from "../src/index.js";

const url = process.env.CANCCU_VALKEY_URL;
const TIME_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

/** A module name no other run uses, so reruns and the kit-py test never share a stream. */
function uniqueModule(): string {
  return `it${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error(`condition not met within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe.skipIf(!url)("ValkeyStreamStore against a real Valkey", () => {
  let raw: Valkey;
  let store: ValkeyStreamStore;
  const streams: string[] = [];

  beforeAll(() => {
    raw = new Valkey(url ?? "");
    store = ValkeyStreamStore.fromUrl(url ?? "");
  });

  afterAll(async () => {
    if (streams.length > 0) await raw.del(...streams);
    await store.close();
    await raw.quit();
  });

  function track(module: string): string {
    const name = streamName(module);
    streams.push(name);
    return name;
  }

  it("answers ping", async () => {
    await expect(store.ping()).resolves.toBeUndefined();
  });

  it("publish writes one entry with the single field `event` holding a valid envelope", async () => {
    const module = uniqueModule();
    const stream = track(module);
    const sent = await new Bus(store, module).publish(
      `${module}.thing.happened`,
      { n: 1 },
      { version: 1, platform: true },
    );

    const entries = (await raw.xrange(stream, "-", "+")) as [string, string[]][];
    expect(entries).toHaveLength(1);
    const fields = entries[0]?.[1] ?? [];
    expect(fields).toHaveLength(2);
    expect(fields[0]).toBe("event");
    const body = JSON.parse(fields[1] ?? "") as Record<string, unknown>;
    expect(body).toMatchObject({
      id: sent.id,
      type: `${module}.thing.happened`,
      version: 1,
      source: module,
      data: { n: 1 },
    });
    expect(isUuid(body.id) && uuidVersion(body.id as string)).toBe(7);
    expect(body.time).toMatch(TIME_RE);
  });

  it("xadd with an exact MAXLEN trims the stream to that length", async () => {
    const stream = track(uniqueModule());
    for (let i = 0; i < 12; i += 1) {
      await store.xadd(stream, { event: `e${i}` }, { maxlen: 5, approximate: false });
    }
    expect(await raw.xlen(stream)).toBe(5);
    const entries = (await raw.xrange(stream, "-", "+")) as [string, string[]][];
    expect(entries.map(([, f]) => f[1])).toEqual(["e7", "e8", "e9", "e10", "e11"]);
  });

  it("xadd with an approximate MAXLEN (MAXLEN ~) trims, never below the length", async () => {
    const stream = track(uniqueModule());
    for (let i = 0; i < 300; i += 1) {
      await store.xadd(stream, { event: `e${i}` }, { maxlen: 10, approximate: true });
    }
    const len = await raw.xlen(stream);
    // `~` only drops whole stream nodes (100 entries by default) and never goes below MAXLEN,
    // so it ends above 10 here, where an exact MAXLEN would give exactly 10.
    expect(len).toBeGreaterThan(10);
    expect(len).toBeLessThanOrEqual(110);
  });

  it("publish keeps the stream near STREAM_MAXLEN", async () => {
    const module = uniqueModule();
    const stream = track(module);
    const bus = new Bus(store, module);
    const pipeline = raw.pipeline();
    for (let i = 0; i < STREAM_MAXLEN + 500; i += 1) pipeline.xadd(stream, "*", "event", "{}");
    await pipeline.exec();
    await bus.publish(`${module}.thing.happened`, {}, { version: 1, platform: true });
    const len = await raw.xlen(stream);
    expect(len).toBeGreaterThanOrEqual(STREAM_MAXLEN);
    expect(len).toBeLessThan(STREAM_MAXLEN + 500);
  });

  it("subscribe delivers another module's event, and an entry added twice only once", async () => {
    const source = uniqueModule();
    const stream = track(source);
    const received: Event[] = [];
    const reader = ValkeyStreamStore.fromUrl(url ?? "");
    const subscription = new Bus(reader, uniqueModule()).subscribe(
      [source],
      (event) => {
        received.push(event);
      },
      { fromId: "0", blockMs: 200 },
    );
    try {
      const published = await new Bus(store, source).publish(
        `${source}.thing.happened`,
        { n: 1 },
        { version: 1, platform: true },
      );
      await waitFor(() => received.length === 1);
      expect(received[0]).toMatchObject({ id: published.id, data: { n: 1 } });

      // At-least-once delivery: the same envelope written again must reach the handler once.
      const duplicate = { event: JSON.stringify(published) };
      await store.xadd(stream, duplicate, { maxlen: 100, approximate: false });
      const next = {
        id: newId(),
        type: `${source}.thing.happened`,
        version: 1,
        time: new Date().toISOString(),
        source,
        data: { n: 2 },
      };
      await store.xadd(
        stream,
        { event: JSON.stringify(next) },
        { maxlen: 100, approximate: false },
      );
      await waitFor(() => received.length >= 2);
      await new Promise((r) => setTimeout(r, 300));
      expect(received.map((e) => e.data.n)).toEqual([1, 2]);
    } finally {
      await subscription.close();
      await reader.close();
    }
  });

  it("finds tenant streams with scan and reads each tenant in its own context", async () => {
    const source = uniqueModule();
    const tenants = ["it-a", "it-b"];
    streams.push(...tenants.map((t) => tenantStream(source, t)), streamName("tenants"));
    const bus = new Bus(store, source);
    await withTenant("it-a", () =>
      bus.publish(`${source}.thing.happened`, { n: 1 }, { version: 1 }),
    );
    expect(await store.scan(`t:*:events:${source}`)).toEqual([tenantStream(source, "it-a")]);

    const received: [string | undefined, Event][] = [];
    const reader = ValkeyStreamStore.fromUrl(url ?? "");
    const subscription = new Bus(reader, uniqueModule()).subscribeTenants(
      [source],
      (event) => {
        received.push([currentTenant(), event]);
      },
      { fromId: "0", blockMs: 200 },
    );
    try {
      await waitFor(() => received.length === 1);
      // A tenant announced after start is read from the start of its stream.
      await withTenant("it-b", () =>
        bus.publish(`${source}.thing.happened`, { n: 2 }, { version: 1 }),
      );
      await new Bus(store, "tenants").publish(
        "tenants.tenant.created",
        { tenant_id: "it-b", status: "draft" },
        { version: 1, platform: true },
      );
      await waitFor(() => received.length === 2);
      expect(received.map(([t, e]) => [t, e.tenant, e.data.n])).toEqual([
        ["it-a", "it-a", 1],
        ["it-b", "it-b", 2],
      ]);
    } finally {
      await subscription.close();
      await reader.close();
    }
  });
});
