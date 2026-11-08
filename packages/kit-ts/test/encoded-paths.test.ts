import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { ServiceIdentity, canonicalPath } from "../src/index.js";
import { install, installServiceIdentity } from "../src/adapters/fastify.js";
import { withKit, withServiceIdentity } from "../src/adapters/web.js";

// Routers decode the path before they match it: a guard that reads the raw URL would let
// `/%69nternal/…` reach an /internal/ handler unsigned, and `/%61pi/…` escape the Origin rule.
const tenants = new ServiceIdentity({ module: "tenants", key: "k".repeat(32) });

describe("canonicalPath", () => {
  it("decodes escapes and drops the query", () => {
    expect(canonicalPath("/%69nternal/tenants/resolve?host=x")).toBe("/internal/tenants/resolve");
  });
  it.each([
    "/internal%2Ftenants",
    "/a/%2e%2e/internal",
    "//internal/x",
    "/a\\b",
    "/%5c",
    "/%zz",
    "/a/./b",
  ])("refuses %s", (raw) => {
    expect(() => canonicalPath(raw)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe("Fastify guards the path the router matches", () => {
  async function app() {
    const a = Fastify();
    install(a);
    installServiceIdentity(a, tenants, { exempt: ["/internal/tenants/ask"] });
    a.get("/internal/tenants/resolve", () => ({ ok: true }));
    a.get("/internal/tenants/ask", () => ({ ok: true }));
    a.get("/api/pizza/menu", () => ({ ok: true }));
    await a.ready();
    return a;
  }

  it("an escaped /internal/ is still guarded", async () => {
    const a = await app();
    for (const url of ["/%69nternal/tenants/resolve", "/internal/tenants/%72esolve"]) {
      const res = await a.inject({ method: "GET", url, headers: { host: "tenants:8080" } });
      expect(res.statusCode).toBe(401);
    }
    const encodedSlash = await a.inject({ method: "GET", url: "/internal%2Ftenants/resolve" });
    expect(encodedSlash.statusCode).toBe(400);
  });

  it("an escaped exempt path is refused, not exempt", async () => {
    const a = await app();
    expect((await a.inject({ method: "GET", url: "/internal/tenants/ask" })).statusCode).toBe(200);
    expect((await a.inject({ method: "GET", url: "/internal/tenants/%61sk" })).statusCode).toBe(
      200,
    );
  });

  it("an escaped /api/ with Origin: null is refused", async () => {
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/%61pi/pizza/menu",
      headers: { origin: "null" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("web adapters guard the decoded path", () => {
  const handler = withKit(
    withServiceIdentity(tenants, (_req, service) => Promise.resolve(new Response(String(service)))),
  );
  it("an escaped /internal/ is guarded and an escaped /api/ with Origin: null refused", async () => {
    expect((await handler(new Request("http://t/%69nternal/x"))).status).toBe(401);
    const api = new Request("http://t/%61pi/x", { headers: { origin: "null" } });
    expect((await handler(api)).status).toBe(403);
    expect((await handler(new Request("http://t/internal%2Fx"))).status).toBe(400);
  });
});
