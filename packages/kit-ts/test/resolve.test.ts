import { describe, expect, it } from "vitest";
import {
  ConfigError,
  SERVICE_HEADER,
  ServiceIdentity,
  TenantResolver,
  TenantsUnavailable,
  UnknownHost,
  normalizeHost,
} from "../src/index.js";
import type { Event, TenantContext } from "../src/index.js";
import { jsonResponse, tenantContext } from "./helpers.js";

function fakeTenants(hosts: Record<string, TenantContext>) {
  const asked: string[] = [];
  const fetch = (input: string | URL | Request): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    expect(url.pathname).toBe("/internal/tenants/resolve");
    const host = url.searchParams.get("host") ?? "";
    asked.push(host);
    const ctx = hosts[host];
    return Promise.resolve(
      ctx
        ? jsonResponse(200, ctx)
        : jsonResponse(404, { error: { code: "not_found", message: "no" } }),
    );
  };
  return { asked, fetch };
}

const event = (type: string, tenant?: string): Event => ({
  id: `e-${Math.random()}`,
  type,
  version: 1,
  time: "2026-01-01T00:00:00Z",
  source: "tenants",
  ...(tenant ? { tenant } : {}),
  data: {},
});

describe("normalizeHost", () => {
  it("lowercases and drops the port and a trailing dot", () => {
    expect(normalizeHost("Demo.Example.org:8443")).toBe("demo.example.org");
    expect(normalizeHost("demo.example.org.")).toBe("demo.example.org");
    expect(normalizeHost("[2001:db8::1]:80")).toBe("2001:db8::1");
    expect(normalizeHost("192.0.2.1:80")).toBe("192.0.2.1");
    expect(normalizeHost("")).toBeUndefined();
    expect(normalizeHost(undefined)).toBeUndefined();
  });
});

