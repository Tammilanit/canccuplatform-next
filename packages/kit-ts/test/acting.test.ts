// The acting token (contracts/admin.md, The acting token): a module takes it only beside the bot's
// service identity, and admin answers the person's session for the tenant in scope.
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  ACTING_HEADER,
  NotSignedIn,
  RightsChecker,
  SERVICE_HEADER,
  ServiceForbidden,
  ServiceIdentity,
  ServiceUnauthenticated,
  withTenant,
} from "../src/index.js";
import { install, requireRight } from "../src/adapters/fastify.js";
import { withKit, withRight } from "../src/adapters/web.js";
import { FakeAdmin, jsonResponse, sessionBody } from "./helpers.js";

const KEY = "k".repeat(32);
const bot = new ServiceIdentity({ module: "bot", key: KEY });
const pizza = new ServiceIdentity({ module: "pizza", key: KEY });
const asAdmin = new ServiceIdentity({ module: "admin", key: KEY });

function setup(rights: string[] = ["pizza.order.manage"]): {
  fake: FakeAdmin;
  checker: RightsChecker;
} {
  const fake = new FakeAdmin();
  fake.answer = () => jsonResponse(200, sessionBody(rights));
  return { fake, checker: new RightsChecker(fake.client(), { service: pizza }) };
}

const fromBot = (audience = "pizza"): Record<string, string> => ({
  ...bot.headers(audience),
  [ACTING_HEADER]: "tok-1",
});

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe("acting token", () => {
  it("asks admin for the person's session in the tenant in scope", async () => {
    const { fake, checker } = setup();
    const headers = fromBot();
    const session = await withTenant("demo", () => checker.fromHeaders((n) => headers[n]));
    expect(session.userId).toBe("u1");
    expect([...session.rights]).toEqual(["pizza.order.manage"]);
    const [sent] = fake.requests;
    if (sent === undefined) throw new Error("admin was not asked");
    expect(sent.path).toBe("/internal/admin/acting-session");
    expect(sent.query.get("tenant_id")).toBe("demo");
    expect(sent.headers.get(ACTING_HEADER)).toBe("tok-1");
    expect(asAdmin.verify(sent.headers.get(SERVICE_HEADER))).toBe("pizza");
    expect(sent.cookie).toBeNull();
  });

  it("refuses a token without the bot's identity, before asking admin", async () => {
    const { fake, checker } = setup();
    const cases: [Record<string, string>, unknown][] = [
      [{ [ACTING_HEADER]: "tok-1" }, ServiceUnauthenticated],
      [
        {
          ...new ServiceIdentity({ module: "screen", key: KEY }).headers("pizza"),
          [ACTING_HEADER]: "t",
        },
        ServiceForbidden,
      ],
      [fromBot("moments"), ServiceUnauthenticated],
    ];
    for (const [headers, error] of cases) {
      const err = await rejection(withTenant("demo", () => checker.fromHeaders((n) => headers[n])));
      expect(err).toBeInstanceOf(error);
    }
    expect(fake.requests).toHaveLength(0);
  });

  it("takes no token without its own identity or a tenant in scope", async () => {
    const fake = new FakeAdmin();
    const plain = new RightsChecker(fake.client());
    const headers = fromBot();
    const noIdentity = withTenant("demo", () => plain.fromHeaders((n) => headers[n]));
    expect(await rejection(noIdentity)).toBeInstanceOf(NotSignedIn);
    const { checker } = setup();
    expect(await rejection(checker.fromHeaders((n) => headers[n]))).toBeInstanceOf(NotSignedIn);
    expect(fake.requests).toHaveLength(0);
  });

  it("reads a token admin refuses as not signed in, and never caches", async () => {
    const { fake, checker } = setup();
    const headers = fromBot();
    await withTenant("demo", () => checker.fromHeaders((n) => headers[n]));
    await withTenant("demo", () => checker.fromHeaders((n) => headers[n]));
    expect(fake.requests).toHaveLength(2);
    fake.answer = () => jsonResponse(401, { error: { code: "not_signed_in", message: "x" } });
    const err = await rejection(withTenant("demo", () => checker.fromHeaders((n) => headers[n])));
    expect(err).toBeInstanceOf(NotSignedIn);
  });

  it("requireRight acts for the person even where module calls pass", async () => {
    for (const rights of [["pizza.order.manage"], []]) {
      const { checker } = setup(rights);
      const app = Fastify();
      install(app);
      app.get(
        "/api/pizza/x",
        { preHandler: requireRight(checker, "pizza.order.manage", { service: pizza }) },
        (request) => Promise.resolve({ user: request.session?.userId ?? null }),
      );
      app.addHook("onRequest", (_req, _reply, done) => {
        withTenant("demo", () => {
          done();
        });
      });
      await app.ready();
      const res = await app.inject({ method: "GET", url: "/api/pizza/x", headers: fromBot() });
      expect(res.statusCode).toBe(rights.length ? 200 : 403);
      if (rights.length) expect(res.json()).toEqual({ user: "u1" });
    }
  });

  it("withRight acts for the person even where module calls pass", async () => {
    const { checker } = setup();
    const handler = withKit(
      withRight(
        checker,
        "pizza.order.manage",
        (_req, session, service) =>
          Promise.resolve(Response.json({ user: session?.userId, service })),
        { service: pizza },
      ),
    );
    const res = await withTenant("demo", () =>
      handler(new Request("http://pizza/api/pizza/x", { headers: fromBot() })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: "u1", service: null });
  });
});
