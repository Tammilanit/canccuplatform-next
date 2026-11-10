import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DATABASE_URL,
  OUTSIDE_IP,
  SUPERADMIN_HOST,
  call,
  code,
  harness,
  pairDevice,
  setCookie,
} from "./helpers.js";
import type { Call, Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("a moved device finds its new home", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });
  afterAll(async () => {
    await h.close();
  });

  const move = (id: string, tenant: string | null) =>
    call(h, "PATCH", `/api/screen/registry/devices/${id}`, {
      host: SUPERADMIN_HOST,
      session: "root",
      body: { current_tenant_id: tenant },
    });
  const home = (token: string, extra: Call = {}) =>
    call(h, "GET", "/api/screen/device/home", { cookies: { canccu_device: token }, ...extra });
  const probe = (token: string, host = "alpha.test") =>
    call(h, "GET", "/api/screen/device/_probe", { host, cookies: { canccu_device: token } });
  const redeem = (transfer: string, extra: Call = {}) =>
    call(h, "POST", "/api/screen/device/transfer", {
      host: "beta.test",
      body: { code: transfer },
      ...extra,
    });
  const transferCode = (url: string | null) =>
    /#transfer=([A-Za-z0-9_-]+)$/.exec(url ?? "")?.[1] ?? "";

  async function movedToBeta(name: string): Promise<{ id: string; token: string }> {
    const device = await pairDevice(h, "alpha.test", name);
    expect((await move(device.id, "beta")).statusCode).toBe(200);
    return device;
  }

  it("sends a moved kiosk to the new event with a one-time transfer code", async () => {
    const { id, token } = await movedToBeta("Kiosk");
    expect(code(await probe(token))).toBe("device_moved");
    const answer = await home(token);
    expect(answer.statusCode).toBe(200);
    const url = answer.json<{ url: string }>().url;
    expect(url).toMatch(/^https:\/\/beta\.test\/screen\/#transfer=[A-Za-z0-9_-]{16,64}$/);

    const redeemed = await redeem(transferCode(url));
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json()).toMatchObject({ id, name: "Kiosk", zone_key: null, mirror_of: null });
    expect(h.audits.at(-1)).toEqual({
      tenant_id: "beta",
      actor_user_id: null,
      action: "screen.device.transferred",
      target: { type: "device", id },
    });
    const fresh = setCookie(redeemed, "canccu_device") ?? "";
    expect(fresh).not.toBe("");
    expect(fresh).not.toBe(token);
    expect(String(redeemed.headers["set-cookie"])).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    // Single use.
    expect(code(await redeem(transferCode(url)))).toBe("code_invalid");

    // The old token is superseded: only the redirect, without a code, and nothing else.
    expect(code(await probe(token, "beta.test"))).toBe("device_moved");
    expect((await home(token)).json()).toEqual({ url: "https://beta.test/screen/" });
    // Once the new token has worked, the old one is gone.
    expect((await probe(fresh, "beta.test")).statusCode).toBe(200);
    expect(code(await home(token))).toBe("device_unknown");
  });

  it("keeps a transfer code inside its event, its venue and its 60 seconds (leak tests)", async () => {
    const { token } = await movedToBeta("Strict");
    const issue = async () => transferCode((await home(token)).json<{ url: string }>().url);

    const late = await issue();
    h.clock.now += 61_000;
    expect(code(await redeem(late))).toBe("code_invalid");

    // Another event's hostname at the same venue does not hold beta's codes.
    const elsewhere = await issue();
    expect(code(await redeem(elsewhere, { host: "alpha.test" }))).toBe("code_invalid");
    expect(code(await redeem(elsewhere, { ip: OUTSIDE_IP }))).toBe("venue_ip_refused");
    expect(code(await redeem(elsewhere, { host: SUPERADMIN_HOST }))).toBe("not_found");
    expect((await redeem(elsewhere)).statusCode).toBe(200);
    for (const bad of ["short", "x".repeat(65), 12]) {
      expect(code(await redeem(bad as string))).toBe("invalid_request");
    }
  });

  it("refuses a code whose token was replaced, and a superseded token any code", async () => {
    const { token } = await movedToBeta("Raced");
    const url = (await home(token)).json<{ url: string }>().url;
    const first = await home(token);
    const fresh = setCookie(
      await redeem(transferCode(first.json<{ url: string }>().url)),
      "canccu_device",
    );
    expect(fresh).toBeDefined();
    // The older code was made for the token that is superseded now.
    expect(code(await redeem(transferCode(url)))).toBe("code_invalid");
    expect((await home(token)).json<{ url: string }>().url).not.toContain("#transfer=");
  });

  it("lets a superseded token lapse after 7 days", async () => {
    const { token } = await movedToBeta("Lapsed");
    await redeem(transferCode((await home(token)).json<{ url: string }>().url));
    h.clock.now += 6 * 24 * 3600_000;
    expect((await home(token)).statusCode).toBe(200);
    h.clock.now += 2 * 24 * 3600_000;
    expect(code(await home(token))).toBe("device_unknown");
  });

  it("answers a parked device with no URL, and serves home only from the venue", async () => {
    const { id, token } = await pairDevice(h, "alpha.test", "Idle");
    expect(code(await home(token, { ip: OUTSIDE_IP }))).toBe("venue_ip_refused");
    expect((await move(id, null)).statusCode).toBe(200);
    expect((await home(token)).json()).toEqual({ url: null });
    expect(code(await probe(token))).toBe("device_moved");
    expect(code(await home("not-a-token"))).toBe("device_unknown");
  });

  it("refuses a code for a device that has moved on before it was redeemed", async () => {
    const { id, token } = await movedToBeta("Twice");
    const url = (await home(token)).json<{ url: string }>().url;
    expect((await move(id, "alpha")).statusCode).toBe(200);
    const res = await redeem(transferCode(url));
    expect([res.statusCode, code(res)]).toEqual([400, "code_invalid"]);
  });
});
