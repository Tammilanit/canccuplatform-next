import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { Bus, RightsChecker, createHealth } from "../src/index.js";
import type { CheckFn } from "../src/index.js";
import { install, requireRight } from "../src/adapters/fastify.js";
import { healthHandler, statusResponse, withKit, withRight } from "../src/adapters/web.js";
import { MemoryStreamStore } from "../src/testing.js";
import { FakeAdmin, jsonResponse, sessionBody } from "./helpers.js";

const state = { valkey: "ok" };
const valkey: CheckFn = () =>
  Promise.resolve(state.valkey === "ok" ? { status: "ok" } : { status: "down", detail: "x" });
const health = createHealth({ module: "screen", version: "v0.1.0", checks: { valkey } });

function rightsAnswer(admin: FakeAdmin): void {
  admin.answer = (req) =>
    jsonResponse(
      200,
      req.cookie === "canccu_session=s1" ? sessionBody(["screen.slides.edit"]) : sessionBody([]),
    );
}

describe("fastify adapter", () => {
  async function build() {
    const admin = new FakeAdmin();
    rightsAnswer(admin);
    const store = new MemoryStreamStore();
    const bus = new Bus(store, "screen");
    const app = Fastify();
    install(app, { health });
    const checker = new RightsChecker(admin.client());
    app.post(
      "/edit",
      { preHandler: requireRight(checker, "screen.slides.edit") },
      async (request) => {
        await bus.publish("screen.slide.changed", {}, { version: 1 });
        return { user: request.session?.userId };
      },
    );
    app.get("/crash", () => {
      throw new Error("secret detail");
    });
    await app.ready();
    return { app, store };
  }

  it("serves /health with 200 and 503", async () => {
    const { app } = await build();
    state.valkey = "ok";
    let res = await app.inject({ method: "GET", url: "/health" });
    expect([res.statusCode, res.json<{ status: string }>().status]).toEqual([200, "ok"]);
    state.valkey = "down";
    res = await app.inject({ method: "GET", url: "/health" });
    expect([res.statusCode, res.json<{ status: string }>().status]).toEqual([503, "down"]);
    state.valkey = "ok";
  });

  it("checks rights and answers with the error body", async () => {
    const { app, store } = await build();
    let res = await app.inject({ method: "POST", url: "/edit" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: { code: "not_signed_in", message: "sign in first" } });

    res = await app.inject({
      method: "POST",
      url: "/edit",
      headers: { cookie: "canccu_session=s1", "x-correlation-id": "c-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: "u1" });
    expect(res.headers["x-correlation-id"]).toBe("c-1");
    expect(JSON.parse(store.calls[0]?.fields.event ?? "{}")).toMatchObject({
      correlation_id: "c-1",
    });

    res = await app.inject({
      method: "POST",
      url: "/edit",
      headers: { cookie: "canccu_session=s2" },
    });
    expect([res.statusCode, res.json<{ error: { code: string } }>().error.code]).toEqual([
      403,
      "missing_right",
    ]);

    res = await app.inject({ method: "GET", url: "/nowhere" });
    expect([res.statusCode, res.json<{ error: { code: string } }>().error.code]).toEqual([
      404,
      "not_found",
    ]);

    res = await app.inject({ method: "GET", url: "/crash" });
    expect([res.statusCode, res.json<{ error: { code: string } }>().error.code]).toEqual([
      500,
      "internal_error",
    ]);
    expect(res.body).not.toContain("secret");
  });
});

describe("web adapter", () => {
  const admin = new FakeAdmin();
  rightsAnswer(admin);
  const store = new MemoryStreamStore();
  const bus = new Bus(store, "screen");
  const checker = new RightsChecker(admin.client());
  const edit = withRight(checker, "screen.slides.edit", async (_req, session) => {
    await bus.publish("screen.slide.changed", {}, { version: 1 });
    return Response.json({ user: session.userId });
  });
  const handle = withKit(async (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/health") return healthHandler(health)(req);
    if (path === "/edit") return edit(req);
    if (path === "/crash") throw new Error("secret detail");
    return statusResponse(404, "no route");
  });
  const call = (path: string, headers: Record<string, string> = {}) =>
    handle(new Request(`http://screen${path}`, { headers }));

  it("serves /health with 200 and 503", async () => {
    state.valkey = "ok";
    expect((await call("/health")).status).toBe(200);
    state.valkey = "down";
    const res = await call("/health");
    expect([res.status, ((await res.json()) as { status: string }).status]).toEqual([503, "down"]);
    state.valkey = "ok";
  });

  it("checks rights and answers with the error body", async () => {
    let res = await call("/edit");
    expect([res.status, await res.json()]).toEqual([
      401,
      { error: { code: "not_signed_in", message: "sign in first" } },
    ]);
    res = await call("/edit", { cookie: "canccu_session=s1", "x-correlation-id": "c-1" });
    expect([res.status, await res.json()]).toEqual([200, { user: "u1" }]);
    expect(res.headers.get("x-correlation-id")).toBe("c-1");
    expect(JSON.parse(store.calls[0]?.fields.event ?? "{}")).toMatchObject({
      correlation_id: "c-1",
    });
    res = await call("/edit", { cookie: "canccu_session=s2" });
    expect(res.status).toBe(403);
    res = await call("/nowhere");
    expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([
      404,
      "not_found",
    ]);
    res = await call("/crash");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
  });
});
