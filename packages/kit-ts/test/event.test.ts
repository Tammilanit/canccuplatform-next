import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantResolver } from "../src/resolve.js";

// A real server: fetch() drops a Host header, so the resolver must send it another way.
const asked: { path: string | undefined; host: string | undefined; cookie?: string }[] = [];
let status = 200;
let draft = false;
const server = createServer((req, res) => {
  asked.push({
    path: req.url,
    host: req.headers.host,
    ...(req.headers.cookie === undefined ? {} : { cookie: req.headers.cookie }),
  });
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  const event = {
    id: "demo",
    name: "Demo Event",
    status: draft ? "draft" : "live",
    time_zone: "UTC",
  };
  // As tenants answers a draft event: its name only to a member's session.
  const member = req.headers.cookie === "canccu_session=member";
  res.end(JSON.stringify(draft && !member ? { id: "demo", status: "draft" } : event));
});
let url = "";
beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

describe("TenantResolver.event", () => {
  it("asks the public API for the request's host, and caches", async () => {
    let clock = 0;
    const r = new TenantResolver({ tenantsUrl: url, now: () => clock });
    expect(await r.event("Demo.Localhost:8080")).toMatchObject({ name: "Demo Event" });
    await r.event("demo.localhost");
    expect(asked).toEqual([{ path: "/api/tenants/current", host: "demo.localhost" }]);
    r.handleEvent({
      id: "e1",
      type: "tenants.tenant.changed",
      version: 1,
      time: "2026-01-01T00:00:00Z",
      source: "tenants",
      tenant: "demo",
      data: {},
    });
    await r.event("demo.localhost");
    clock = 31_000;
    await r.event("demo.localhost");
    expect(asked).toHaveLength(3);
  });

  it("asks a draft event again with the viewer's cookie, and never caches that answer", async () => {
    asked.length = 0;
    draft = true;
    const r = new TenantResolver({ tenantsUrl: url });
    expect(await r.event("demo.localhost", "canccu_session=member")).toMatchObject({
      name: "Demo Event",
    });
    expect((await r.event("demo.localhost", "canccu_session=guest"))?.name).toBeUndefined();
    expect((await r.event("demo.localhost"))?.name).toBeUndefined();
    expect(asked).toEqual([
      { path: "/api/tenants/current", host: "demo.localhost" },
      { path: "/api/tenants/current", host: "demo.localhost", cookie: "canccu_session=member" },
      { path: "/api/tenants/current", host: "demo.localhost", cookie: "canccu_session=guest" },
    ]);
    draft = false;
  });

  it("keeps the shared answer for an open event whatever the cookie", async () => {
    asked.length = 0;
    const r = new TenantResolver({ tenantsUrl: url });
    await r.event("demo.localhost", "canccu_session=a");
    await r.event("demo.localhost", "canccu_session=b");
    expect(asked).toEqual([{ path: "/api/tenants/current", host: "demo.localhost" }]);
  });

  it("answers null, never an error, when the tenants module does not answer", async () => {
    status = 503;
    expect(await new TenantResolver({ tenantsUrl: url }).event("demo.localhost")).toBeNull();
    expect(
      await new TenantResolver({ tenantsUrl: "http://127.0.0.1:1" }).event("demo.localhost"),
    ).toBeNull();
  });
});

describe("TenantResolver.event with an injected fetch", () => {
  // A test app's fake tenants must answer: node:http would reach the real host, as CI did (#701).
  function fakeFetch(draftEvent: boolean) {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: input instanceof Request ? input.url : input.toString(), headers });
      const member = headers.cookie === "canccu_session=member";
      const name = draftEvent && !member ? {} : { name: "Fake Event" };
      return Promise.resolve(
        Response.json({ id: "demo", status: draftEvent ? "draft" : "live", ...name }),
      );
    };
    return { calls, fetch };
  }

  it("asks the injected fetch with the request's host, never the network", async () => {
    asked.length = 0;
    status = 200;
    const fake = fakeFetch(false);
    const r = new TenantResolver({ tenantsUrl: url, fetch: fake.fetch });
    expect(await r.event("Demo.Localhost:8080")).toMatchObject({ name: "Fake Event" });
    expect(fake.calls).toEqual([
      { url: `${url}/api/tenants/current`, headers: { host: "demo.localhost" } },
    ]);
    expect(asked).toEqual([]);
  });

  it("sends the viewer's cookie for a draft event through the injected fetch", async () => {
    asked.length = 0;
    const fake = fakeFetch(true);
    const r = new TenantResolver({ tenantsUrl: url, fetch: fake.fetch });
    expect(await r.event("demo.localhost", "canccu_session=member")).toMatchObject({
      name: "Fake Event",
    });
    expect(fake.calls.map((c) => c.headers)).toEqual([
      { host: "demo.localhost" },
      { host: "demo.localhost", cookie: "canccu_session=member" },
    ]);
    expect(asked).toEqual([]);
  });

  it("answers null when the injected fetch fails or answers an error", async () => {
    const down = new TenantResolver({
      tenantsUrl: url,
      fetch: () => Promise.reject(new Error("down")),
    });
    expect(await down.event("demo.localhost")).toBeNull();
    const missing = new TenantResolver({
      tenantsUrl: url,
      fetch: () => Promise.resolve(new Response("{}", { status: 404 })),
    });
    expect(await missing.event("demo.localhost")).toBeNull();
    expect(asked).toEqual([]);
  });
});
