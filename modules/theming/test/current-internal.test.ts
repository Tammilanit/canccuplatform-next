/** The screens' read of the current theme (contracts/theming.md, Reading the current theme). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DATABASE_URL,
  OUTSIDE_IP,
  VENUE_IP,
  caller,
  code,
  get,
  harness,
  seedRevision,
} from "./helpers.js";
import type { Call, Harness } from "./helpers.js";

describe.skipIf(!DATABASE_URL)("GET /internal/theming/current", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
    await seedRevision(h, "alpha", 1, { colors: { accent: "#fbbf24" } });
    await seedRevision(h, "venue", 1, { colors: { accent: "#a3e635" } });
    await seedRevision(h, "closed", 1, { colors: { accent: "#22d3ee" } });
  });
  afterAll(async () => {
    await h.close();
  });

  const internal = (query: string, headers: Record<string, string> = caller("screen")) =>
    h.app.inject({
      method: "GET",
      url: `/internal/theming/current${query}`,
      headers: { host: "theming:8080", ...headers },
    });

  // Per info-page mode: a caller the mode lets in, and what the screens must get regardless.
  const modes: { mode: string; tenant: string; host: string; admitted: Call }[] = [
    { mode: "public", tenant: "alpha", host: "alpha.test", admitted: { ip: OUTSIDE_IP } },
    { mode: "venue_only", tenant: "venue", host: "venue.test", admitted: { ip: VENUE_IP } },
    {
      mode: "sign_in",
      tenant: "closed",
      host: "closed.test",
      admitted: { ip: OUTSIDE_IP, session: "member" },
    },
  ];

  for (const { mode, tenant, host, admitted } of modes) {
    it(`answers what the public read gives whom ${mode} lets in`, async () => {
      const guest = await get(h, "/api/theming/current", { host, ...admitted });
      expect(guest.statusCode).toBe(200);
      const res = await internal(`?tenant_id=${tenant}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(guest.json());
      expect(res.json()).toMatchObject({ revision: 1 });
    });
  }

  it("is the only way in for the screens where the mode keeps a guest out", async () => {
    for (const tenant of ["venue", "closed"]) {
      const guest = await get(h, "/api/theming/current", {
        host: `${tenant}.test`,
        ip: OUTSIDE_IP,
      });
      expect(code(guest)).toBe("info_pages_closed");
      expect((await internal(`?tenant_id=${tenant}`)).statusCode).toBe(200);
    }
  });

  it("answers revision 0 without a published theme, as the public read does", async () => {
    const guest = await get(h, "/api/theming/current", { host: "beta.test", ip: OUTSIDE_IP });
    const res = await internal("?tenant_id=beta");
    expect(res.json()).toMatchObject({ revision: 0 });
    expect(res.json()).toEqual(guest.json());
  });

  it("is never served from a cache without asking again", async () => {
    const res = await internal("?tenant_id=alpha");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("answers the highest revision of the named event only", async () => {
    expect((await internal("?tenant_id=closed")).json()).toMatchObject({
      revision: 1,
      tokens: { colors: { accent: "#22d3ee" } },
    });
    expect((await internal("?tenant_id=beta")).json()).toMatchObject({ revision: 0 });
  });

  it("answers for every status of the event", async () => {
    expect((await internal("?tenant_id=archived")).statusCode).toBe(200);
  });

  it("needs the screen module's identity, a valid tenant_id and a known event", async () => {
    const anon = await internal("?tenant_id=alpha", {});
    expect(anon.statusCode).toBe(401);
    expect(code(anon)).toBe("service_unauthenticated");
    const bot = await internal("?tenant_id=alpha", caller("bot"));
    expect(bot.statusCode).toBe(403);
    expect(code(bot)).toBe("service_forbidden");
    for (const query of ["", "?tenant_id=", "?tenant_id=Not%20An%20Id"]) {
      const res = await internal(query);
      expect(res.statusCode).toBe(400);
      expect(code(res)).toBe("invalid_request");
    }
    const unknown = await internal("?tenant_id=nobody");
    expect(unknown.statusCode).toBe(404);
    expect(code(unknown)).toBe("not_found");
  });
});
