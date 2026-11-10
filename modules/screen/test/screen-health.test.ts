import { MemoryStreamStore } from "@canccu/kit/testing";
import { describe, expect, it } from "vitest";
import { screenHealth } from "../src/app.js";
import { MemoryKv } from "../src/kv.js";
import { MemoryRenderQueue } from "../src/render/queue.js";

describe("screen health", () => {
  it("reports valkey down when the key-value connection is lost, not only the streams'", async () => {
    const kv = new MemoryKv();
    kv.ping = () => Promise.reject(new Error("connection lost"));
    const health = screenHealth({
      module: "screen",
      version: "dev",
      store: new MemoryStreamStore(),
      kv,
      query: () => Promise.resolve(),
      renderQueue: new MemoryRenderQueue(),
    });
    const { body } = await health.run();
    expect(body.checks.valkey).toMatchObject({ status: "down" });
    expect(body.checks.postgres).toEqual({ status: "ok" });
  });
});
