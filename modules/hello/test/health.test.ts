import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MemoryStreamStore } from "@cp/kit/testing";
import { buildApp, helloHealth } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function start(store: MemoryStreamStore, query: () => Promise<unknown>): FastifyInstance {
  app = buildApp(helloHealth({ module: "hello", version: "v0.0.0-test", store, query }, 200));
  return app;
}

describe("GET /health", () => {
  it("answers 200 ok with both checks ok", async () => {
    const res = await start(new MemoryStreamStore(), () => Promise.resolve()).inject("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "ok",
      module: "hello",
      version: "v0.0.0-test",
      checks: { valkey: { status: "ok" }, postgres: { status: "ok" } },
    });
  });

  it("answers 503 down when Valkey is down", async () => {
    const store = new MemoryStreamStore();
    store.healthy = false;
    const res = await start(store, () => Promise.resolve()).inject("/health");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: "down",
      checks: { valkey: { status: "down" }, postgres: { status: "ok" } },
    });
  });

  it("answers 503 down when Postgres does not answer in time", async () => {
    const never = () => new Promise<never>(() => undefined);
    const res = await start(new MemoryStreamStore(), never).inject("/health");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: "down", checks: { postgres: { status: "down" } } });
  });

  it("answers other paths with the error body", async () => {
    const res = await start(new MemoryStreamStore(), () => Promise.resolve()).inject("/nope");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "not_found" } });
  });
});
