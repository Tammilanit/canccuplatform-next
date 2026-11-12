/**
 * The actions Studio essentials offer are audited (#394, contracts/screen.md, Audit): clearing the
 * open pairing codes, device commands, zone writes and the ticker line. Each entry is appended in
 * the request, and a change the audit log refuses does not happen.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DATABASE_URL, call, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("studio essentials audit", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(() => {
    h.audits.length = 0;
  });

  const admin = { session: "admin" };
  const actions = () => h.audits.map((a) => a.action);

  it("audits clearing the open pairing codes, and keeps them when the log is down", async () => {
    await call(h, "POST", "/api/screen/pairing", {});
    h.failAudit.next = true;
    expect((await call(h, "DELETE", "/api/screen/pairing", admin)).statusCode).toBe(503);
    // The second clear still finds the code: the refused one removed nothing.
    expect((await call(h, "DELETE", "/api/screen/pairing", admin)).statusCode).toBe(204);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: "screen.pairing.cleared",
        actor_user_id: "u_admin",
        changes: { open_codes: { from: 1, to: 0 } },
      }),
    ]);
  });

  it("audits identify and reload; a refused audit queues no command", async () => {
    const { id } = await pairDevice(h);
    h.audits.length = 0;
    const send = (command: string) =>
      call(h, "POST", `/api/screen/devices/${id}/commands`, { ...admin, body: { command } });
    h.failAudit.next = true;
    expect((await send("reload")).statusCode).toBe(503);
    expect((await send("identify")).statusCode).toBe(202);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: "screen.device.command_sent",
        target: { type: "device", id },
        changes: { command: { from: null, to: "identify" } },
      }),
    ]);
  });

  it("audits zone create, change and delete, with what changed", async () => {
    const zone = {
      key: "cafe",
      name: "Café",
      layout_id: null,
      regions: {},
      header: null,
      hub_qr: "always",
      sound: { enabled: true, device_id: null },
    };
    expect((await call(h, "POST", "/api/screen/zones", { ...admin, body: zone })).statusCode).toBe(
      201,
    );
    const put = await call(h, "PUT", "/api/screen/zones/cafe", {
      ...admin,
      body: { ...zone, name: "Café bar", hub_qr: "rotate", revision: 1 },
    });
    expect(put.statusCode).toBe(200);
    // An unchanged save changes nothing and records nothing.
    await call(h, "PUT", "/api/screen/zones/cafe", {
      ...admin,
      body: { ...zone, name: "Café bar", hub_qr: "rotate", revision: 2 },
    });
    expect((await call(h, "DELETE", "/api/screen/zones/cafe", admin)).statusCode).toBe(204);
    expect(actions()).toEqual([
      "screen.zone.created",
      "screen.zone.changed",
      "screen.zone.deleted",
    ]);
    expect(h.audits[1]?.changes).toEqual({
      name: { from: "Café", to: "Café bar" },
      hub_qr: { from: "always", to: "rotate" },
    });
  });

  it("rolls a zone write back when the audit log is down", async () => {
    h.failAudit.next = true;
    const res = await call(h, "POST", "/api/screen/zones", {
      ...admin,
      body: { key: "stage", name: "Stage" },
    });
    expect(res.statusCode).toBe(503);
    expect((await call(h, "GET", "/api/screen/zones/stage", admin)).statusCode).toBe(404);
  });

  it("audits setting and clearing the ticker line; clearing an empty line records nothing", async () => {
    const until = new Date(h.clock.now + 3600_000).toISOString();
    const set = await call(h, "PUT", "/api/screen/ticker", {
      session: "ticker",
      body: { text: "Doors close at 23", until },
    });
    expect(set.statusCode).toBe(200);
    expect((await call(h, "DELETE", "/api/screen/ticker", { session: "ticker" })).statusCode).toBe(
      204,
    );
    expect((await call(h, "DELETE", "/api/screen/ticker", { session: "ticker" })).statusCode).toBe(
      204,
    );
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: "screen.ticker.set",
        actor_user_id: "u_ticker",
        changes: {
          text: { from: null, to: "Doors close at 23" },
          until: { from: null, to: until },
        },
      }),
      expect.objectContaining({
        action: "screen.ticker.cleared",
        changes: { text: { from: "Doors close at 23", to: null } },
      }),
    ]);
  });

  it("keeps the line when the audit log refuses the change", async () => {
    h.failAudit.next = true;
    const res = await call(h, "PUT", "/api/screen/ticker", {
      session: "ticker",
      body: { text: "Never shown", until: null },
    });
    expect(res.statusCode).toBe(503);
    const now = (await call(h, "GET", "/api/screen/ticker", { session: "ticker" })).json<{
      text: string | null;
    }>();
    expect(now.text).not.toBe("Never shown");
  });
});
