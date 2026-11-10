// `POST /api/screen/push` and `DELETE /api/screen/push/{push_id}`: content above every window,
// with its events and audit entries.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, call, code, events, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

const as = (session: string, body?: unknown, host = "alpha.test") => ({ host, session, body });

describe.skipIf(!DATABASE_URL)("push", () => {
  let h: Harness;
  let playlist: string;
  let ads: string;
  const inAnHour = () => new Date(h.clock.now + 3600_000).toISOString();
  beforeAll(async () => {
    h = await harness();
    await call(h, "GET", "/api/screen/zones", as("admin"));
    await call(h, "POST", "/api/screen/zones", as("admin", { key: "cafe", name: "Café" }));
    const make = async (body: Record<string, unknown>) =>
      (await call(h, "POST", "/api/screen/playlists", as("admin", body))).json<{ id: string }>().id;
    playlist = await make({ name: "Final intro", type: "regular", items: [] });
    ads = await make({
      name: "Ads",
      type: "break",
      items: [],
      break: { period_seconds: 60, break_seconds: 5 },
    });
  });
  afterAll(async () => {
    await h.close();
  });

  const push = (body: unknown, session = "admin") =>
    call(h, "POST", "/api/screen/push", as(session, body));

  it("pushes a playlist to zones, with its event and audit entry", async () => {
    const until = inAnHour();
    const res = await push({ zones: ["cafe"], playlist_id: playlist, until });
    expect(res.statusCode).toBe(201);
    const made = res.json<{ id: string }>();
    expect(made).toEqual({
      id: made.id,
      zones: ["cafe"],
      playlist_id: playlist,
      until: new Date(until).toISOString(),
    });
    expect(events(h, "screen.content.pushed").at(-1)).toEqual({
      push_id: made.id,
      zones: ["cafe"],
      playlist_id: playlist,
      until: new Date(until).toISOString(),
      actor_user_id: "u_admin",
    });
    expect(h.audits.at(-1)).toMatchObject({
      action: "screen.content.pushed",
      target: { type: "push", id: made.id },
    });
    // The zone stays while the push plays there.
    expect(code(await call(h, "DELETE", "/api/screen/zones/cafe", as("admin")))).toBe(
      "zone_in_use",
    );

    expect((await call(h, "DELETE", `/api/screen/push/${made.id}`, as("admin"))).statusCode).toBe(
      204,
    );
    expect(events(h, "screen.content.cleared").at(-1)).toEqual({
      push_id: made.id,
      reason: "cleared",
      actor_user_id: "u_admin",
    });
    expect((await call(h, "DELETE", `/api/screen/push/${made.id}`, as("admin"))).statusCode).toBe(
      404,
    );
    expect((await call(h, "DELETE", "/api/screen/zones/cafe", as("admin"))).statusCode).toBe(204);
  });

  it("pushes an asset to every zone", async () => {
    const res = await push({ zones: [], asset_id: "as_7", until: inAnHour() });
    expect(res.json()).toMatchObject({ zones: [], asset_id: "as_7" });
    expect(events(h, "screen.content.pushed").at(-1)).toMatchObject({
      zones: [],
      asset_id: "as_7",
    });
  });

  it("checks zones, the playlist, the time and the right", async () => {
    expect(code(await push({ zones: ["stage"], playlist_id: playlist, until: inAnHour() }))).toBe(
      "unknown_zone",
    );
    expect(code(await push({ zones: [], playlist_id: ads, until: inAnHour() }))).toBe(
      "invalid_request",
    );
    expect(code(await push({ zones: [], playlist_id: "pl_none", until: inAnHour() }))).toBe(
      "invalid_request",
    );
    const late = new Date(h.clock.now + 13 * 3600_000).toISOString();
    expect(code(await push({ zones: [], playlist_id: playlist, until: late }))).toBe(
      "invalid_request",
    );
    // Content writers may not push: that is screen.push.write.
    expect(
      (await push({ zones: [], playlist_id: playlist, until: inAnHour() }, "editor")).statusCode,
    ).toBe(403);
    expect(
      code(
        await call(
          h,
          "POST",
          "/api/screen/push",
          as("admin", { zones: [], asset_id: "as_1", until: inAnHour() }, "gamma.test"),
        ),
      ),
    ).toBe("event_archived");
  });
});
