import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { TenantResolver, createHealth, currentTenant } from "../src/index.js";
import type { TenantContext } from "../src/index.js";
import { install, installTenancy } from "../src/adapters/fastify.js";
import { withKit, withTenancy } from "../src/adapters/web.js";
import { jsonResponse, tenantContext } from "./helpers.js";

function resolver(): TenantResolver {
  const hosts: Record<string, TenantContext> = {
    "a.example.org": tenantContext({ tenant_id: "leak-a" }),
    "b.example.org": tenantContext({ tenant_id: "leak-b" }),
  };
  return new TenantResolver({
    tenantsUrl: "http://tenants",
    platformHosts: ["signin.example.org"],
    fetch: (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const host = new URL(url).searchParams.get("host") ?? "";
      const ctx = hosts[host];
      return Promise.resolve(ctx ? jsonResponse(200, ctx) : jsonResponse(404, {}));
    },
  });
}

const health = createHealth({ module: "pizza", version: "dev", checks: {} });

describe("Fastify installTenancy", () => {
  async function app(platformHosts?: "serve" | "refuse") {
    const a = Fastify();
    install(a, { health });
    installTenancy(a, resolver(), platformHosts ? { platformHosts } : {});
    a.get("/who", async (request) => {
      await new Promise((r) => setTimeout(r, 1));
      return { context: request.tenant?.tenant_id ?? null, als: currentTenant() ?? null };
    });
    await a.ready();
    return a;
  }

  it("runs each request in the tenant of its host", async () => {
    const a = await app();
    for (const [host, tenant] of [
      ["a.example.org", "leak-a"],
      ["B.example.org:80", "leak-b"],
    ] as const) {
      const res = await a.inject({ url: "/who", headers: { host } });
      expect(res.json()).toEqual({ context: tenant, als: tenant });
    }
  });

  it("gives an unknown host 404 with no detail", async () => {
    const res = await (await app()).inject({ url: "/who", headers: { host: "x.example.org" } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "not_found", message: "Not found." } });
  });

  it("keeps /health outside tenant resolution", async () => {
    const res = await (await app()).inject({ url: "/health", headers: { host: "x.example.org" } });
    expect(res.statusCode).toBe(200);
  });

  it("refuses the platform's own hostnames unless the module serves them", async () => {
    const refused = await (
      await app()
    ).inject({ url: "/who", headers: { host: "signin.example.org" } });
    expect(refused.statusCode).toBe(404);
    const served = await (
      await app("serve")
    ).inject({ url: "/who", headers: { host: "signin.example.org" } });
    expect(served.json()).toEqual({ context: null, als: null });
  });
});

describe("Web withTenancy", () => {
  const handler = withKit(
    withTenancy(resolver(), (_request, tenant) =>
      Promise.resolve(
        Response.json({ context: tenant?.tenant_id ?? null, als: currentTenant() ?? null }),
      ),
    ),
  );

  it("runs each request in the tenant of its host", async () => {
    const res = await handler(new Request("http://a.example.org/who"));
    expect(await res.json()).toEqual({ context: "leak-a", als: "leak-a" });
  });

  it("gives an unknown host 404 and lets /health through", async () => {
    expect((await handler(new Request("http://x.example.org/who"))).status).toBe(404);
    expect((await handler(new Request("http://x.example.org/health"))).status).toBe(200);
  });

  it("refuses a platform hostname by default", async () => {
    expect((await handler(new Request("http://signin.example.org/who"))).status).toBe(404);
  });
});
