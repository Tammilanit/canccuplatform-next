import { hashDeviceToken, newDeviceToken, withTenant } from "@canccu/kit";
import type { FastifyReply, FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db.js";
import { requireDevice } from "../src/device-access.js";
import { DATABASE_URL, OUTSIDE_IP, call, code, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { TENANTS } from "./tenants.js";

describe.skipIf(!DATABASE_URL)("devices", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  const probe = (token: string, extra: { host?: string; ip?: string } = {}) =>
    call(h, "GET", "/api/screen/device/_probe", { ...extra, cookies: { canccu_device: token } });

  it("lists, renames (audited) and revokes the event's devices", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Stage");
    const list = await call(h, "GET", "/api/screen/devices", { session: "crew" });
    expect(list.json<{ devices: { id: string }[] }>().devices.map((d) => d.id)).toContain(id);

    expect(
      (
        await call(h, "PATCH", `/api/screen/devices/${id}`, {
          session: "crew",
          body: { name: "x" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      code(
        await call(h, "PATCH", `/api/screen/devices/${id}`, {
          session: "admin",
          body: { name: "" },
        }),
      ),
    ).toBe("invalid_request");
    const renamed = await call(h, "PATCH", `/api/screen/devices/${id}`, {
      session: "admin",
      body: { name: "Stage left" },
    });
    expect(renamed.json()).toMatchObject({ id, name: "Stage left" });
    expect(h.audits.at(-1)).toMatchObject({
      action: "screen.device.renamed",
      changes: { name: { from: "Stage", to: "Stage left" } },
    });

    expect((await probe(token)).statusCode).toBe(200);
    expect(
      (await call(h, "POST", `/api/screen/devices/${id}/revoke`, { session: "admin" })).statusCode,
    ).toBe(204);
    expect(h.audits.at(-1)).toMatchObject({ action: "screen.device.revoked", target: { id } });
    // The kiosk goes back to pairing at once, and the revoked device is gone from the event.
    expect(code(await probe(token))).toBe("device_unknown");
    expect(
      (
        await call(h, "PATCH", `/api/screen/devices/${id}`, {
          session: "admin",
          body: { name: "y" },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("serves a device only with its token and from the venue, unless the switch is off", async () => {
    const { id, token } = await pairDevice(h);
    expect((await probe(token)).json()).toEqual({ device_id: id });
    expect(code(await probe("not-a-token"))).toBe("device_unknown");
    expect(code(await call(h, "GET", "/api/screen/device/_probe"))).toBe("device_unknown");
    const outside = await probe(token, { ip: OUTSIDE_IP });
    expect([outside.statusCode, code(outside)]).toEqual([403, "venue_ip_refused"]);
    expect(outside.json<{ error: { message: string } }>().error.message).toMatch(/event admin/);

    const { token: epsToken } = await pairDevice(h, "eps.test");
    expect((await probe(epsToken, { host: "eps.test", ip: OUTSIDE_IP })).statusCode).toBe(200);
  });

  it("answers device_moved for another event's device and for a superseded token", async () => {
    const { id, token } = await pairDevice(h);
    // Same venue, another event: the token is valid, the event is not the device's.
    const elsewhere = await probe(token, { host: "beta.test" });
    expect([elsewhere.statusCode, code(elsewhere)]).toEqual([409, "device_moved"]);
    // Only the home path serves it there.
    expect(
      (
        await call(h, "GET", "/api/screen/device/home", {
          host: "beta.test",
          cookies: { canccu_device: token },
        })
      ).statusCode,
    ).toBe(200);

    const old = newDeviceToken();
    const expired = newDeviceToken();
    await h.pool.query("UPDATE devices SET superseded_token_hashes = $2::jsonb WHERE id = $1", [
      id,
      JSON.stringify([
        { hash: hashDeviceToken(old), expires_at: "2999-01-01T00:00:00Z" },
        { hash: hashDeviceToken(expired), expires_at: "2000-01-01T00:00:00Z" },
      ]),
    ]);
    expect(code(await probe(old))).toBe("device_moved");
    expect(code(await probe(expired))).toBe("device_unknown");
    // The new token's first success drops the superseded ones.
    expect((await probe(token)).statusCode).toBe(200);
    expect(code(await probe(old))).toBe("device_unknown");
  });

  it("finds a token in one lookup and drops the superseded hashes in the same transaction", async () => {
    const { id, token } = await pairDevice(h);
    const old = newDeviceToken();
    await h.pool.query("UPDATE devices SET superseded_token_hashes = $2::jsonb WHERE id = $1", [
      id,
      JSON.stringify([{ hash: hashDeviceToken(old), expires_at: "2999-01-01T00:00:00Z" }]),
    ]);
    let transactions = 0;
    let lookups = 0;
    const counted: Db = {
      tenant: (fn) => {
        transactions++;
        return h.db.tenant((c) =>
          fn({
            query: (text, values) => {
              if (/\bFROM devices\b/i.test(text)) lookups++;
              return c.query(text, values);
            },
          }),
        );
      },
      global: (fn) => h.db.global(fn),
    };
    const check = requireDevice(counted, {
      allowElsewhere: true,
      now: () => new Date(h.clock.now),
    });
    const run = async (cookieToken: string) => {
      [transactions, lookups] = [0, 0];
      const request = {
        tenant: TENANTS["alpha.test"],
        ip: "10.0.0.7",
        headers: { cookie: `canccu_device=${cookieToken}` },
      } as unknown as FastifyRequest;
      await withTenant("alpha", () => check.call(h.app, request, {} as FastifyReply));
      return [request.deviceToken, transactions, lookups];
    };
    expect(await run(old)).toEqual(["superseded", 1, 1]);
    expect(await run(token)).toEqual(["current", 1, 1]);
    const { rows } = await h.pool.query(
      "SELECT superseded_token_hashes FROM devices WHERE id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ superseded_token_hashes: [] });
  });

  it("keeps every device path inside its own event (cross-event leak tests)", async () => {
    const { id } = await pairDevice(h, "alpha.test", "Alpha only");
    const betaList = await call(h, "GET", "/api/screen/devices", {
      host: "beta.test",
      session: "admin",
    });
    expect(betaList.json<{ devices: { id: string }[] }>().devices.map((d) => d.id)).not.toContain(
      id,
    );
    for (const [method, path, body] of [
      ["PATCH", `/api/screen/devices/${id}`, { name: "taken" }],
      ["POST", `/api/screen/devices/${id}/revoke`, undefined],
    ] as const) {
      const res = await call(h, method, path, {
        host: "beta.test",
        session: "admin",
        ...(body ? { body } : {}),
      });
      expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
    }
    expect(
      (await call(h, "GET", "/api/screen/devices", { session: "admin" })).json<{
        devices: { id: string; name: string }[];
      }>().devices,
    ).toContainEqual(expect.objectContaining({ id, name: "Alpha only" }));

    // A code shown on alpha's kiosk cannot pair a device into beta, and beta cannot poll it.
    const start = await call(h, "POST", "/api/screen/pairing");
    const { pairing_id, code: shown } = start.json<{ pairing_id: string; code: string }>();
    const claim = await call(h, "POST", "/api/screen/devices", {
      host: "beta.test",
      session: "admin",
      body: { code: shown, name: "x" },
    });
    expect(code(claim)).toBe("code_invalid");
    const pairingCookie = String(start.headers["set-cookie"]).split(";")[0]?.split("=")[1] ?? "";
    const poll = await call(h, "GET", `/api/screen/pairing/${pairing_id}`, {
      host: "beta.test",
      cookies: { canccu_pairing: pairingCookie },
    });
    expect(poll.statusCode).toBe(404);

    // RLS: beta's transactions see none of alpha's assignment rows.
    const { withTenant } = await import("@canccu/kit");
    const seen = await withTenant("beta", () =>
      h.db.tenant(async (c) =>
        (await c.query("SELECT device_id FROM screen_assignments")).rows.map((r) => r.device_id),
      ),
    );
    expect(seen).not.toContain(id);
  });
});
