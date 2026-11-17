// Timed pins and freeze over HTTP on Postgres (contracts/screen.md, Timed pins and freeze): the
// freeze form, ending early, and the restore at `until` by the tick.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withTenant } from "@canccu/kit";
import { readPin } from "../src/pins/store.js";
import { DATABASE_URL, code } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { DAY, NOON, iso, pinsHarness, theme } from "./pins-kit.js";
import type { Pins } from "./pins-kit.js";

describe.skipIf(!DATABASE_URL)("timed pins and freeze", () => {
  let h: Harness;
  let tick: Pins["tick"];
  let changes: Pins["changes"];
  let pin: Pins["pin"];
  let put: Pins["put"];
  let commands: Pins["commands"];
  let reset: Pins["reset"];

  beforeAll(async () => {
    ({ h, tick, changes, pin, put, commands, reset } = await pinsHarness());
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await reset();
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

  it("keeps the pin past until while theming fails to read the revision, and restores it later", async () => {
    await put({ bundle_version: null, theme_revision: 3 });
    const until = NOON + 2 * DAY + 10_000;
    await put({ freeze: true, until: iso(until) });
    // A 500 or a timeout on the revision while the current theme still answers.
    h.sources.revisionsDown = true;
    h.clock.now = until;
    await tick();
    expect(await pin()).toMatchObject({
      until: iso(until),
      restores: { bundle_version: null, theme_revision: 3 },
    });
    expect(changes().at(-1)).not.toMatchObject({ reason: "expired" });
    h.sources.revisionsDown = false;
    h.clock.now = until + 1000;
    await tick();
    expect(await pin()).toMatchObject({ theme_revision: 3, until: null, restores: null });
    expect(changes().at(-1)).toMatchObject({ reason: "expired", theme_revision: 3 });
  });

  it("queues the reload only once the change is committed, from the PUT and from the tick", async () => {
    // A screen reloads on the nudge at once: what it then reads is the pin it loads.
    const seen: (string | null)[] = [];
    const addExpiring = h.kv.addExpiring.bind(h.kv);
    h.kv.addExpiring = async (key, member, expiresAtMs) => {
      if (key.includes("commands")) {
        seen.push((await withTenant("alpha", () => h.db.tenant(readPin))).bundle_version);
      }
      return addExpiring(key, member, expiresAtMs);
    };
    try {
      // A second no other test ticks in: their tick claims are still held in the shared Valkey.
      const end = NOON + 2 * DAY + 3600_000;
      await put({ bundle_version: "0.9.0", theme_revision: null, until: iso(end) });
      h.clock.now = end;
      await tick();
    } finally {
      h.kv.addExpiring = addExpiring;
    }
    expect(seen).toEqual(["0.9.0", null]);
  });
});
