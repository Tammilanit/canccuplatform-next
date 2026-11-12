// The event's pins over HTTP on Postgres (contracts/screen.md, Pins and Timed pins and freeze):
// rights, the values and their checks, the freeze form, ending early, the restore at `until` by
// the tick, the audit, `screen.pin.changed` and the `reload` every screen of the event gets.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import { takeCommands } from "../src/assignments.js";
import type { ThemeNow } from "../src/compose/sources.js";
import { BundleStore, bundlesDir } from "../src/pins/bundles.js";
import { pinTickRunner } from "../src/pins/tick.js";
import { DATABASE_URL, TENANTS, call, code, events, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

const as = (session: string, body?: unknown, host = "alpha.test") => ({ host, session, body });
const DAY = 24 * 3600_000;
// The harness's clock starts at 2026-01-01T12:00:00Z.
const NOON = Date.parse("2026-01-01T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const theme = (revision: number): ThemeNow => ({
  revision,
  tokens_css_url: `/theming/r/${revision}/tokens.css`,
  css_url: null,
  logo_url: null,
  layouts: [],
  templates: [],
});

describe.skipIf(!DATABASE_URL)("pins", () => {
  let h: Harness;
  let tick: () => Promise<void>;
  let device: string;
  let token: string;
  const changes = (tenant = "alpha") => events(h, "screen.pin.changed", tenant);
  const pin = async (session = "admin", host = "alpha.test") =>
    (await call(h, "GET", "/api/screen/pin", as(session, undefined, host))).json<
      Record<string, unknown>
    >();
  const put = (body: unknown, session = "admin", host = "alpha.test") =>
    call(h, "PUT", "/api/screen/pin", as(session, body, host));
  const commands = () =>
    withTenant("alpha", () => takeCommands(h.kv, device, h.clock.now)).then((list) =>
      list.map((c) => c.command),
    );
  const oldBundle = async (version: string) => {
    const dir = join(bundlesDir(h.filesRoot), version);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "player.js"), `/* ${version} */\n`);
    await writeFile(join(dir, "player.css"), "body {}\n");
  };

  beforeAll(async () => {
    h = await harness();
    ({ id: device, token } = await pairDevice(h));
    await oldBundle("0.9.0");
    h.sources.theme = theme(5);
    h.sources.revisions = { 3: theme(3), 4: theme(4), 5: theme(5) };
    h.publicEvents["alpha.test"] = {
      id: "alpha",
      status: "live",
      ends_at: iso(NOON + 3 * DAY),
    };
    tick = pinTickRunner({
      db: h.db,
      kv: h.kv,
      bus: h.bus,
      audit: (entry) => {
        h.audits.push(entry);
        return Promise.resolve();
      },
      sources: {
        theme: () => Promise.resolve(h.sources.theme),
        themeRevision: (_t, n) => Promise.resolve(h.sources.revisions[n] ?? null),
      },
      bundles: new BundleStore({
        dir: bundlesDir(h.filesRoot),
        current: "test",
        playerDir: h.playerDir,
      }),
      fanout: { publish: () => Promise.resolve() },
      tenantById: (id) =>
        Promise.resolve(Object.values(TENANTS).find((t) => t.tenant_id === id) ?? null),
      now: () => h.clock.now,
    });
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    h.clock.now = NOON;
    // Each test starts unpinned, with no command waiting.
    await put({ bundle_version: null, theme_revision: null });
    await commands();
    h.audits.length = 0;
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

  it("freezes what screens draw now, keeping the pin before it to restore", async () => {
    await put({ bundle_version: null, theme_revision: 4 });
    h.audits.length = 0;
    const until = iso(NOON + 3 * DAY);
    const res = await put({ freeze: true, until });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      bundle_version: "test",
      theme_revision: 4,
      until,
      restores: { bundle_version: null, theme_revision: 4 },
      changed_by: "u_admin",
    });
    expect(changes().at(-1)).toEqual({
      bundle_version: "test",
      theme_revision: 4,
      until,
      restores: { bundle_version: null, theme_revision: 4 },
      reason: "set",
      actor_user_id: "u_admin",
    });
    expect(h.audits.map((a) => a.action)).toEqual(["screen.pin.set"]);
    // A freeze during a freeze replaces it and keeps the first restores.
    h.sources.theme = theme(5);
    const again = await put({ freeze: true, until: iso(NOON + 2 * DAY) });
    expect(again.json()).toMatchObject({
      bundle_version: "test",
      theme_revision: 4,
      restores: { bundle_version: null, theme_revision: 4 },
    });
  });

  it("freezes only the bundle while the event has no published revision", async () => {
    h.sources.theme = theme(0);
    const res = await put({ freeze: true, until: iso(NOON + DAY) });
    expect(res.json()).toMatchObject({
      bundle_version: "test",
      theme_revision: null,
      restores: { bundle_version: null, theme_revision: null },
      in_effect: { bundle_version: "test", theme_revision: 0 },
    });
    h.sources.theme = theme(5);
  });

  it("refuses to freeze while theming cannot say which revision screens draw", async () => {
    h.sources.theme = null;
    const res = await put({ freeze: true, until: iso(NOON + DAY) });
    expect(res.statusCode).toBe(503);
    expect(code(res)).toBe("theming_unavailable");
    h.sources.theme = theme(5);
  });

  it("ends a freeze early, and changes nothing when there is none", async () => {
    await put({ bundle_version: "0.9.0", theme_revision: null });
    await put({ freeze: true, until: iso(NOON + DAY) });
    await commands();
    h.audits.length = 0;
    const res = await put({ freeze: false }, "bundler");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      bundle_version: "0.9.0",
      theme_revision: null,
      until: null,
      restores: null,
      changed_by: "u_bundler",
    });
    expect(changes().at(-1)).toMatchObject({ reason: "cleared", actor_user_id: "u_bundler" });
    expect(h.audits.map((a) => a.action)).toEqual(["screen.pin.cleared"]);
    expect(await commands()).toEqual(["reload"]);
    const count = changes().length;
    const none = await put({ freeze: false });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toMatchObject({ bundle_version: "0.9.0", until: null });
    expect(changes().length).toBe(count);
    expect(h.audits.length).toBe(1);
    expect(await commands()).toEqual([]);
  });

  it("drops the restore when a plain pin replaces a freeze", async () => {
    await put({ bundle_version: "0.9.0", theme_revision: null });
    await put({ freeze: true, until: iso(NOON + DAY) });
    const res = await put({ bundle_version: null, theme_revision: null });
    expect(res.json()).toMatchObject({ bundle_version: null, until: null, restores: null });
    expect(changes().at(-1)).toMatchObject({ reason: "cleared", restores: null });
  });

  it("puts the pin before a freeze back at until, by the tick, without an actor", async () => {
    await put({ bundle_version: null, theme_revision: 3 });
    await put({ freeze: true, until: iso(NOON + DAY) });
    await commands();
    h.audits.length = 0;
    h.clock.now = NOON + DAY - 1000;
    await tick();
    expect(await pin()).toMatchObject({ until: iso(NOON + DAY) });
    h.clock.now = NOON + DAY;
    await tick();
    expect(await pin()).toMatchObject({
      bundle_version: null,
      theme_revision: 3,
      until: null,
      restores: null,
      changed_by: null,
      changed_at: iso(NOON + DAY),
    });
    expect(changes().at(-1)).toEqual({
      bundle_version: null,
      theme_revision: 3,
      until: null,
      restores: null,
      reason: "expired",
      actor_user_id: null,
    });
    expect(h.audits).toEqual([
      expect.objectContaining({ action: "screen.pin.expired", tenant_id: "alpha" }),
    ]);
    expect(h.audits[0]?.actor_user_id).toBeNull();
    expect(await commands()).toEqual(["reload"]);
    // Once only.
    h.clock.now = NOON + DAY + 1000;
    await tick();
    expect(h.audits.length).toBe(1);
  });

  it("clears the pin at until when what it restores no longer exists", async () => {
    await put({ bundle_version: null, theme_revision: 3 });
    // A later second than the test before, whose tick claimed its own seconds.
    await put({ freeze: true, until: iso(NOON + 2 * DAY) });
    delete h.sources.revisions[3];
    h.clock.now = NOON + 2 * DAY;
    await tick();
    expect(await pin()).toMatchObject({ bundle_version: null, theme_revision: null, until: null });
    expect(changes().at(-1)).toMatchObject({ reason: "expired", theme_revision: null });
    h.sources.revisions[3] = theme(3);
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
