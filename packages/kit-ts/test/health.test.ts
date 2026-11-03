import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createHealth, postgresCheck, valkeyCheck } from "../src/index.js";
import type { CheckFn, HealthBody } from "../src/index.js";
import { MemoryStreamStore } from "../src/testing.js";

interface Schema {
  required: string[];
  properties: Record<string, unknown>;
}

const spec = parse(
  readFileSync(new URL("../../../contracts/admin.openapi.yaml", import.meta.url), "utf8"),
) as {
  components: { schemas: { Health: Schema; HealthStatus: { enum: string[] } } };
};

function matchesContract(body: HealthBody): void {
  const { Health, HealthStatus } = spec.components.schemas;
  for (const key of Health.required) expect(body).toHaveProperty(key);
  for (const key of Object.keys(body)) expect(Object.keys(Health.properties)).toContain(key);
  expect(HealthStatus.enum).toContain(body.status);
  for (const check of Object.values(body.checks)) {
    expect(HealthStatus.enum).toContain(check.status);
    for (const key of Object.keys(check)) expect(["status", "detail"]).toContain(key);
  }
}

const ok: CheckFn = () => Promise.resolve({ status: "ok" });
const down: CheckFn = () => Promise.resolve({ status: "down", detail: "refused" });
const failing: CheckFn = () => Promise.reject(new Error("no route"));
const slow: CheckFn = () =>
  new Promise((r) =>
    setTimeout(() => {
      r({ status: "ok" });
    }, 1000),
  );

describe("health", () => {
  it("is 200 ok when every check is ok", async () => {
    const result = await createHealth({
      module: "screen",
      version: "v0.1.0",
      checks: { postgres: ok, valkey: ok },
    }).run();
    expect(result.httpStatus).toBe(200);
    expect(result.body).toMatchObject({
      status: "ok",
      module: "screen",
      version: "v0.1.0",
      checks: { postgres: { status: "ok" }, valkey: { status: "ok" } },
    });
    matchesContract(result.body);
  });

  it("is 200 degraded when a non-essential check is down", async () => {
    const result = await createHealth({
      module: "screen",
      version: "v0.1.0",
      checks: { valkey: ok, cdn: { run: down, essential: false } },
    }).run();
    expect([result.httpStatus, result.body.status]).toEqual([200, "degraded"]);
    matchesContract(result.body);
  });

  it.each([
    ["down", down],
    ["failing", failing],
    ["slow", slow],
  ] as const)("is 503 down when an essential check is %s", async (_name, check) => {
    const result = await createHealth({
      module: "screen",
      version: "v0.1.0",
      checks: { valkey: check },
      timeoutMs: 50,
    }).run();
    expect([result.httpStatus, result.body.status]).toEqual([503, "down"]);
    expect(result.body.checks.valkey?.detail).toBeTypeOf("string");
    matchesContract(result.body);
  });

  it("has ready-made valkey and postgres checks", async () => {
    const store = new MemoryStreamStore();
    const health = createHealth({
      module: "screen",
      version: "v0.1.0",
      checks: { valkey: valkeyCheck(store), postgres: postgresCheck(() => Promise.resolve(1)) },
    });
    expect((await health.run()).body.status).toBe("ok");
    store.healthy = false;
    expect((await health.run()).httpStatus).toBe(503);
  });
});
