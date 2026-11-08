import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  SERVICE_HEADER,
  ServiceForbidden,
  ServiceIdentity,
  ServiceUnauthenticated,
  serviceHasRight,
  serviceKeyFromEnv,
} from "../src/index.js";

const KEY = "k".repeat(32);
const NOW = 1_800_000_000_000;

function identity(module: string, key = KEY, now = NOW): ServiceIdentity {
  return new ServiceIdentity({ module, key, now: () => now });
}

function sign(payload: string, key = KEY): string {
  return createHmac("sha256", key).update(`canccu-service.v1.${payload}`).digest("base64url");
}

function token(caller: string, audience: string, expires: number, key = KEY): string {
  const payload = `${caller}.${audience}.${expires}`;
  return `v1.${payload}.${sign(payload, key)}`;
}

describe("serviceKeyFromEnv", () => {
  it("reads a key of at least 32 characters", () => {
    expect(serviceKeyFromEnv({ CANCCU_SERVICE_KEY: KEY })).toBe(KEY);
  });

  it("refuses a missing or short key", () => {
    expect(() => serviceKeyFromEnv({})).toThrow(ConfigError);
    expect(() => serviceKeyFromEnv({ CANCCU_SERVICE_KEY: "k".repeat(31) })).toThrow(ConfigError);
  });

  it("refuses a local-only placeholder key outside a dev version", () => {
    const placeholder = "canccu-local-only-service-key-0123456789";
    expect(serviceKeyFromEnv({ CANCCU_SERVICE_KEY: placeholder, CANCCU_VERSION: "dev" })).toBe(
      placeholder,
    );
    for (const version of ["v1.0.0", undefined]) {
      expect(() =>
        serviceKeyFromEnv({ CANCCU_SERVICE_KEY: placeholder, CANCCU_VERSION: version }),
      ).toThrow(ConfigError);
    }
  });
});

describe("ServiceIdentity", () => {
  const screen = identity("screen");
  const admin = identity("admin");

  it("signs headers that the audience verifies as the caller", () => {
    const headers = screen.headers("admin");
    const value = headers[SERVICE_HEADER];
    expect(Object.keys(headers)).toEqual([SERVICE_HEADER]);
    expect(value).toBe(token("screen", "admin", NOW / 1000 + 60));
    expect(admin.verify(value)).toBe("screen");
  });

  it("refuses a token for another audience", () => {
    expect(() => screen.verify(identity("pizza").headers("admin")[SERVICE_HEADER])).toThrow(
      ServiceUnauthenticated,
    );
  });

  it("refuses a token signed with another key", () => {
    const other = identity("screen", "x".repeat(32)).headers("admin")[SERVICE_HEADER];
    expect(() => admin.verify(other)).toThrow(ServiceUnauthenticated);
  });

  it("refuses a tampered caller, audience or signature", () => {
    const good = token("screen", "admin", NOW / 1000 + 60);
    const parts = good.split(".");
    const sig = parts[4] ?? "";
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    for (const bad of [
      good.replace("v1.screen.", "v1.pizza."),
      ["v1", "screen", "admin", String(NOW / 1000 + 600), sig].join("."),
      [...parts.slice(0, 4), flipped].join("."),
      [...parts.slice(0, 4), sig.slice(0, -1)].join("."),
    ]) {
      expect(() => admin.verify(bad)).toThrow(ServiceUnauthenticated);
    }
  });

  it("refuses an expired token and one that expires too far ahead", () => {
    expect(() => admin.verify(token("screen", "admin", NOW / 1000 - 1))).toThrow(
      ServiceUnauthenticated,
    );
    expect(admin.verify(token("screen", "admin", NOW / 1000))).toBe("screen");
    expect(admin.verify(token("screen", "admin", NOW / 1000 + 300))).toBe("screen");
    expect(() => admin.verify(token("screen", "admin", NOW / 1000 + 301))).toThrow(
      ServiceUnauthenticated,
    );
  });

  it("refuses missing and malformed values without saying which check failed", () => {
    const exp = NOW / 1000 + 60;
    for (const bad of [
      undefined,
      null,
      "",
      "garbage",
      `v2.screen.admin.${exp}.${sign(`screen.admin.${exp}`)}`,
      `v1.Screen.admin.${exp}.${sign(`Screen.admin.${exp}`)}`,
      `v1.screen.admin.0${exp}.${sign(`screen.admin.0${exp}`)}`,
      `v1.screen.admin.${exp}.x.${sign(`screen.admin.${exp}`)}`,
    ]) {
      const err = (() => {
        try {
          admin.verify(bad);
        } catch (e) {
          return e;
        }
        return undefined;
      })();
      expect(err).toBeInstanceOf(ServiceUnauthenticated);
      expect((err as ServiceUnauthenticated).toBody()).toEqual({
        error: { code: "service_unauthenticated", message: "service unauthenticated" },
      });
      expect((err as ServiceUnauthenticated).status).toBe(401);
    }
  });

  it("require() limits the callers when a list is given", () => {
    const value = screen.headers("admin")[SERVICE_HEADER];
    expect(admin.require(value)).toBe("screen");
    expect(admin.require(value, ["screen", "pizza"])).toBe("screen");
    const err = (() => {
      try {
        admin.require(value, ["pizza"]);
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(ServiceForbidden);
    expect([(err as ServiceForbidden).status, (err as ServiceForbidden).code]).toEqual([
      403,
      "service_forbidden",
    ]);
  });

  it("refuses a bad module name or a short key", () => {
    expect(() => new ServiceIdentity({ module: "Screen", key: KEY })).toThrow(RangeError);
    expect(() => new ServiceIdentity({ module: "screen", key: "short" })).toThrow(ConfigError);
    expect(() => screen.headers("not a module")).toThrow(RangeError);
  });
});

describe("serviceHasRight", () => {
  it("grants a module only its own rights", () => {
    expect(serviceHasRight("screen", "screen.slides.edit")).toBe(true);
    expect(serviceHasRight("screen", "admin.settings.read")).toBe(false);
    expect(serviceHasRight("screen", "screens.slides.edit")).toBe(false);
    expect(serviceHasRight("screen", "screen")).toBe(false);
  });
});
