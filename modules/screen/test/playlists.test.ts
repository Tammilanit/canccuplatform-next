// `/api/screen/playlists…`: the whole playlist as one document with its revision, audited.
// Ported from the legacy signage `admin-api-advt.test.ts` (break settings saved and read back)
// and the repository half of `playlist-builder.test.ts` (items kept in order, delete takes the
// items along), as the contract's one-document API.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, call, code, events, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { seedAssets } from "./seed.js";

interface Playlist {
  id: string;
  name: string;
  type: string;
  priority: number;
  break: Record<string, unknown> | null;
  items: { id: string; asset_id: string; duration_seconds: number | null }[];
  revision: number;
}

const as = (session: string, body?: unknown, host = "alpha.test") => ({ host, session, body });
const items = (...assets: string[]) =>
  assets.map((asset_id) => ({ asset_id, duration_seconds: 10 }));

describe.skipIf(!DATABASE_URL)("playlists", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    // Reading the zones seeds the event's `main` zone, as Studio's first page does.
    await call(h, "GET", "/api/screen/zones", as("admin"));
    await seedAssets(
      h,
      ...["as_1", "as_2", "as_ad"].map((id) => ({ id, kind: "image" as const })),
      ...["as_3", "as_4"].map((id) => ({ id, kind: "video" as const })),
    );
  });
  afterAll(async () => {
    await h.close();
  });

  const create = async (body: Record<string, unknown>, host = "alpha.test") => {
    const res = await call(h, "POST", "/api/screen/playlists", as("admin", body, host));
    expect(res.statusCode).toBe(201);
    return res.json<Playlist>();
  };

  it("adds a playlist with its items in order, audited", async () => {
    const made = await create({
      name: "Main",
      type: "regular",
      priority: 10,
      items: items("as_1", "as_2"),
    });
    expect(made).toMatchObject({
      name: "Main",
      type: "regular",
      priority: 10,
      break: null,
      revision: 1,
    });
    expect(made.items.map((i) => i.asset_id)).toEqual(["as_1", "as_2"]);
    expect(made.items[0]?.id).toMatch(/^pi_/);
    expect(h.audits.at(-1)).toMatchObject({
      tenant_id: "alpha",
      actor_user_id: "u_admin",
      action: "screen.playlist.created",
      target: { type: "playlist", id: made.id },
    });
    const read = await call(h, "GET", `/api/screen/playlists/${made.id}`, as("content"));
    expect(read.json()).toEqual(made);
    // Another event never sees it.
    expect(
      (
        await call(
          h,
          "GET",
          `/api/screen/playlists/${made.id}`,
          as("admin", undefined, "beta.test"),
        )
      ).statusCode,
    ).toBe(404);
  });

  it("needs screen.content.write to write and screen.content.read to read", async () => {
    const body = { name: "x", type: "regular", items: [] };
    expect((await call(h, "POST", "/api/screen/playlists", as("content", body))).statusCode).toBe(
      403,
    );
    expect((await call(h, "GET", "/api/screen/playlists", as("crew"))).statusCode).toBe(403);
    expect((await call(h, "GET", "/api/screen/playlists", {})).statusCode).toBe(401);
  });

  it("saves and reads back a break playlist's settings", async () => {
    const made = await create({
      name: "Break ads",
      type: "break",
      priority: 5,
      items: items("as_ad"),
      break: { period_seconds: 120, break_seconds: 30, play_once: true, zones: ["main"] },
    });
    expect(made.break).toMatchObject({
      period_seconds: 120,
      break_seconds: 30,
      play_once: true,
      zones: ["main"],
    });
    const unknown = await call(
      h,
      "POST",
      "/api/screen/playlists",
      as("admin", {
        name: "x",
        type: "break",
        items: [],
        break: { period_seconds: 120, break_seconds: 30, zones: ["cafe"] },
      }),
    );
    expect(code(unknown)).toBe("unknown_zone");
    // The zone a break playlist interrupts cannot go while it does.
    const del = await call(h, "DELETE", "/api/screen/zones/main", as("admin"));
    expect(code(del)).toBe("zone_in_use");
  });

  it("replaces a playlist with the revision read, keeping the item ids it sends", async () => {
    const made = await create({ name: "Loop", type: "regular", items: items("as_1", "as_2") });
    const kept = made.items[1];
    const save = (revision: number) =>
      call(
        h,
        "PUT",
        `/api/screen/playlists/${made.id}`,
        as("admin", {
          name: "Loop 2",
          type: "regular",
          items: [
            kept,
            { asset_id: "as_3", duration_seconds: null },
            { id: "pi_foreign", asset_id: "as_4" },
          ],
          revision,
        }),
      );
    const saved = await save(1);
    expect(saved.statusCode).toBe(200);
    const after = saved.json<Playlist>();
    expect(after.revision).toBe(2);
    expect(after.items.map((i) => i.asset_id)).toEqual(["as_2", "as_3", "as_4"]);
    expect(after.items[0]?.id).toBe(kept?.id);
    expect(after.items[2]?.id).not.toBe("pi_foreign");
    expect(after.items[1]?.duration_seconds).toBeNull();
    expect(code(await save(1))).toBe("version_conflict");
    const noRevision = await call(
      h,
      "PUT",
      `/api/screen/playlists/${made.id}`,
      as("admin", { name: "x", type: "regular", items: [] }),
    );
    expect(code(noRevision)).toBe("invalid_request");
    expect(h.audits.at(-1)).toMatchObject({
      action: "screen.playlist.changed",
      changes: { name: { from: "Loop", to: "Loop 2" } },
    });
  });

  it("deletes a playlist with its windows and ends its pushes", async () => {
    const made = await create({ name: "Gone", type: "regular", items: items("as_1") });
    const window = await call(
      h,
      "POST",
      "/api/screen/schedules",
      as("admin", {
        zone_key: "main",
        playlist_id: made.id,
        priority: 1,
        days: [1],
        start_minute: 0,
        end_minute: 60,
      }),
    );
    expect(window.statusCode).toBe(201);
    const push = await call(
      h,
      "POST",
      "/api/screen/push",
      as("admin", {
        zones: [],
        playlist_id: made.id,
        until: new Date(h.clock.now + 3600_000).toISOString(),
      }),
    );
    expect(push.statusCode).toBe(201);
    const pushId = push.json<{ id: string }>().id;

    expect(
      (await call(h, "DELETE", `/api/screen/playlists/${made.id}`, as("admin"))).statusCode,
    ).toBe(204);
    expect((await call(h, "GET", `/api/screen/playlists/${made.id}`, as("admin"))).statusCode).toBe(
      404,
    );
    const windows = await call(h, "GET", "/api/screen/schedules", as("admin"));
    expect(
      windows
        .json<{ schedules: { playlist_id: string }[] }>()
        .schedules.filter((s) => s.playlist_id === made.id),
    ).toEqual([]);
    expect(events(h, "screen.content.cleared").at(-1)).toEqual({
      push_id: pushId,
      reason: "cleared",
      actor_user_id: "u_admin",
    });
    const windowId = window.json<{ id: string }>().id;
    expect(h.audits.slice(-3)).toMatchObject([
      { action: "screen.content.cleared" },
      { action: "screen.schedule.deleted", target: { type: "schedule", id: windowId } },
      { action: "screen.playlist.deleted" },
    ]);
    expect(
      (await call(h, "DELETE", `/api/screen/playlists/${made.id}`, as("admin"))).statusCode,
    ).toBe(404);
  });

  it("refuses to make a scheduled playlist a break playlist", async () => {
    const made = await create({ name: "Day", type: "regular", items: [] });
    await call(
      h,
      "POST",
      "/api/screen/schedules",
      as("admin", { zone_key: "main", playlist_id: made.id, priority: 1, agenda_item_id: "it_1" }),
    );
    const res = await call(
      h,
      "PUT",
      `/api/screen/playlists/${made.id}`,
      as("admin", {
        name: "Day",
        type: "break",
        items: [],
        break: { period_seconds: 60, break_seconds: 5 },
        revision: 1,
      }),
    );
    expect(code(res)).toBe("invalid_request");
  });

  it("refuses to make a pushed playlist a break playlist", async () => {
    const made = await create({ name: "Now", type: "regular", items: [] });
    const until = new Date(h.clock.now + 3600_000).toISOString();
    await call(
      h,
      "POST",
      "/api/screen/push",
      as("admin", { zones: [], playlist_id: made.id, until }),
    );
    const toBreak = {
      name: "Now",
      type: "break",
      items: [],
      break: { period_seconds: 60, break_seconds: 5 },
    };
    const res = await call(
      h,
      "PUT",
      `/api/screen/playlists/${made.id}`,
      as("admin", { ...toBreak, revision: 1 }),
    );
    expect(code(res)).toBe("invalid_request");
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/pushed/);
  });

  it("writes nothing when the audit log cannot take the entry", async () => {
    h.failAudit.next = true;
    const res = await call(
      h,
      "POST",
      "/api/screen/playlists",
      as("admin", { name: "Lost", type: "regular", items: [] }),
    );
    expect(res.statusCode).toBe(503);
    const all = (await call(h, "GET", "/api/screen/playlists", as("admin"))).json<{
      playlists: Playlist[];
    }>();
    expect(all.playlists.map((p) => p.name)).not.toContain("Lost");
  });

  it("refuses writes on an archived event", async () => {
    const res = await call(
      h,
      "POST",
      "/api/screen/playlists",
      as("admin", { name: "x", type: "regular", items: [] }, "gamma.test"),
    );
    expect(code(res)).toBe("event_archived");
  });
});
