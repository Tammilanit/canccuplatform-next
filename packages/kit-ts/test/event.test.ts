import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantResolver } from "../src/resolve.js";

// A real server: fetch() drops a Host header, so the resolver must send it another way.
const asked: { path: string | undefined; host: string | undefined }[] = [];
let status = 200;
const server = createServer((req, res) => {
  asked.push({ path: req.url, host: req.headers.host });
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ id: "demo", name: "Demo Event", status: "live", time_zone: "UTC" }));
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

  it("answers null, never an error, when the tenants module does not answer", async () => {
    status = 503;
    expect(await new TenantResolver({ tenantsUrl: url }).event("demo.localhost")).toBeNull();
    expect(
      await new TenantResolver({ tenantsUrl: "http://127.0.0.1:1" }).event("demo.localhost"),
    ).toBeNull();
  });
});
