import { describe, expect, it } from "vitest";
import {
  NoTenant,
  currentTenant,
  isTenantId,
  platformFilesDir,
  platformStream,
  requireTenant,
  tenantFile,
  tenantFilesDir,
  tenantKey,
  tenantStream,
  withTenant,
} from "../src/index.js";

describe("tenant ids", () => {
  it("accepts the contract's ids and refuses the rest", () => {
    for (const ok of ["demo", "lan-2026", "a1b"]) expect(isTenantId(ok)).toBe(true);
    for (const bad of [
      "",
      "ab",
      "Demo",
      "1abc",
      "abc-",
      "_platform",
      "a:b",
      "a/b",
      "x".repeat(33),
    ]) {
      expect(isTenantId(bad)).toBe(false);
    }
  });
});

describe("tenant context", () => {
  it("is unset outside withTenant", () => {
    expect(currentTenant()).toBeUndefined();
    expect(() => requireTenant()).toThrow(NoTenant);
  });

  it("is set inside withTenant, also across awaits, and nests", async () => {
    await withTenant("demo", async () => {
      await Promise.resolve();
      expect(requireTenant()).toBe("demo");
      withTenant("other", () => {
        expect(currentTenant()).toBe("other");
      });
      expect(currentTenant()).toBe("demo");
    });
    expect(currentTenant()).toBeUndefined();
  });

  it("refuses an invalid tenant id", () => {
    expect(() => withTenant("../x", () => 1)).toThrow(/tenant id/);
  });
});

describe("scoped names", () => {
  it("names tenant and platform streams", () => {
    expect(tenantStream("pizza", "demo")).toBe("t:demo:events:pizza");
    withTenant("demo", () => {
      expect(tenantStream("pizza")).toBe("t:demo:events:pizza");
    });
    expect(platformStream("tenants")).toBe("events:tenants");
    expect(() => tenantStream("pizza")).toThrow(NoTenant);
  });

  it("builds Valkey keys from the current tenant only", () => {
    withTenant("demo", () => {
      expect(tenantKey("pizza", "cache", "menu")).toBe("t:demo:pizza:cache:menu");
      expect(() => tenantKey("pizza")).toThrow(/at least one/);
      expect(() => tenantKey("pizza", "a:b")).toThrow(/part/);
      expect(() => tenantKey("pizza", "")).toThrow(/part/);
    });
    expect(() => tenantKey("pizza", "cache")).toThrow(NoTenant);
  });

  it("puts files under /files/<tenant>/<module>/ and refuses escapes", () => {
    withTenant("demo", () => {
      expect(tenantFilesDir("pizza")).toBe("/files/demo/pizza/");
      expect(tenantFile("pizza", "menus/a.png")).toBe("/files/demo/pizza/menus/a.png");
      expect(tenantFile("pizza", "a.png", "/tmp/f")).toBe("/tmp/f/demo/pizza/a.png");
      for (const bad of ["../x", "a/../../x", "/etc/passwd", "", "a\0b", "a\\b"]) {
        expect(() => tenantFile("pizza", bad)).toThrow(/file path/);
      }
    });
    expect(() => tenantFile("pizza", "a.png")).toThrow(NoTenant);
    expect(platformFilesDir("tenants")).toBe("/files/_platform/tenants/");
  });

  it("refuses module names that could escape a key or path", () => {
    withTenant("demo", () => {
      expect(() => tenantFilesDir("../x")).toThrow(/module/);
      expect(() => tenantKey("a:b", "x")).toThrow(/module/);
      // t:<tenant>:events:<module> is a stream name, never a key.
      expect(() => tenantKey("events", "x")).toThrow(/stream/);
    });
  });
});
