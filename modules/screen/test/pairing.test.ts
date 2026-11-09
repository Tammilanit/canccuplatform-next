import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, OUTSIDE_IP, call, code, harness, setCookie } from "./helpers.js";
import type { Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("pairing", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  async function start(host = "alpha.test", ip?: string, pairingCookie?: string) {
    return call(h, "POST", "/api/screen/pairing", {
      host,
      ...(ip ? { ip } : {}),
      ...(pairingCookie ? { cookies: { canccu_pairing: pairingCookie } } : {}),
    });
  }

  it("gives a venue kiosk an 8-character code and an HttpOnly, Strict pairing cookie", async () => {
    const res = await start("beta.test");
    expect(res.statusCode).toBe(201);
    const body = res.json<{ code: string; poll_seconds: number; expires_at: string }>();
    expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(body.poll_seconds).toBe(2);
    expect(Date.parse(body.expires_at) - h.clock.now).toBe(10 * 60_000);
    const header = String(res.headers["set-cookie"]);
    expect(header).toMatch(
      /^canccu_pairing=pr_[^;]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Strict$/,
    );
    // A reload with the cookie gets the same code back, so it uses up no second one.
    const again = await start("beta.test", undefined, setCookie(res, "canccu_pairing"));
    expect(again.json<{ code: string }>().code).toBe(body.code);
  });

  it("refuses a kiosk outside the venue with what the crew should do, unless the switch is off", async () => {
    const res = await start("alpha.test", OUTSIDE_IP);
    expect(res.statusCode).toBe(403);
    expect(code(res)).toBe("venue_ip_refused");
    expect(res.json<{ error: { message: string } }>().error.message).toMatch(/emergency switch/);
    expect((await start("eps.test", OUTSIDE_IP)).statusCode).toBe(201);
  });

  it("refuses archived events and events without a venue", async () => {
    expect(code(await start("gamma.test"))).toBe("event_archived");
    expect(code(await start("delta.test"))).toBe("no_venue");
  });

  it("holds at most 3 open codes per address and 10 per event, until they expire", async () => {
    for (let i = 0; i < 3; i++) expect((await start("eps.test", "10.9.0.1")).statusCode).toBe(201);
    const fourth = await start("eps.test", "10.9.0.1");
    expect([fourth.statusCode, code(fourth)]).toEqual([429, "rate_limited"]);
    for (let i = 2; i <= 7; i++)
      expect((await start("eps.test", `10.9.0.${i}`)).statusCode).toBe(201);
    // The earlier test's code makes 10 for eps.
    expect((await start("eps.test", "10.9.0.8")).statusCode).toBe(429);
    h.clock.now += 10 * 60_000 + 1;
    expect((await start("eps.test", "10.9.0.1")).statusCode).toBe(201);
  });

  it("pairs end to end: claim by code, then the kiosk collects its device cookie", async () => {
    const res = await start();
    const { pairing_id, code: shown } = res.json<{ pairing_id: string; code: string }>();
    const pairingCookie = setCookie(res, "canccu_pairing") ?? "";
    const poll = () =>
      call(h, "GET", `/api/screen/pairing/${pairing_id}`, {
        cookies: { canccu_pairing: pairingCookie },
      });
    expect((await poll()).json()).toEqual({ status: "waiting" });

    const claim = await call(h, "POST", "/api/screen/devices", {
      session: "admin",
      body: { code: shown.toLowerCase(), name: " Hall left " },
    });
    expect(claim.statusCode).toBe(201);
    const device = claim.json<{ id: string; name: string; zone_key: null; paired_at: string }>();
    expect(device).toMatchObject({ name: "Hall left", zone_key: null, mirror_of: null });
    expect(h.audits.at(-1)).toMatchObject({
      tenant_id: "alpha",
      action: "screen.device.paired",
      actor_user_id: "u_admin",
    });
    const event = h.store.calls.at(-1);
    expect(event?.stream).toBe("t:alpha:events:screen");
    expect(JSON.parse(event?.fields.event ?? "{}")).toMatchObject({
      type: "screen.device.paired",
      data: { device_id: device.id, zone_key: null },
    });

    const collected = await poll();
    expect(collected.json()).toMatchObject({ status: "paired", device: { id: device.id } });
    const header = [collected.headers["set-cookie"] ?? []].flat().join("\n");
    expect(header).toMatch(
      /canccu_device=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=34560000; HttpOnly; Secure; SameSite=Strict/,
    );
    expect(header).toMatch(/canccu_pairing=; Path=\/; Max-Age=0/);
    const token = setCookie(collected, "canccu_device") ?? "";
    const { rows } = await h.pool.query<{ token_hash: string }>(
      "SELECT token_hash FROM devices WHERE id = $1",
      [device.id],
    );
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.token_hash).not.toContain(token);

    const reuse = await call(h, "POST", "/api/screen/devices", {
      session: "admin",
      body: { code: shown, name: "x" },
    });
    expect(code(reuse)).toBe("code_invalid");
  });

  it("lets only the browser that asked poll its pairing", async () => {
    const res = await start();
    const { pairing_id } = res.json<{ pairing_id: string }>();
    const forged = `${pairing_id}.not-the-secret`;
    for (const cookies of [{}, { canccu_pairing: forged }]) {
      expect(
        (await call(h, "GET", `/api/screen/pairing/${pairing_id}`, { cookies })).statusCode,
      ).toBe(404);
    }
  });

  it("needs sign-in and screen.devices.pair to claim, and a known zone", async () => {
    const { code: shown } = (await start()).json<{ code: string }>();
    const body = { code: shown, name: "Bar" };
    expect(code(await call(h, "POST", "/api/screen/devices", { body }))).toBe("not_signed_in");
    expect(code(await call(h, "POST", "/api/screen/devices", { session: "crew", body }))).toBe(
      "missing_right",
    );
    const zoned = await call(h, "POST", "/api/screen/devices", {
      session: "admin",
      body: { ...body, zone_key: "nowhere" },
    });
    expect(code(zoned)).toBe("unknown_zone");
    const restricted = await call(h, "POST", "/api/screen/devices", {
      host: "zeta.test",
      ip: OUTSIDE_IP,
      session: "admin",
      body,
    });
    expect(code(restricted)).toBe("admin_access_restricted");
  });

  it("expires codes after 10 minutes and clears every open code on request", async () => {
    const first = await start();
    const { pairing_id, code: old } = first.json<{ pairing_id: string; code: string }>();
    h.clock.now += 10 * 60_000;
    const late = await call(h, "GET", `/api/screen/pairing/${pairing_id}`, {
      cookies: { canccu_pairing: setCookie(first, "canccu_pairing") ?? "" },
    });
    expect(late.json()).toEqual({ status: "expired" });
    expect(
      code(
        await call(h, "POST", "/api/screen/devices", {
          session: "admin",
          body: { code: old, name: "x" },
        }),
      ),
    ).toBe("code_invalid");

    const { code: open } = (await start()).json<{ code: string }>();
    expect((await call(h, "DELETE", "/api/screen/pairing", { session: "crew" })).statusCode).toBe(
      403,
    );
    expect((await call(h, "DELETE", "/api/screen/pairing", { session: "admin" })).statusCode).toBe(
      204,
    );
    expect(
      code(
        await call(h, "POST", "/api/screen/devices", {
          session: "admin",
          body: { code: open, name: "x" },
        }),
      ),
    ).toBe("code_invalid");
  });

  it("lets a kiosk that reloads between the claim and its next poll still collect", async () => {
    const res = await start();
    const { pairing_id, code: shown } = res.json<{ pairing_id: string; code: string }>();
    const pairingCookie = setCookie(res, "canccu_pairing") ?? "";
    await call(h, "POST", "/api/screen/devices", {
      session: "admin",
      body: { code: shown, name: "Reload" },
    });
    const reloaded = await start("alpha.test", undefined, pairingCookie);
    expect(reloaded.json<{ pairing_id: string }>().pairing_id).toBe(pairing_id);
    const poll = await call(h, "GET", `/api/screen/pairing/${pairing_id}`, {
      cookies: { canccu_pairing: pairingCookie },
    });
    expect(poll.json()).toMatchObject({ status: "paired" });
  });

  it("gives the code back when a claim fails, so the retry pairs", async () => {
    const { code: shown } = (await start()).json<{ code: string }>();
    const before = (await h.pool.query("SELECT count(*)::int AS n FROM devices")).rows[0] as {
      n: number;
    };
    h.failAudit.next = true;
    const failed = await call(h, "POST", "/api/screen/devices", {
      session: "admin",
      body: { code: shown, name: "Retry" },
    });
    expect([failed.statusCode, code(failed)]).toEqual([503, "tenants_unavailable"]);
    const after = (await h.pool.query("SELECT count(*)::int AS n FROM devices")).rows[0] as {
      n: number;
    };
    expect(after.n).toBe(before.n);
    const retry = await call(h, "POST", "/api/screen/devices", {
      session: "admin",
      body: { code: shown, name: "Retry" },
    });
    expect(retry.statusCode).toBe(201);
  });

  it("lets the same browser collect again when its answer was lost, for a minute only", async () => {
    const res = await start();
    const { pairing_id, code: shown } = res.json<{ pairing_id: string; code: string }>();
    const pairingCookie = setCookie(res, "canccu_pairing") ?? "";
    await call(h, "POST", "/api/screen/devices", {
      session: "admin",
      body: { code: shown, name: "Lost" },
    });
    const poll = () =>
      call(h, "GET", `/api/screen/pairing/${pairing_id}`, {
        cookies: { canccu_pairing: pairingCookie },
      });
    const first = setCookie(await poll(), "canccu_device") ?? "";
    const again = await poll();
    expect(again.json()).toMatchObject({ status: "paired" });
    const second = setCookie(again, "canccu_device") ?? "";
    expect(second).not.toBe(first);
    // The first token was replaced, never both valid at once.
    const probe = (token: string) =>
      call(h, "GET", "/api/screen/device/_probe", { cookies: { canccu_device: token } });
    expect(code(await probe(first))).toBe("device_unknown");
    expect((await probe(second)).statusCode).toBe(200);
    h.clock.now += 60_001;
    expect((await poll()).statusCode).toBe(404);
  });
});
