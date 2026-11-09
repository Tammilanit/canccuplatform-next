import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStreamStore } from "@canccu/kit/testing";
import { buildApp, helloHealth } from "../src/app.js";
import { deployCheck } from "../src/deploy.js";

const OLD = "1111111111111111111111111111111111111111";
const NEW = "2222222222222222222222222222222222222222";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hello-deploy-"));
  file = join(dir, "status.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** What setup/deploy writes, with its defaults for a healthy run. */
function status(fields: Record<string, unknown>): void {
  const base = {
    time: "2026-11-08T12:04:00Z",
    commit: NEW,
    result: "ok",
    error: "",
    failures: 0,
    failing_since: "",
  };
  writeFileSync(file, JSON.stringify({ ...base, ...fields }) + "\n");
}

describe("deployCheck", () => {
  it("is ok and names the deployed commit after a good run", async () => {
    status({});
    expect(await deployCheck(file)()).toEqual({
      status: "ok",
      detail: "2222222 deployed; last run ok at 2026-11-08T12:04:00Z",
    });
  });

  it("stays ok after one failed run, but says why it failed", async () => {
    status({
      commit: OLD,
      result: "failed",
      error: "cannot reach the registry ghcr.io",
      failures: 1,
      failing_since: "2026-11-08T12:02:00Z",
    });
    expect(await deployCheck(file)()).toEqual({
      status: "ok",
      detail:
        "1111111 deployed; last run failed at 2026-11-08T12:04:00Z: cannot reach the registry ghcr.io",
    });
  });

  it("is degraded and says since when after two failed runs in a row", async () => {
    status({
      commit: OLD,
      result: "failed",
      error: "cannot reach the registry ghcr.io",
      failures: 2,
      failing_since: "2026-11-08T12:02:00Z",
    });
    expect(await deployCheck(file)()).toEqual({
      status: "degraded",
      detail:
        "failing since 2026-11-08T12:02:00Z (2 runs in a row): cannot reach the registry ghcr.io; 1111111 still runs",
    });
  });

  it("is ok when the host has no auto-deploy", async () => {
    expect(await deployCheck(file)()).toEqual({
      status: "ok",
      detail: "no auto-deploy on this host",
    });
  });

  it("is degraded when the status cannot be read", async () => {
    writeFileSync(file, "{not json");
    const r = await deployCheck(file)();
    expect(r.status).toBe("degraded");
    expect(r.detail).toMatch(/^cannot read the deploy status/);
  });

  it("is degraded when the status lacks its fields", async () => {
    writeFileSync(file, JSON.stringify({ result: "ok" }));
    const r = await deployCheck(file)();
    expect(r.status).toBe("degraded");
    expect(r.detail).toMatch(/^cannot read the deploy status/);
  });
});

describe("GET /health with a deploy status", () => {
  it("answers 200 degraded, not 503, while the deploy fails", async () => {
    status({ commit: OLD, result: "failed", error: "x", failures: 3, failing_since: "t" });
    const app = buildApp(
      helloHealth({
        module: "hello",
        version: "dev",
        store: new MemoryStreamStore(),
        query: () => Promise.resolve(),
        deployStatusFile: file,
      }),
    );
    try {
      const res = await app.inject("/health");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        status: "degraded",
        version: "dev",
        checks: {
          postgres: { status: "ok" },
          valkey: { status: "ok" },
        },
      });
      const body = res.json<{ checks: Record<string, { status: string; detail?: string }> }>();
      expect(body.checks.deploy?.status).toBe("degraded");
      expect(body.checks.deploy?.detail).toMatch(/^failing since t /);
    } finally {
      await app.close();
    }
  });

  it("has no deploy check without a status file path", async () => {
    const app = buildApp(
      helloHealth({
        module: "hello",
        version: "dev",
        store: new MemoryStreamStore(),
        query: () => Promise.resolve(),
      }),
    );
    try {
      const res = await app.inject("/health");
      const body = res.json<{ checks: Record<string, unknown> }>();
      expect(Object.keys(body.checks)).toEqual(["valkey", "postgres"]);
    } finally {
      await app.close();
    }
  });
});
