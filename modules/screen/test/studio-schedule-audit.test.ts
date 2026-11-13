/**
 * The window editor's actions (#267, plan #190 S10; contracts/screen.md, Audit G2): each needs its
 * right, refused with 403 and changing nothing without it; each write is audited with who and
 * what, and one the audit log refuses does not happen.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DATABASE_URL, call, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Schedule {
  id: string;
  priority: number;
  revision: number;
}

describe.skipIf(!DATABASE_URL)("the window editor's rights and audit", () => {
  let h: Harness;
  let playlist = "";
  let window: Schedule;
  const as = (session: string, body?: unknown) => ({ session, body });
  const weekly = () => ({
    zone_key: "main",
    playlist_id: playlist,
    priority: 10,
    days: [4],
    start_minute: 540,
    end_minute: 1020,
  });
  const list = async () =>
    (await call(h, "GET", "/api/screen/schedules", as("admin"))).json<{ schedules: Schedule[] }>()
      .schedules;

  beforeAll(async () => {
    h = await harness();
    await call(h, "GET", "/api/screen/zones", as("admin"));
    playlist = (
      await call(
        h,
        "POST",
        "/api/screen/playlists",
        as("admin", { name: "Welcome loop", type: "regular", items: [] }),
      )
    ).json<{ id: string }>().id;
    window = (await call(h, "POST", "/api/screen/schedules", as("editor", weekly()))).json();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(() => {
    h.audits.length = 0;
  });

  it("refuses each write without screen.content.write, and changes nothing", async () => {
    const url = `/api/screen/schedules/${window.id}`;
    for (const session of ["content", "crew", "nobody"]) {
      expect(
        (await call(h, "POST", "/api/screen/schedules", as(session, weekly()))).statusCode,
      ).toBe(403);
      const put = await call(h, "PUT", url, as(session, { ...weekly(), priority: 1, revision: 1 }));
      expect(put.statusCode).toBe(403);
      expect((await call(h, "DELETE", `${url}?revision=1`, as(session))).statusCode).toBe(403);
    }
    expect(await list()).toEqual([expect.objectContaining({ id: window.id, priority: 10 })]);
    expect(h.audits).toEqual([]);
  });

  it("refuses the reads without screen.content.read", async () => {
    const reads = [
      "/api/screen/schedules",
      "/api/screen/schedules/simulate?zone=main&at=2026-01-01T12:00:00Z",
      "/api/screen/schedules/calendar?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z",
    ];
    for (const url of reads) {
      expect((await call(h, "GET", url, as("crew"))).statusCode).toBe(403);
      expect((await call(h, "GET", url, as("content"))).statusCode).toBe(200);
    }
  });

  it("audits create, change and delete with who did it and what changed", async () => {
    const made = (
      await call(h, "POST", "/api/screen/schedules", as("editor", weekly()))
    ).json<Schedule>();
    const url = `/api/screen/schedules/${made.id}`;
    const changed = await call(
      h,
      "PUT",
      url,
      as("editor", { ...weekly(), priority: 40, start_minute: 600, revision: 1 }),
    );
    expect(changed.statusCode).toBe(200);
    expect((await call(h, "DELETE", `${url}?revision=2`, as("editor"))).statusCode).toBe(204);
    const target = { type: "schedule", id: made.id };
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: "screen.schedule.created",
        actor_user_id: "u_editor",
        target,
      }),
      expect.objectContaining({
        action: "screen.schedule.changed",
        actor_user_id: "u_editor",
        target,
        changes: { priority: { from: 10, to: 40 }, start_minute: { from: 540, to: 600 } },
      }),
      expect.objectContaining({
        action: "screen.schedule.deleted",
        actor_user_id: "u_editor",
        target,
      }),
    ]);
  });

  it("keeps every window as it was when the audit log refuses the write", async () => {
    const before = await list();
    h.failAudit.next = true;
    expect(
      (await call(h, "POST", "/api/screen/schedules", as("editor", weekly()))).statusCode,
    ).toBe(503);
    const url = `/api/screen/schedules/${window.id}`;
    h.failAudit.next = true;
    const put = await call(h, "PUT", url, as("editor", { ...weekly(), priority: 2, revision: 1 }));
    expect(put.statusCode).toBe(503);
    h.failAudit.next = true;
    expect((await call(h, "DELETE", `${url}?revision=1`, as("editor"))).statusCode).toBe(503);
    expect(await list()).toEqual(before);
    expect(h.audits).toEqual([]);
  });
});