describe("TenantResolver", () => {
  const demo = tenantContext();

  it("resolves a registered host through the tenants API and caches it", async () => {
    const tenants = fakeTenants({ "demo.example.org": demo });
    const resolver = new TenantResolver({
      tenantsUrl: "http://tenants:8000/",
      fetch: tenants.fetch,
    });
    expect(await resolver.resolve("Demo.example.org:443")).toEqual({
      kind: "tenant",
      context: demo,
    });
    await resolver.resolve("demo.example.org");
    expect(tenants.asked).toEqual(["demo.example.org"]);
  });

  it("gives an unknown host 404 with no detail", async () => {
    const resolver = new TenantResolver({ tenantsUrl: "http://t", fetch: fakeTenants({}).fetch });
    const err = await resolver.resolve("nope.example.org").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownHost);
    expect((err as UnknownHost).toBody()).toEqual({
      error: { code: "not_found", message: "Not found." },
    });
    await expect(resolver.resolve(undefined)).rejects.toThrow(UnknownHost);
  });

  it("answers 503 when the tenants module cannot be reached", async () => {
    const resolver = new TenantResolver({
      tenantsUrl: "http://t",
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    await expect(resolver.resolve("demo.example.org")).rejects.toThrow(TenantsUnavailable);
  });

  it("answers 503 when the tenants module sends something that is not JSON", async () => {
    const resolver = new TenantResolver({
      tenantsUrl: "http://t",
      fetch: () => Promise.resolve(new Response("<html>", { status: 200 })),
    });
    await expect(resolver.resolve("demo.example.org")).rejects.toThrow(TenantsUnavailable);
  });

  it("keeps the cache bounded against random Host headers and drops expired entries", async () => {
    let now = 0;
    const resolver = new TenantResolver({
      tenantsUrl: "http://t",
      fetch: fakeTenants({}).fetch,
      maxEntries: 3,
      now: () => now,
    });
    for (let i = 0; i < 10; i++) {
      await expect(resolver.resolve(`x${i}.example.org`)).rejects.toThrow(UnknownHost);
    }
    expect(resolver.cacheSize).toBe(3);
    now = 31_000;
    await expect(resolver.resolve("x9.example.org")).rejects.toThrow(UnknownHost);
    expect(resolver.cacheSize).toBe(3);
  });

  it("answers 503 when the tenants module sends a context without a valid tenant id", async () => {
    for (const body of [{}, { tenant_id: "../x" }, []]) {
      const resolver = new TenantResolver({
        tenantsUrl: "http://t",
        fetch: () => Promise.resolve(jsonResponse(200, body)),
      });
      await expect(resolver.resolve("demo.example.org")).rejects.toThrow(TenantsUnavailable);
    }
  });

  it("forgets unknown hosts on any tenants event, so a new hostname works at once", async () => {
    const hosts: Record<string, TenantContext> = {};
    const tenants = fakeTenants(hosts);
    const resolver = new TenantResolver({ tenantsUrl: "http://t", fetch: tenants.fetch });
    await expect(resolver.resolve("new.example.org")).rejects.toThrow(UnknownHost);
    hosts["new.example.org"] = demo;
    resolver.handleEvent(event("tenants.flags.changed", "other"));
    expect(await resolver.resolve("new.example.org")).toEqual({ kind: "tenant", context: demo });
  });

  it("drops the cache on tenants events: the tenant's own, or all on a platform event", async () => {
    const tenants = fakeTenants({ "demo.example.org": demo });
    const resolver = new TenantResolver({ tenantsUrl: "http://t", fetch: tenants.fetch });
    await resolver.resolve("demo.example.org");
    resolver.handleEvent(event("tenants.flags.changed", "other"));
    await resolver.resolve("demo.example.org");
    resolver.handleEvent(event("tenants.flags.changed", "demo"));
    await resolver.resolve("demo.example.org");
    resolver.handleEvent(event("tenants.hostname.changed"));
    await resolver.resolve("demo.example.org");
    expect(tenants.asked).toHaveLength(3);
  });

  it("expires cached answers, also unknown hosts", async () => {
    let now = 0;
    const tenants = fakeTenants({});
    const resolver = new TenantResolver({
      tenantsUrl: "http://t",
      fetch: tenants.fetch,
      now: () => now,
    });
    await expect(resolver.resolve("x.example.org")).rejects.toThrow(UnknownHost);
    await expect(resolver.resolve("x.example.org")).rejects.toThrow(UnknownHost);
    now = 31_000;
    await expect(resolver.resolve("x.example.org")).rejects.toThrow(UnknownHost);
    expect(tenants.asked).toHaveLength(2);
  });

  it("keeps the platform's own hostnames outside resolution", async () => {
    const tenants = fakeTenants({});
    const resolver = new TenantResolver({
      tenantsUrl: "http://t",
      fetch: tenants.fetch,
      platformHosts: ["Sign-in.example.org", "admin.example.org"],
    });
    expect(await resolver.resolve("sign-in.example.org:443")).toEqual({
      kind: "platform",
      host: "sign-in.example.org",
    });
    expect(tenants.asked).toEqual([]);
  });

  describe("IP-mode demo stack", () => {
    const load = () => Promise.resolve(demo);

    it("serves the demo tenant on an IP literal while the version is dev", async () => {
      const tenants = fakeTenants({});
      const resolver = new TenantResolver({
        tenantsUrl: "http://t",
        fetch: tenants.fetch,
        ipMode: { version: "dev", load },
      });
      expect(await resolver.resolve("192.0.2.1:80")).toEqual({ kind: "tenant", context: demo });
      expect(await resolver.resolve("[2001:db8::1]")).toEqual({ kind: "tenant", context: demo });
      expect(tenants.asked).toEqual([]);
    });

    it("never applies to a hostname", async () => {
      const resolver = new TenantResolver({
        tenantsUrl: "http://t",
        fetch: fakeTenants({}).fetch,
        ipMode: { version: "dev", load },
      });
      await expect(resolver.resolve("unregistered.example.org")).rejects.toThrow(UnknownHost);
    });

    it("refuses to start on a release version", () => {
      expect(
        () => new TenantResolver({ tenantsUrl: "http://t", ipMode: { version: "v1.2.0", load } }),
      ).toThrow(ConfigError);
    });

    it("gives 404 when the loader declines or returns another tenant than demo", async () => {
      const none = new TenantResolver({
        tenantsUrl: "http://t",
        ipMode: { version: "dev", load: () => Promise.resolve(null) },
      });
      await expect(none.resolve("192.0.2.1")).rejects.toThrow(UnknownHost);
      const other = new TenantResolver({
        tenantsUrl: "http://t",
        ipMode: {
          version: "dev",
          load: () => Promise.resolve(tenantContext({ tenant_id: "real-event" })),
        },
      });
      await expect(other.resolve("192.0.2.1")).rejects.toThrow(UnknownHost);
    });

    describe("through the tenants module", () => {
      const service = new ServiceIdentity({ module: "pizza", key: "k".repeat(32) });
      const tenantsSide = new ServiceIdentity({ module: "tenants", key: "k".repeat(32) });

      function ipModeTenants(answer: () => Promise<Response>) {
        const calls: { path: string; caller: string }[] = [];
        const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
          const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          );
          const caller = tenantsSide.verify(new Headers(init?.headers).get(SERVICE_HEADER));
          calls.push({ path: url.pathname + url.search, caller });
          return answer();
        };
        return { calls, fetch };
      }

      const ipResolver = (answer: () => Promise<Response>) => {
        const tenants = ipModeTenants(answer);
        const resolver = new TenantResolver({
          tenantsUrl: "http://tenants:8000/",
          fetch: tenants.fetch,
          service,
          ipMode: { version: "dev" },
        });
        return { resolver, calls: tenants.calls };
      };

      it("asks GET /internal/tenants/ip-mode, signed for the tenants module", async () => {
        const { resolver, calls } = ipResolver(() => Promise.resolve(jsonResponse(200, demo)));
        expect(await resolver.resolve("192.0.2.1")).toEqual({ kind: "tenant", context: demo });
        expect(calls).toEqual([{ path: "/internal/tenants/ip-mode", caller: "pizza" }]);
      });

      it("serves nothing on 404 or a tenant other than demo", async () => {
        for (const answer of [
          () => Promise.resolve(jsonResponse(404, { error: { code: "not_found", message: "" } })),
          () => Promise.resolve(jsonResponse(200, tenantContext({ tenant_id: "real-event" }))),
        ]) {
          await expect(ipResolver(answer).resolver.resolve("192.0.2.1")).rejects.toThrow(
            UnknownHost,
          );
        }
      });

      it("answers 503 on another status, a transport error, non-JSON or a bad tenant id", async () => {
        for (const answer of [
          () => Promise.resolve(jsonResponse(500, {})),
          () => Promise.resolve(jsonResponse(400, {})),
          () => Promise.reject(new Error("ECONNREFUSED")),
          () => Promise.resolve(new Response("<html>", { status: 200 })),
          () => Promise.resolve(jsonResponse(200, { tenant_id: "../x" })),
        ]) {
          await expect(ipResolver(answer).resolver.resolve("192.0.2.1")).rejects.toThrow(
            TenantsUnavailable,
          );
        }
      });

      it("signs host lookups too when the resolver has a service identity", async () => {
        const { resolver, calls } = ipResolver(() => Promise.resolve(jsonResponse(200, demo)));
        await resolver.resolve("demo.example.org");
        expect(calls).toEqual([
          { path: "/internal/tenants/resolve?host=demo.example.org", caller: "pizza" },
        ]);
      });

      it("still prefers a given loader", async () => {
        const { calls, fetch } = ipModeTenants(() => Promise.resolve(jsonResponse(404, {})));
        const resolver = new TenantResolver({
          tenantsUrl: "http://t",
          fetch,
          service,
          ipMode: { version: "dev", load },
        });
        expect(await resolver.resolve("192.0.2.1")).toEqual({ kind: "tenant", context: demo });
        expect(calls).toEqual([]);
      });
    });

    it("without IP mode an IP literal is an unknown host", async () => {
      const resolver = new TenantResolver({ tenantsUrl: "http://t", fetch: fakeTenants({}).fetch });
      await expect(resolver.resolve("192.0.2.1")).rejects.toThrow(UnknownHost);
    });
  });
});
