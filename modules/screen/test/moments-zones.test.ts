/**
 * The event's zone names for Moments (contracts/screen.md, For Moments; #638): Moments' pages say
 * "Main hall", not `main`, so Screen lists each zone's key and name to Moments' service identity.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ServiceIdentity } from "@canccu/kit";
import { DATABASE_URL, SERVICE_KEY, call, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("the event's zone names for Moments", () => {
  let h: Harness;
  const moments = new ServiceIdentity({ module: "moments", key: SERVICE_KEY });
  const internal = (url: string, signed = true) =>
    h.app.inject({
      method: "GET",
      url,
      headers: { host: "screen:8080", ...(signed ? moments.headers("screen") : {}) },
    });

  beforeAll(async () => {
    h = await harness();
    await call(h, "POST", "/api/screen/zones", {
      host: "alpha.test",
      session: "admin",
      body: { key: "hall", name: "Main hall" },
    });
  });
  afterAll(async () => {
    await h.close();
  });

  it("lists each zone's key and name", async () => {
    const r = await internal("/internal/screen/zones?tenant_id=alpha");
    expect(r.statusCode).toBe(200);
    const { zones } = r.json<{ zones: { key: string; name: string }[] }>();
    expect(zones).toContainEqual({ key: "hall", name: "Main hall" });
  });

  it("answers only Moments' service identity, and 404 for an event it does not know", async () => {
    expect((await internal("/internal/screen/zones?tenant_id=alpha", false)).statusCode).toBe(401);
    expect((await internal("/internal/screen/zones?tenant_id=zzz")).statusCode).toBe(404);
  });
});
