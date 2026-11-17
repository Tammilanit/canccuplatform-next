// The event's pins over HTTP on Postgres (contracts/screen.md, Pins): rights, the values and
// their checks, the audit, `screen.pin.changed`, the `reload` every screen of the event gets, and
// the bundle and revision screens then draw. Timed pins and freeze: pins-until.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DATABASE_URL, call, code } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { DAY, NOON, as, iso, pinsHarness } from "./pins-kit.js";
import type { Pins } from "./pins-kit.js";

describe.skipIf(!DATABASE_URL)("pins", () => {
  let h: Harness;
  let device: string;
  let token: string;
  let changes: Pins["changes"];
  let pin: Pins["pin"];
  let put: Pins["put"];
  let commands: Pins["commands"];
  let reset: Pins["reset"];

  beforeAll(async () => {
    ({ h, device, token, changes, pin, put, commands, reset } = await pinsHarness());
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await reset();
  });

  it("answers an unpinned event with what screens draw now and the bundles kept", async () => {
    const body = await pin("crew");
    expect(body).toMatchObject({
      bundle_version: null,
      theme_revision: null,
      until: null,
      restores: null,
      in_effect: { bundle_version: "test", theme_revision: 5 },
    });
    expect(body.available).toEqual(expect.arrayContaining(["test", "0.9.0"]));
    expect(body).toHaveProperty("changed_by");
    expect(body).toHaveProperty("changed_at");
  });

  it("reads with any Studio read right, writes only with screen.bundle.write", async () => {
    for (const session of ["crew", "content", "bundler"]) {
      expect((await call(h, "GET", "/api/screen/pin", as(session))).statusCode).toBe(200);
    }
    for (const session of ["nobody", "ticker", "photos"]) {
      expect((await call(h, "GET", "/api/screen/pin", as(session))).statusCode).toBe(403);
    }
    const body = { bundle_version: null, theme_revision: 4 };
    for (const session of ["crew", "content", "editor", "nobody"]) {
      const res = await put(body, session);
      expect(res.statusCode).toBe(403);
      expect(code(res)).toBe("missing_right");
    }
    expect((await put({ freeze: true, until: iso(NOON + DAY) }, "editor")).statusCode).toBe(403);
    expect((await put({ freeze: false }, "crew")).statusCode).toBe(403);
    expect((await call(h, "GET", "/api/screen/pin", { host: "alpha.test" })).statusCode).toBe(401);
    expect(changes().filter((e) => e.theme_revision === 4)).toEqual([]);
  });

  it("pins a bundle and a revision, audited, announced and sent to screens as a reload", async () => {
    const before = changes().length;
    const res = await put({ bundle_version: "0.9.0", theme_revision: 3 }, "bundler");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      bundle_version: "0.9.0",
      theme_revision: 3,
      until: null,
      restores: null,
      in_effect: { bundle_version: "0.9.0", theme_revision: 3 },
      changed_by: "u_bundler",
      changed_at: iso(NOON),
    });
    expect(changes().slice(before)).toEqual([
      {
        bundle_version: "0.9.0",
        theme_revision: 3,
        until: null,
        restores: null,
        reason: "set",
        actor_user_id: "u_bundler",
      },
    ]);
    expect(h.audits).toEqual([
      expect.objectContaining({
        tenant_id: "alpha",
        actor_user_id: "u_bundler",
        action: "screen.pin.set",
        target: { type: "pin", id: "pin" },
        changes: {
          bundle_version: { from: null, to: "0.9.0" },
          theme_revision: { from: null, to: 3 },
          until: { from: null, to: null },
        },
      }),
    ]);
    expect(await commands()).toEqual(["reload"]);
    // Another event sees none of it.
    expect(await pin("admin", "beta.test")).toMatchObject({ bundle_version: null });
  });

  it("refuses a bundle not kept, a revision the event lacks, and bodies off the contract", async () => {
    const bad = [
      { bundle_version: "0.1.0", theme_revision: null },
      { bundle_version: null, theme_revision: 9 },
      { bundle_version: null, theme_revision: 0 },
      { bundle_version: null, theme_revision: "3" },
      { bundle_version: null },
      { bundle_version: null, theme_revision: null, extra: 1 },
      { freeze: true },
      { freeze: true, until: iso(NOON + DAY), theme_revision: 3 },
      { freeze: false, until: iso(NOON + DAY) },
      { freeze: "yes", until: iso(NOON + DAY) },
      { bundle_version: null, theme_revision: 3, until: "tomorrow" },
    ];
    for (const body of bad) {
      const res = await put(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(code(res)).toBe("invalid_request");
    }
    expect(await commands()).toEqual([]);
  });

  it("takes an until in the future, up to the event's end or 14 days ahead, whichever is later", async () => {
    const at = (until: number) =>
      put({ bundle_version: null, theme_revision: 3, until: iso(until) });
    expect((await at(NOON - 1000)).statusCode).toBe(400);
    expect((await at(NOON)).statusCode).toBe(400);
    expect((await at(NOON + 14 * DAY)).statusCode).toBe(200);
    expect((await at(NOON + 14 * DAY + 1000)).statusCode).toBe(400);
    h.publicEvents["alpha.test"] = { id: "alpha", status: "live", ends_at: iso(NOON + 20 * DAY) };
    expect((await at(NOON + 20 * DAY)).statusCode).toBe(200);
    expect((await at(NOON + 20 * DAY + 1000)).statusCode).toBe(400);
    h.publicEvents["alpha.test"] = { id: "alpha", status: "live", ends_at: iso(NOON + 3 * DAY) };
  });

  it("answers 503 for a revision theming fails to read, not 400", async () => {
    h.sources.revisionsDown = true;
    const res = await put({ bundle_version: null, theme_revision: 3 });
    h.sources.revisionsDown = false;
    expect(res.statusCode).toBe(503);
    expect(code(res)).toBe("theming_unavailable");
  });

  it("refuses writes on an archived event", async () => {
    const res = await put({ bundle_version: null, theme_revision: null }, "admin", "gamma.test");
    expect(res.statusCode).toBe(409);
  });

  it("serves the pinned bundle to the event's screens and keeps the others on the platform's", async () => {
    await put({ bundle_version: "0.9.0", theme_revision: null });
    const kiosk = await call(h, "GET", "/screen/", { host: "alpha.test" });
    expect(kiosk.body).toContain('src="/screen/b/0.9.0/player.js"');
    expect(kiosk.body).toContain('data-bundle="0.9.0"');
    const other = await call(h, "GET", "/screen/", { host: "beta.test" });
    expect(other.body).toContain('src="/screen/b/test/player.js"');
    const file = await call(h, "GET", "/screen/b/0.9.0/player.js", { host: "alpha.test" });
    expect(file.statusCode).toBe(200);
    expect(file.body).toBe("/* 0.9.0 */\n");
    expect(file.headers["cache-control"]).toContain("immutable");
    expect((await call(h, "GET", "/screen/b/0.1.0/player.js")).statusCode).toBe(404);
    expect((await call(h, "GET", "/screen/b/0.9.0/sw.js")).statusCode).toBe(404);
  });

  it("draws the pinned revision and names the pinned bundle in the screens' state", async () => {
    await call(h, "GET", "/api/screen/zones", as("admin"));
    await call(
      h,
      "PUT",
      `/api/screen/devices/${device}/assignment`,
      as("admin", { zone_key: "main" }),
    );
    await put({ bundle_version: "0.9.0", theme_revision: 3 });
    const state = await call(h, "GET", "/api/screen/device/state", {
      host: "alpha.test",
      cookies: { canccu_device: token },
    });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({
      bundle: { version: "0.9.0" },
      theme: { revision: 3, tokens_css_url: "/theming/r/3/tokens.css" },
    });
    await put({ bundle_version: null, theme_revision: null });
    const after = await call(h, "GET", "/api/screen/device/state", {
      host: "alpha.test",
      cookies: { canccu_device: token },
    });
    expect(after.json()).toMatchObject({ bundle: { version: "test" }, theme: { revision: 5 } });
  });
});
