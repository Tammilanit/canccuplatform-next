import { describe, expect, it } from "vitest";
import {
  AdminError,
  NoTenant,
  SERVICE_HEADER,
  ServiceIdentity,
  SettingsClient,
  VersionConflict,
  currentTenant,
  withTenant,
} from "../src/index.js";
import type { Event } from "../src/index.js";
import { FakeAdmin, jsonResponse } from "./helpers.js";
import type { Recorded } from "./helpers.js";

const KEY = "k".repeat(32);
const service = new ServiceIdentity({ module: "screen", key: KEY });
const adminSide = new ServiceIdentity({ module: "admin", key: KEY });

function changed(module: string, version: number, tenant?: string, keys: string[] = []): Event {
  return {
    id: `e${version}`,
    type: "admin.settings.changed",
    version: 1,
    time: "2026-01-01T12:00:00Z",
    source: "admin",
    ...(tenant ? { tenant } : {}),
    data: { module, keys, settings_version: version, actor_user_id: "u" },
  };
}

/** Admin's stored settings per tenant; the internal read must be signed by the screen module. */
class Stored {
  tenants: Record<string, { version: number; values: Record<string, unknown> }> = {};

  answer = (req: Recorded): Response => {
    let tenant: string;
    if (req.method === "GET") {
      expect(req.path).toBe("/internal/admin/settings/screen");
      expect(adminSide.verify(req.headers.get(SERVICE_HEADER))).toBe("screen");
      expect(req.cookie).toBeNull();
      tenant = req.query.get("tenant_id") ?? "";
    } else {
      expect(req.path).toBe("/api/admin/settings/screen");
      tenant = "leak-a";
    }
    const stored = (this.tenants[tenant] ??= { version: 0, values: {} });
    if (req.method === "PUT") {
      const body = req.body as { settings_version: number; values: Record<string, unknown> };
      if (body.settings_version !== stored.version) {
        return jsonResponse(409, { error: { code: "version_conflict", message: "stale" } });
      }
      stored.version += 1;
      stored.values = body.values;
    }
    return jsonResponse(200, {
      module: "screen",
      settings_version: stored.version,
      values: stored.values,
    });
  };
}

function setup(onChange?: (keys: string[]) => void) {
  const admin = new FakeAdmin();
  const stored = new Stored();
  admin.answer = stored.answer;
  const settings = new SettingsClient(admin.client(), "screen", {
    service,
    ...(onChange ? { onChange } : {}),
  });
  return { admin, stored, settings };
}

describe("settings client", () => {
  it("reads each tenant's settings on the internal path and keeps them apart", async () => {
    const { admin, stored, settings } = setup();
    stored.tenants["leak-a"] = { version: 3, values: { rotation_seconds: 10 } };
    stored.tenants["leak-b"] = { version: 5, values: { rotation_seconds: 20 } };
    await withTenant("leak-a", () => settings.start());
    await settings.load("leak-b");
    expect(admin.requests.map((r) => r.query.get("tenant_id"))).toEqual(["leak-a", "leak-b"]);
    withTenant("leak-a", () => {
      expect([settings.get("rotation_seconds"), settings.settingsVersion]).toEqual([10, 3]);
    });
    withTenant("leak-b", () => {
      expect([settings.get("rotation_seconds", 5), settings.settingsVersion]).toEqual([20, 5]);
    });
    withTenant("other", () => {
      expect([settings.get("rotation_seconds", 5), settings.settingsVersion]).toEqual([5, 0]);
      expect(settings.get("rotation_seconds")).toBeUndefined();
    });
  });

  it("needs a tenant", async () => {
    const { admin, settings } = setup();
    await expect(settings.load()).rejects.toThrow(NoTenant);
    expect(() => settings.get("x", 1)).toThrow(NoTenant);
    expect(admin.requests).toEqual([]);
  });

  it("re-reads only on a newer change for its own module and a tenant it holds", async () => {
    const seen: [string[], string | undefined][] = [];
    const { admin, stored, settings } = setup((keys) => void seen.push([keys, currentTenant()]));
    stored.tenants["leak-a"] = { version: 4, values: { rotation_seconds: 10 } };
    await settings.load("leak-a");
    await settings.handleEvent(changed("tournament", 9, "leak-a"));
    await settings.handleEvent(changed("screen", 4, "leak-a"));
    await settings.handleEvent(changed("screen", 9));
    await settings.handleEvent(changed("screen", 9, "leak-b"));
    expect(admin.requests).toHaveLength(1);
    stored.tenants["leak-a"] = { version: 5, values: { rotation_seconds: 20 } };
    await settings.handleEvent(changed("screen", 5, "leak-a", ["rotation_seconds"]));
    expect(admin.requests).toHaveLength(2);
    expect(admin.requests[1]?.query.get("tenant_id")).toBe("leak-a");
    expect(withTenant("leak-a", () => settings.get("rotation_seconds", 10))).toBe(20);
    expect(seen).toEqual([[["rotation_seconds"], "leak-a"]]);
  });

  it("writes with the session and the tenant's held version; 409 is VersionConflict", async () => {
    const { admin, stored, settings } = setup();
    stored.tenants["leak-a"] = { version: 2, values: { a: 1 } };
    await withTenant("leak-a", async () => {
      await settings.load();
      await settings.write({ a: 2 }, { sessionId: "s1" });
      expect(admin.requests.at(-1)).toMatchObject({
        method: "PUT",
        cookie: "canccu_session=s1",
        body: { settings_version: 2, values: { a: 2 } },
      });
      expect([settings.settingsVersion, settings.get("a")]).toEqual([3, 2]);
      stored.tenants["leak-a"] = { version: 7, values: {} };
      const err = await settings.write({ a: 3 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(VersionConflict);
      expect((err as VersionConflict).toBody().error.code).toBe("version_conflict");
      expect((err as VersionConflict).status).toBe(409);
    });
  });

  it("keeps admin's code for other errors", async () => {
    const admin = new FakeAdmin();
    admin.answer = () => jsonResponse(403, { error: { code: "missing_right", message: "no" } });
    const err = await new SettingsClient(admin.client(), "screen", { service })
      .load("demo")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect([(err as AdminError).status, (err as AdminError).code]).toEqual([403, "missing_right"]);
  });
});
