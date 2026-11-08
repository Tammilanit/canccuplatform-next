import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { RightsChecker, SERVICE_HEADER, ServiceIdentity } from "../src/index.js";
import { install, installServiceIdentity, requireRight } from "../src/adapters/fastify.js";
import { withKit, withRight, withServiceIdentity } from "../src/adapters/web.js";
import { FakeAdmin, jsonResponse, sessionBody } from "./helpers.js";

const KEY = "k".repeat(32);
const admin = new ServiceIdentity({ module: "admin", key: KEY });
const pizza = new ServiceIdentity({ module: "pizza", key: KEY });
const screen = new ServiceIdentity({ module: "screen", key: KEY });

function checker(): RightsChecker {
  const fake = new FakeAdmin();
  fake.answer = (req) =>
    jsonResponse(200, sessionBody(req.cookie === "canccu_session=s1" ? ["pizza.orders.read"] : []));
  return new RightsChecker(fake.client());
}

const ORIGIN_REFUSED = { code: "origin_refused" };

describe("Fastify origin check", () => {
  async function app(originCheck?: boolean) {
    const a = Fastify();
    install(a, originCheck === undefined ? {} : { originCheck });
    a.post("/api/pizza/order", () => ({ ok: true }));
    a.get("/api/pizza/menu", () => ({ ok: true }));
    await a.ready();
    return a;
  }

  it("refuses another origin and Origin: null with the error body", async () => {
    const a = await app();
    for (const [method, url, origin] of [
      ["POST", "/api/pizza/order", "https://evil.example.net"],
      ["GET", "/api/pizza/menu", "null"],
    ] as const) {
      const res = await a.inject({ method, url, headers: { host: "demo.example.org", origin } });
      expect(res.statusCode).toBe(403);
      expect(res.json<{ error: unknown }>().error).toMatchObject(ORIGIN_REFUSED);
    }
  });

  it("lets the same origin and non-browser callers through", async () => {
    const a = await app();
    const same = await a.inject({
      method: "POST",
      url: "/api/pizza/order",
      headers: { host: "demo.example.org", origin: "https://demo.example.org" },
    });
    expect(same.statusCode).toBe(200);
    expect((await a.inject({ method: "POST", url: "/api/pizza/order" })).statusCode).toBe(200);
  });

  it("can be turned off", async () => {
    const res = await (
      await app(false)
    ).inject({ method: "POST", url: "/api/pizza/order", headers: { origin: "null" } });
    expect(res.statusCode).toBe(200);
  });
});

describe("Fastify service identity", () => {
  async function app() {
    const a = Fastify();
    install(a);
    installServiceIdentity(a, admin, { exempt: ["/internal/admin/open"] });
    a.get("/internal/admin/settings/pizza", (request) => ({ caller: request.service }));
    a.get("/internal/admin/open", (request) => ({ caller: request.service }));
    a.get("/api/admin/thing", (request) => ({ caller: request.service }));
    a.get(
      "/api/admin/orders",
      { preHandler: requireRight(checker(), "pizza.orders.read", { service: pizza }) },
      (request) => ({ caller: request.service, user: request.session?.userId ?? null }),
    );
    await a.ready();
    return a;
  }

  it("refuses internal paths without a valid token, with the error body", async () => {
    const a = await app();
    for (const headers of [{}, { [SERVICE_HEADER]: "v1.x" }, admin.headers("pizza")]) {
      const res = await a.inject({ url: "/internal/admin/settings/pizza?tenant_id=demo", headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        error: { code: "service_unauthenticated", message: "service unauthenticated" },
      });
    }
  });

  it("sets request.service for a valid token and leaves other paths alone", async () => {
    const a = await app();
    const res = await a.inject({
      url: "/internal/admin/settings/pizza",
      headers: pizza.headers("admin"),
    });
    expect([res.statusCode, res.json()]).toEqual([200, { caller: "pizza" }]);
    expect((await a.inject({ url: "/internal/admin/open" })).json()).toEqual({ caller: null });
    expect((await a.inject({ url: "/api/admin/thing" })).json()).toEqual({ caller: null });
  });

  it("requireRight accepts a module for its own rights only, else checks the session", async () => {
    const a = await app();
    let res = await a.inject({ url: "/api/admin/orders", headers: pizza.headers("pizza") });
    expect([res.statusCode, res.json()]).toEqual([200, { caller: "pizza", user: null }]);
    res = await a.inject({ url: "/api/admin/orders", headers: screen.headers("pizza") });
    expect([res.statusCode, res.json<{ error: { code: string } }>().error.code]).toEqual([
      403,
      "missing_right",
    ]);
    res = await a.inject({ url: "/api/admin/orders", headers: screen.headers("admin") });
    expect(res.statusCode).toBe(401);
    res = await a.inject({ url: "/api/admin/orders", headers: { cookie: "canccu_session=s1" } });
    expect([res.statusCode, res.json()]).toEqual([200, { caller: null, user: "u1" }]);
  });
});

describe("Web adapter security", () => {
  const handle = withKit(
    withServiceIdentity(
      admin,
      async (request, caller) => {
        const path = new URL(request.url).pathname;
        if (path === "/api/admin/orders") {
          return withRight(
            checker(),
            "pizza.orders.read",
            (_req, session, service) =>
              Promise.resolve(Response.json({ caller: service, user: session?.userId ?? null })),
            { service: pizza },
          )(request);
        }
        return Response.json({ caller });
      },
      { exempt: ["/internal/admin/open"] },
    ),
  );
  const call = (path: string, init: RequestInit = {}) =>
    handle(new Request(`http://demo.example.org${path}`, init));

  it("answers 403 origin_refused with the error body", async () => {
    let res = await call("/api/pizza/order", {
      method: "POST",
      headers: { origin: "https://evil.example.net" },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: unknown }).error).toMatchObject(ORIGIN_REFUSED);
    res = await call("/api/pizza/menu", { headers: { origin: "null" } });
    expect(res.status).toBe(403);
    res = await call("/api/pizza/order", {
      method: "POST",
      headers: { origin: "http://demo.example.org" },
    });
    expect(res.status).toBe(200);
  });

  it("guards internal paths with the service identity", async () => {
    let res = await call("/internal/admin/settings/pizza");
    expect([res.status, await res.json()]).toEqual([
      401,
      { error: { code: "service_unauthenticated", message: "service unauthenticated" } },
    ]);
    res = await call("/internal/admin/settings/pizza", { headers: pizza.headers("admin") });
    expect(await res.json()).toEqual({ caller: "pizza" });
    expect(await (await call("/internal/admin/open")).json()).toEqual({ caller: null });
  });

  it("withRight accepts a module for its own rights only, else checks the session", async () => {
    let res = await call("/api/admin/orders", { headers: pizza.headers("pizza") });
    expect(await res.json()).toEqual({ caller: "pizza", user: null });
    res = await call("/api/admin/orders", { headers: screen.headers("pizza") });
    expect(res.status).toBe(403);
    res = await call("/api/admin/orders", { headers: { cookie: "canccu_session=s1" } });
    expect(await res.json()).toEqual({ caller: null, user: "u1" });
  });
});
