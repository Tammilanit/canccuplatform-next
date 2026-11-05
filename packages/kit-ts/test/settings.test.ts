import { describe, expect, it } from "vitest";
import { AdminError, SettingsClient, VersionConflict } from "../src/index.js";
import type { Event } from "../src/index.js";
import { FakeAdmin, jsonResponse } from "./helpers.js";
import type { Recorded } from "./helpers.js";

function changed(module: string, version: number, keys: string[] = []): Event {
  return {
    id: `e${version}`,
    type: "admin.settings.changed",
    version: 1,
    time: "2026-01-01T12:00:00Z",
    source: "admin",
    data: { module, keys, settings_version: version, actor_user_id: "u" },
  };
}

class Stored {
  constructor(
    public version = 0,
    public values: Record<string, unknown> = {},
  ) {}

  answer = (req: Recorded): Response => {
    expect(req.path).toBe("/api/admin/settings/screen");
    if (req.method === "PUT") {
      const body = req.body as { settings_version: number; values: Record<string, unknown> };
      if (body.settings_version !== this.version) {
        return jsonResponse(409, { error: { code: "version_conflict", message: "stale" } });
      }
      this.version += 1;
      this.values = body.values;
    }
    return jsonResponse(200, {
      module: "screen",
      settings_version: this.version,
      values: this.values,
    });
  };
}

describe("settings client", () => {
  it("reads version 0 at start", async () => {
    const admin = new FakeAdmin();
    admin.answer = new Stored().answer;
    const settings = new SettingsClient(admin.client(), "screen");
    await settings.start();
    expect([settings.settingsVersion, settings.values]).toEqual([0, {}]);
  });

  it("re-reads only on a newer change for its own module", async () => {
    const admin = new FakeAdmin();
    const stored = new Stored(4, { rotation_seconds: 10 });
    admin.answer = stored.answer;
    const seen: string[][] = [];
    const settings = new SettingsClient(admin.client(), "screen", {
      onChange: (k) => void seen.push(k),
    });
    await settings.start();
    await settings.handleEvent(changed("tournament", 9));
    await settings.handleEvent(changed("screen", 4));
    expect(admin.requests).toHaveLength(1);
    stored.version = 5;
    stored.values = { rotation_seconds: 20 };
    await settings.handleEvent(changed("screen", 5, ["rotation_seconds"]));
    expect(admin.requests).toHaveLength(2);
    expect(settings.get("rotation_seconds", 10)).toBe(20);
    expect(seen).toEqual([["rotation_seconds"]]);
  });

  it("writes with the held version and maps 409 to VersionConflict", async () => {
    const admin = new FakeAdmin();
    const stored = new Stored(2, { a: 1 });
    admin.answer = stored.answer;
    const settings = new SettingsClient(admin.client(), "screen");
    await settings.start();
    await settings.write({ a: 2 }, { sessionId: "s1" });
    expect(admin.requests.at(-1)).toMatchObject({
      method: "PUT",
      cookie: "canccu_session=s1",
      body: { settings_version: 2, values: { a: 2 } },
    });
    expect(settings.settingsVersion).toBe(3);
    stored.version = 7;
    const err = await settings.write({ a: 3 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VersionConflict);
    expect((err as VersionConflict).toBody().error.code).toBe("version_conflict");
    expect((err as VersionConflict).status).toBe(409);
  });

  it("keeps admin's code for other errors", async () => {
    const admin = new FakeAdmin();
    admin.answer = () => jsonResponse(403, { error: { code: "missing_right", message: "no" } });
    const err = await new SettingsClient(admin.client(), "screen").start().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminError);
    expect([(err as AdminError).status, (err as AdminError).code]).toEqual([403, "missing_right"]);
  });
});
