// What the pin reports and announces (#545; contracts/screen.md, Pins and Timed pins and freeze):
// a PUT that changes nothing stays silent, a pinned bundle that is no longer kept is reported as
// the platform's (what screens draw), ending a freeze early checks its restore as `until` would,
// and `screen.pin.changed` survives a bus that is down at the time, through the outbox.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Outbox, withTenant } from "@canccu/kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { takeCommands } from "../src/assignments.js";
import type { ThemeNow } from "../src/compose/sources.js";
import { bundlesDir } from "../src/pins/bundles.js";
import { DATABASE_URL, call, code, events, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

const as = (session: string, body?: unknown) => ({ host: "alpha.test", session, body });
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

describe.skipIf(!DATABASE_URL)("what the pin reports", () => {
  let h: Harness;
  let zoned: { id: string; token: string };
  let loose: { id: string; token: string };
  const changes = () => events(h, "screen.pin.changed");
  const pin = async () =>
    (await call(h, "GET", "/api/screen/pin", as("admin"))).json<Record<string, unknown>>();
  const put = (body: unknown, session = "admin") =>
    call(h, "PUT", "/api/screen/pin", as(session, body));
  const commands = (device: string) =>
    withTenant("alpha", () => takeCommands(h.kv, device, h.clock.now)).then((list) =>
      list.map((c) => c.command),
    );
  const stateOf = async (device: { token: string }) =>
    (
      await call(h, "GET", "/api/screen/device/state", {
        host: "alpha.test",
        cookies: { canccu_device: device.token },
      })
    ).json<{ bundle: { version: string } }>();
  const keepBundle = async (version: string) => {
    const dir = join(bundlesDir(h.filesRoot), version);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "player.js"), `/* ${version} */\n`);
    await writeFile(join(dir, "player.css"), "body {}\n");
  };

  beforeAll(async () => {
    h = await harness();
    zoned = await pairDevice(h, "alpha.test", "Hall left");
    loose = await pairDevice(h, "alpha.test", "Bar");
    await call(h, "GET", "/api/screen/zones", as("admin"));
    await call(
      h,
      "PUT",
      `/api/screen/devices/${zoned.id}/assignment`,
      as("admin", { zone_key: "main" }),
    );
    await keepBundle("0.9.0");
    h.sources.theme = theme(5);
    h.sources.revisions = { 3: theme(3), 5: theme(5) };
    h.publicEvents["alpha.test"] = { id: "alpha", status: "live", ends_at: iso(NOON + 3 * DAY) };
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    h.clock.now = NOON;
    await put({ bundle_version: null, theme_revision: null });
    await commands(zoned.id);
    h.audits.length = 0;
  });

  it("answers a values PUT that changes nothing as it is: no audit, event or reload", async () => {
    const body = { bundle_version: "0.9.0", theme_revision: 3, until: iso(NOON + DAY) };
    await put(body);
    await commands(zoned.id);
    h.audits.length = 0;
    const count = changes().length;
    const same = await put(body, "bundler");
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ ...body, changed_by: "u_admin" });
    expect(changes()).toHaveLength(count);
    expect(h.audits).toEqual([]);
    expect(await commands(zoned.id)).toEqual([]);
  });

  it("reports the platform's bundle, as screens draw it, while the pinned one is not kept", async () => {
    await put({ bundle_version: "0.9.0", theme_revision: 3, until: iso(NOON + DAY) });
    await rm(join(bundlesDir(h.filesRoot), "0.9.0"), { recursive: true });
    try {
      expect(await pin()).toMatchObject({
        bundle_version: "0.9.0",
        in_effect: { bundle_version: "test", theme_revision: 3 },
      });
      expect((await stateOf(zoned)).bundle.version).toBe("test");
      expect((await stateOf(loose)).bundle.version).toBe("test");
      // The banner holds only what is held: the theme.
      const page = (await call(h, "GET", "/admin/screen/devices", as("admin"))).body;
      expect(page).toContain("Theme revision 3 is held until");
      expect(page).not.toContain("Bundle 0.9.0");
    } finally {
      await keepBundle("0.9.0");
    }
  });

  it("ends a freeze early as until would: a restore whose revision is gone clears the pin", async () => {
    await put({ bundle_version: null, theme_revision: 3 });
    await put({ freeze: true, until: iso(NOON + DAY) });
    delete h.sources.revisions[3];
    try {
      const res = await put({ freeze: false }, "bundler");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        bundle_version: null,
        theme_revision: null,
        until: null,
        restores: null,
      });
      expect(changes().at(-1)).toMatchObject({
        theme_revision: null,
        reason: "cleared",
        actor_user_id: "u_bundler",
      });
    } finally {
      h.sources.revisions[3] = theme(3);
    }
  });

  it("keeps a freeze while theming cannot say whether its restore exists", async () => {
    await put({ bundle_version: null, theme_revision: 3 });
    await put({ freeze: true, until: iso(NOON + DAY) });
    h.sources.revisionsDown = true;
    try {
      const res = await put({ freeze: false });
      expect(res.statusCode).toBe(503);
      expect(code(res)).toBe("theming_unavailable");
    } finally {
      h.sources.revisionsDown = false;
    }
    expect(await pin()).toMatchObject({ until: iso(NOON + DAY) });
  });

  it("announces a change made while the bus is down once it is back, through the outbox", async () => {
    const count = changes().length;
    const xadd = h.store.xadd.bind(h.store);
    h.store.xadd = () => Promise.reject(new Error("valkey unreachable"));
    let res;
    try {
      res = await put({ bundle_version: "0.9.0", theme_revision: null });
    } finally {
      h.store.xadd = xadd;
    }
    // Committed, so the caller succeeded; its screens reload all the same.
    expect(res.statusCode).toBe(200);
    expect(await commands(zoned.id)).toEqual(["reload"]);
    expect(changes()).toHaveLength(count);
    expect(await new Outbox(h.bus, h.db).flushAll()).toBe(1);
    expect(changes().slice(count)).toEqual([
      expect.objectContaining({ bundle_version: "0.9.0", reason: "set" }),
    ]);
  });
});
