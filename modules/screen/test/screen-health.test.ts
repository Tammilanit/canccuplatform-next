import { MemoryStreamStore } from "@canccu/kit/testing";
import { describe, expect, it } from "vitest";
import { screenHealth } from "../src/app.js";
import { MemoryKv } from "../src/kv.js";
import { MemoryRenderQueue } from "../src/render/queue.js";

function healthOf(kv: MemoryKv, store: MemoryStreamStore) {
  return screenHealth({
    module: "screen",
    version: "dev",
    store,
    kv,
    query: () => Promise.resolve(),
    renderQueue: new MemoryRenderQueue(),
  });
}

describe("screen health", () => {
  it("reports valkey down when the key-value connection is lost, not only the streams'", async () => {
    const kv = new MemoryKv();
    kv.ping = () => Promise.reject(new Error("connection lost"));
    const { body } = await healthOf(kv, new MemoryStreamStore()).run();
    expect(body.checks.valkey).toMatchObject({ status: "down" });
    expect(body.checks.valkey?.detail).toContain("key-value connection: connection lost");
    expect(body.checks.valkey?.detail).not.toContain("streams");
    expect(body.checks.postgres).toEqual({ status: "ok" });
  });

  it("names the streams connection when that one is lost", async () => {
    const store = new MemoryStreamStore();
    store.ping = () => Promise.reject(new Error("stream gone"));
    const { body } = await healthOf(new MemoryKv(), store).run();
    expect(body.checks.valkey).toMatchObject({ status: "down" });
    expect(body.checks.valkey?.detail).toContain("streams connection: stream gone");
    expect(body.checks.valkey?.detail).not.toContain("key-value");
  });

  it("pings both connections at once and names both when both are lost", async () => {
    const kv = new MemoryKv();
    const store = new MemoryStreamStore();
    const started: string[] = [];
    kv.ping = () => {
      started.push("kv");
      return new Promise((_, reject) =>
        setTimeout(() => {
          reject(new Error("kv lost"));
        }, 10),
      );
    };
    store.ping = () => {
      started.push("streams");
      return Promise.reject(new Error("streams lost"));
    };
    const { body } = await healthOf(kv, store).run();
    expect(started).toEqual(["kv", "streams"]);
    expect(body.checks.valkey?.detail).toContain("key-value connection: kv lost");
    expect(body.checks.valkey?.detail).toContain("streams connection: streams lost");
  });
});
