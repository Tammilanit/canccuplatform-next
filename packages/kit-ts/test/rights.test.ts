import { describe, expect, it } from "vitest";
import {
  AdminUnavailable,
  MissingRight,
  NotSignedIn,
  RightsChecker,
  sessionIdFromCookie,
} from "../src/index.js";
import type { Event } from "../src/index.js";
import { FakeAdmin, jsonResponse, sessionBody } from "./helpers.js";

const NOW = Date.parse("2026-01-01T12:00:00Z");

function setup(): { admin: FakeAdmin; clock: { t: number }; checker: RightsChecker } {
  const admin = new FakeAdmin();
  const clock = { t: NOW };
  return { admin, clock, checker: new RightsChecker(admin.client(), { now: () => clock.t }) };
}

const rightsChanged = (userId: string): Event => ({
  id: "r1",
  type: "admin.rights.changed",
  version: 1,
  time: "2026-01-01T12:00:00Z",
  source: "admin",
  data: { user_id: userId, rights: [], actor_user_id: "u0" },
});

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe("rights check", () => {
  it("parses the cookie header", () => {
    expect(sessionIdFromCookie("a=1; canccu_session=abc; b=2")).toBe("abc");
    expect(sessionIdFromCookie("canccu_session_x=abc")).toBeUndefined();
    expect(sessionIdFromCookie(undefined)).toBeUndefined();
  });

  it("allows and forwards only the session cookie", async () => {
    const { admin, checker } = setup();
    admin.answer = () => jsonResponse(200, sessionBody(["screen.slides.edit"]));
    const session = await checker.check("theme=dark; canccu_session=s1", "screen.slides.edit");
    expect(session.userId).toBe("u1");
    expect(admin.requests).toMatchObject([
      { method: "GET", path: "/api/admin/session", cookie: "canccu_session=s1", body: undefined },
    ]);
  });

  it("answers 401 without a cookie and without calling admin", async () => {
    const { admin, checker } = setup();
    const err = await rejection(checker.check("theme=dark", "screen.slides.edit"));
    expect(err).toBeInstanceOf(NotSignedIn);
    expect([(err as NotSignedIn).status, (err as NotSignedIn).code]).toEqual([
      401,
      "not_signed_in",
    ]);
    expect(admin.requests).toHaveLength(0);
  });

  it("does not cache admin's 401", async () => {
    const { admin, checker } = setup();
    admin.answer = () => jsonResponse(401, { error: { code: "not_signed_in", message: "x" } });
    for (let i = 0; i < 2; i++) {
      expect(await rejection(checker.check("canccu_session=gone", "a.b"))).toBeInstanceOf(
        NotSignedIn,
      );
    }
    expect(admin.requests).toHaveLength(2);
  });

  it("answers 403 missing_right", async () => {
    const { admin, checker } = setup();
    admin.answer = () => jsonResponse(200, sessionBody(["screen.slides.view"]));
    const err = await rejection(checker.check("canccu_session=s1", "screen.slides.edit"));
    expect(err).toBeInstanceOf(MissingRight);
    expect([(err as MissingRight).status, (err as MissingRight).code]).toEqual([
      403,
      "missing_right",
    ]);
  });

  it("caches for at most 30 seconds", async () => {
    const { admin, clock, checker } = setup();
    admin.answer = () => jsonResponse(200, sessionBody(["a.b"]));
    await checker.check("canccu_session=s1", "a.b");
    clock.t += 29_900;
    await checker.check("canccu_session=s1", "a.b");
    expect(admin.requests).toHaveLength(1);
    clock.t += 200;
    await checker.check("canccu_session=s1", "a.b");
    expect(admin.requests).toHaveLength(2);
  });

  it("never caches past the session's expiry", async () => {
    const { admin, clock, checker } = setup();
    admin.answer = () => jsonResponse(200, sessionBody(["a.b"], "2026-01-01T12:00:05Z"));
    await checker.check("canccu_session=s1", "a.b");
    clock.t += 6000;
    await checker.check("canccu_session=s1", "a.b");
    expect(admin.requests).toHaveLength(2);
  });

  it("drops a user's entries on admin.rights.changed", async () => {
    const { admin, checker } = setup();
    admin.answer = () => jsonResponse(200, sessionBody(["a.b"]));
    await checker.check("canccu_session=s1", "a.b");
    await checker.check("canccu_session=s2", "a.b");
    checker.handleEvent(rightsChanged("someone_else"));
    await checker.check("canccu_session=s1", "a.b");
    expect(admin.requests).toHaveLength(2);
    admin.answer = () => jsonResponse(200, sessionBody([]));
    checker.handleEvent(rightsChanged("u1"));
    for (const sid of ["s1", "s2"]) {
      expect(await rejection(checker.check(`canccu_session=${sid}`, "a.b"))).toBeInstanceOf(
        MissingRight,
      );
    }
    expect(admin.requests).toHaveLength(4);
  });

  it("answers 503 admin_unavailable when admin is down", async () => {
    const { admin, checker } = setup();
    admin.answer = () => Promise.reject(new TypeError("fetch failed"));
    const err = await rejection(checker.check("canccu_session=s1", "a.b"));
    expect(err).toBeInstanceOf(AdminUnavailable);
    expect([(err as AdminUnavailable).status, (err as AdminUnavailable).code]).toEqual([
      503,
      "admin_unavailable",
    ]);
    admin.answer = () => new Response("", { status: 502 });
    expect(await rejection(checker.check("canccu_session=s1", "a.b"))).toBeInstanceOf(
      AdminUnavailable,
    );
  });
});
