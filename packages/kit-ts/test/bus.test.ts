import { describe, expect, it } from "vitest";
import { validate as isUuid, version as uuidVersion } from "uuid";
import {
  Bus,
  InvalidEnvelope,
  InvalidEventType,
  STREAM_MAXLEN,
  parseEnvelope,
  withCorrelation,
} from "../src/index.js";
import type { Event } from "../src/index.js";
import { MemoryStreamStore } from "../src/testing.js";

const TIME_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

function first(store: MemoryStreamStore, i = 0): Record<string, unknown> {
  const call = store.calls[i];
  if (call === undefined) throw new Error("no xadd call");
  return JSON.parse(call.fields.event ?? "") as Record<string, unknown>;
}

describe("publish", () => {
  it("writes the envelope to events:<module>", async () => {
    const store = new MemoryStreamStore();
    const event = await new Bus(store, "screen").publish(
      "screen.slide.shown",
      { slide: 3 },
      { version: 1 },
    );
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]?.stream).toBe("events:screen");
    expect(Object.keys(store.calls[0]?.fields ?? {})).toEqual(["event"]);
    const body = first(store);
    expect(Object.keys(body).sort()).toEqual(["data", "id", "source", "time", "type", "version"]);
    expect(body).toMatchObject({
      type: "screen.slide.shown",
      version: 1,
      source: "screen",
      data: { slide: 3 },
    });
    expect(isUuid(body.id as string) && uuidVersion(body.id as string)).toBe(7);
    expect(body.time).toMatch(TIME_RE);
    expect(event.id).toBe(body.id);
  });

  it("trims the stream with approximate MAXLEN ~ 10000", async () => {
    const store = new MemoryStreamStore();
    await new Bus(store, "screen").publish("screen.slide.shown", {}, { version: 1 });
    expect(STREAM_MAXLEN).toBe(10000);
    expect(store.calls[0]).toMatchObject({ maxlen: 10000, approximate: true });
  });

  it.each([
    "screen.shown",
    "Screen.slide.shown",
    "screen.slide.shown.now",
    "screen..shown",
    "tournament.match.finished",
  ])("refuses type %s", async (type) => {
    const store = new MemoryStreamStore();
    await expect(new Bus(store, "screen").publish(type, {}, { version: 1 })).rejects.toThrow(
      InvalidEventType,
    );
    expect(store.calls).toHaveLength(0);
  });

  it("refuses version 0", async () => {
    await expect(
      new Bus(new MemoryStreamStore(), "screen").publish("screen.slide.shown", {}, { version: 0 }),
    ).rejects.toThrow(RangeError);
  });

  it("carries the correlation id from context or options", async () => {
    const store = new MemoryStreamStore();
    const bus = new Bus(store, "screen");
    await withCorrelation("req-1", () => bus.publish("screen.slide.shown", {}, { version: 1 }));
    await bus.publish("screen.slide.shown", {}, { version: 1, correlationId: "explicit" });
    expect(first(store, 0).correlation_id).toBe("req-1");
    expect(first(store, 1).correlation_id).toBe("explicit");
  });
});

function envelope(overrides: Record<string, unknown> = {}): string {
  const body: Record<string, unknown> = {
    id: "01928f3e-7a2b-7c4d-9e8f-0a1b2c3d4e5f",
    type: "admin.settings.changed",
    version: 1,
    time: "2026-01-01T12:00:00Z",
    source: "admin",
    data: {},
    ...overrides,
  };
  return JSON.stringify(body);
}

describe("parseEnvelope", () => {
  it("ignores unknown fields", () => {
    const event = parseEnvelope(envelope({ extra: "x", correlation_id: "c" }));
    expect(event.type).toBe("admin.settings.changed");
    expect(event.correlation_id).toBe("c");
  });

  it.each([
    "not json",
    "[]",
    envelope({ id: undefined }),
    envelope({ version: 0 }),
    envelope({ version: 1.5 }),
    envelope({ data: [] }),
    envelope({ source: "screen" }),
    envelope({ type: "bad" }),
  ])("rejects %s", (raw) => {
    expect(() => parseEnvelope(raw)).toThrow(InvalidEnvelope);
  });
});

async function collect(
  store: MemoryStreamStore,
  modules: string[],
  until: number,
): Promise<Event[]> {
  const received: Event[] = [];
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const sub = new Bus(store, "screen").subscribe(
    modules,
    (e) => {
      received.push(e);
      if (received.length >= until) resolve();
    },
    { fromId: "0-0", blockMs: 50 },
  );
  await done;
  await new Promise((r) => setTimeout(r, 100));
  await sub.close();
  return received;
}

describe("subscribe", () => {
  it("dedupes by id, skips invalid entries and passes unknown types", async () => {
    const store = new MemoryStreamStore();
    store.appendRaw("events:admin", { event: envelope({ id: "a" }) });
    store.appendRaw("events:admin", { event: envelope({ id: "a" }) });
    store.appendRaw("events:admin", { event: "garbage" });
    store.appendRaw("events:admin", { other: "field" });
    store.appendRaw("events:admin", {
      event: envelope({ id: "b", type: "admin.thing.unknown_happened" }),
    });
    const received = await collect(store, ["admin"], 2);
    expect(received.map((e) => e.id)).toEqual(["a", "b"]);
    expect(received[1]?.type).toBe("admin.thing.unknown_happened");
  });

  it("reads several streams, including entries added while waiting", async () => {
    const store = new MemoryStreamStore();
    await new Bus(store, "admin").publish("admin.settings.changed", {}, { version: 1 });
    const pending = collect(store, ["admin", "tournament"], 2);
    await new Promise((r) => setTimeout(r, 20));
    await new Bus(store, "tournament").publish("tournament.match.finished", {}, { version: 1 });
    expect((await pending).map((e) => e.source).sort()).toEqual(["admin", "tournament"]);
  });

  it("keeps going when a handler throws", async () => {
    const store = new MemoryStreamStore();
    store.appendRaw("events:admin", { event: envelope({ id: "a" }) });
    store.appendRaw("events:admin", { event: envelope({ id: "b" }) });
    const seen: string[] = [];
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const sub = new Bus(store, "screen").subscribe(
      ["admin"],
      (e) => {
        seen.push(e.id);
        if (e.id === "a") throw new Error("boom");
        resolve();
      },
      { fromId: "0-0", blockMs: 50 },
    );
    await done;
    await sub.close();
    expect(seen).toEqual(["a", "b"]);
  });
});
