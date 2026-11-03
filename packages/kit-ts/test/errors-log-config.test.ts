import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  KitError,
  MissingRight,
  createLogger,
  errorBody,
  loadConfig,
  parseErrorBody,
  withCorrelation,
} from "../src/index.js";

describe("error body", () => {
  it("has the contract shape", () => {
    expect(new MissingRight("needs x").toBody()).toEqual({
      error: { code: "missing_right", message: "needs x" },
    });
    const err = new KitError("bad slide", { status: 400, code: "slide_invalid" });
    expect([err.status, err.toBody().error.code]).toEqual([400, "slide_invalid"]);
  });

  it("parses", () => {
    expect(parseErrorBody(errorBody("version_conflict", "stale"))).toEqual([
      "version_conflict",
      "stale",
    ]);
    expect(parseErrorBody({ error: "x" })).toBeUndefined();
    expect(parseErrorBody(null)).toBeUndefined();
  });
});

describe("config", () => {
  it("loads and names missing variables", () => {
    const env = {
      CP_MODULE: "screen",
      CP_VERSION: "v0.1.0",
      CP_VALKEY_URL: "valkey://valkey:6379/0",
      CP_ADMIN_URL: "http://admin:8000/",
    };
    expect(loadConfig(env)).toEqual({
      module: "screen",
      version: "v0.1.0",
      valkeyUrl: "valkey://valkey:6379/0",
      adminUrl: "http://admin:8000",
    });
    expect(() =>
      loadConfig({ CP_MODULE: "screen", CP_VERSION: "v0.1.0", CP_VALKEY_URL: "" }),
    ).toThrow(new ConfigError("missing environment variable(s): CP_VALKEY_URL, CP_ADMIN_URL"));
  });
});

describe("logging", () => {
  it("writes JSON lines with the shared fields and the correlation id", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(...chunk.toString().split("\n").filter(Boolean));
        done();
      },
    });
    const log = createLogger("screen", sink);
    log.info("plain");
    withCorrelation("req-9", () => {
      log.warn({ slide: 3 }, "slide missing");
    });
    const [a, b] = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(a).toMatchObject({ level: "info", module: "screen", message: "plain" });
    expect(Object.keys(a ?? {})).toEqual(
      expect.arrayContaining(["time", "level", "module", "message"]),
    );
    expect(a?.time).toMatch(/Z$/);
    expect(a).not.toHaveProperty("correlation_id");
    expect(b).toMatchObject({
      level: "warn",
      correlation_id: "req-9",
      slide: 3,
      message: "slide missing",
    });
  });
});
