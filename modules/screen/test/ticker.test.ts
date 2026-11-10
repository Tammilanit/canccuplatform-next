// The ticker and its windows over HTTP on Postgres, and the tick announcing what changes by
// itself: a window starting or ending, a line running out. Each change is announced once.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tickRunner } from "../src/tick/run.js";
import { DATABASE_URL, TENANTS, call, code, events, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

const as = (session: string, body?: unknown, host = "alpha.test") => ({ host, session, body });
const HOUR = 3600_000;
// The harness's clock starts at 2026-01-01T12:00:00Z, a Thursday (ISO 4); alpha runs in UTC.
const NOON = Date.parse("2026-01-01T12:00:00Z");

describe.skipIf(!DATABASE_URL)("ticker", () => {
  let h: Harness;
  let tick: () => Promise<void>;
  const changes = (tenant = "alpha") => events(h, "screen.ticker.changed", tenant);
  beforeAll(async () => {
    h = await harness();
    await pairDevice(h);
    tick = tickRunner({
      db: h.db,
      kv: h.kv,
      bus: h.bus,
      audit: (entry) => {
        h.audits.push(entry);
        return Promise.resolve();
      },
      settings: { ensure: () => Promise.resolve(), get: (_key, fallback) => fallback },
      assets: () => Promise.resolve(new Map()),
      tenantById: (id) =>
        Promise.resolve(Object.values(TENANTS).find((t) => t.tenant_id === id) ?? null),
      now: () => h.clock.now,
    });
  });
  afterAll(async () => {
    await h.close();
  });

  /** The tick claims each second once; a new second frees the claim. */
  const tickAt = async (ms: number) => {
    h.clock.now = ms;
    await tick();
  };

  it("reads an empty ticker with the event's appearance", async () => {
    h.settings.alpha = { ticker_appearance: "broadcast" };
    const res = await call(h, "GET", "/api/screen/ticker", as("content"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: null, until: null, source: null, appearance: "broadcast" });
    delete h.settings.alpha;
  });

  it("needs the ticker right to write, and a sign-in to read", async () => {
    const body = { text: "Hi", until: null };
    expect((await call(h, "PUT", "/api/screen/ticker", as("content", body))).statusCode).toBe(403);
    expect((await call(h, "DELETE", "/api/screen/ticker", as("content"))).statusCode).toBe(403);
    expect((await call(h, "GET", "/api/screen/ticker", as("crew"))).statusCode).toBe(403);
    expect((await call(h, "GET", "/api/screen/ticker", { host: "alpha.test" })).statusCode).toBe(
      401,
    );
    expect((await call(h, "GET", "/api/screen/ticker", as("ticker"))).statusCode).toBe(200);
  });

  it("refuses a line that is empty, too long or already over", async () => {
    const put = (body: unknown) => call(h, "PUT", "/api/screen/ticker", as("ticker", body));
    for (const body of [
      { text: "  ", until: null },
      { text: "x".repeat(281), until: null },
      { text: "Hi" },
      { text: "Hi", until: "soon" },
      { text: "Hi", until: new Date(NOON - 1000).toISOString() },
      { text: "Hi", until: null, extra: 1 },
    ]) {
      const res = await put(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(code(res)).toBe("invalid_request");
    }
  });

  it("sets a person's line, announces it once and keeps it across reads", async () => {
    const until = new Date(NOON + HOUR).toISOString();
    const res = await call(
      h,
      "PUT",
      "/api/screen/ticker",
      as("ticker", { text: "  Pizza is here  ", until }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      text: "Pizza is here",
      until,
      source: "admin",
      appearance: "default",
    });
    expect(changes()).toEqual([
      { text: "Pizza is here", until, source: "admin", actor_user_id: "u_ticker" },
    ]);
    // The same line again changes nothing, so nothing is announced.
    await call(h, "PUT", "/api/screen/ticker", as("ticker", { text: "Pizza is here", until }));
    expect(changes()).toHaveLength(1);
    expect((await call(h, "GET", "/api/screen/ticker", as("content"))).json()).toMatchObject({
      text: "Pizza is here",
    });
    // Another event never sees it.
    expect(
      (await call(h, "GET", "/api/screen/ticker", as("admin", undefined, "beta.test"))).json(),
    ).toMatchObject({ text: null });
  });

  it("lets the tick announce a line running out, once", async () => {
    await tickAt(NOON + HOUR - 1000);
    expect(changes()).toHaveLength(1);
    await tickAt(NOON + HOUR);
    await tickAt(NOON + HOUR + 1000);
    expect(changes()).toHaveLength(2);
    expect(changes().at(-1)).toEqual({
      text: null,
      until: null,
      source: null,
      actor_user_id: null,
    });
    expect((await call(h, "GET", "/api/screen/ticker", as("content"))).json()).toMatchObject({
      text: null,
    });
  });

  it("clears the line", async () => {
    h.clock.now = NOON + 2 * HOUR;
    await call(h, "PUT", "/api/screen/ticker", as("ticker", { text: "Back soon", until: null }));
    const before = changes().length;
    expect((await call(h, "DELETE", "/api/screen/ticker", as("ticker"))).statusCode).toBe(204);
    expect(changes()).toHaveLength(before + 1);
    expect(changes().at(-1)).toMatchObject({ text: null, source: null, actor_user_id: "u_ticker" });
    // Clearing an empty ticker is no change.
    expect((await call(h, "DELETE", "/api/screen/ticker", as("ticker"))).statusCode).toBe(204);
    expect(changes()).toHaveLength(before + 1);
  });

  it("keeps an archived event read-only", async () => {
    const put = await call(
      h,
      "PUT",
      "/api/screen/ticker",
      as("admin", { text: "Hi", until: null }, "gamma.test"),
    );
    expect(put.statusCode).toBe(409);
    expect(code(put)).toBe("event_archived");
    const add = await call(
      h,
      "POST",
      "/api/screen/ticker/windows",
      as("admin", { text: "Hi", days: [1], start_minute: 0, end_minute: 60 }, "gamma.test"),
    );
    expect(code(add)).toBe("event_archived");
  });

  describe("windows", () => {
    // Thursday 18:00–20:00 in the event's time zone.
    const evening = {
      text: "Tournament finals tonight",
      days: [4],
      start_minute: 1080,
      end_minute: 1200,
    };
    let windowId: string;

    it("refuses bad times and texts", async () => {
      const post = (body: unknown) =>
        call(h, "POST", "/api/screen/ticker/windows", as("ticker", body));
      for (const body of [
        { ...evening, days: [] },
        { ...evening, days: [8] },
        { ...evening, start_minute: 1200, end_minute: 1200 },
        { ...evening, end_minute: 1441 },
        { ...evening, text: "" },
        { ...evening, text: "x".repeat(281) },
        { ...evening, zone_key: "main" },
      ]) {
        expect((await post(body)).statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(
        (await call(h, "POST", "/api/screen/ticker/windows", as("content", evening))).statusCode,
      ).toBe(403);
    });

    it("adds a window, audited, and lists it", async () => {
      h.clock.now = NOON + 3 * HOUR;
      const res = await call(h, "POST", "/api/screen/ticker/windows", as("ticker", evening));
      expect(res.statusCode).toBe(201);
      const window = res.json<{ id: string }>();
      windowId = window.id;
      expect(window).toEqual({ id: expect.stringMatching(/^tw_/) as string, ...evening });
      expect(h.audits.at(-1)).toMatchObject({
        tenant_id: "alpha",
        actor_user_id: "u_ticker",
        action: "screen.ticker_window.added",
        target: { type: "ticker_window", id: windowId },
      });
      const list = await call(h, "GET", "/api/screen/ticker/windows", as("ticker"));
      expect(list.json()).toEqual({ windows: [window] });
      // Not active at 15:00, so the ticker is unchanged.
      expect((await call(h, "GET", "/api/screen/ticker", as("content"))).json()).toMatchObject({
        text: null,
      });
    });

    it("shows the window's text in its times, announced by the tick", async () => {
      const before = changes().length;
      await tickAt(Date.parse("2026-01-01T18:00:00Z"));
      expect(changes()).toHaveLength(before + 1);
      expect(changes().at(-1)).toEqual({
        text: evening.text,
        until: "2026-01-01T20:00:00.000Z",
        source: "window",
        actor_user_id: null,
      });
      await tickAt(Date.parse("2026-01-01T18:00:01Z"));
      expect(changes()).toHaveLength(before + 1);
      expect((await call(h, "GET", "/api/screen/ticker", as("content"))).json()).toMatchObject({
        text: evening.text,
        source: "window",
      });
    });

    it("lets a person's line win over the window, and the window return after a clear", async () => {
      await call(
        h,
        "PUT",
        "/api/screen/ticker",
        as("ticker", { text: "Doors close", until: null }),
      );
      expect(changes().at(-1)).toMatchObject({ text: "Doors close", source: "admin" });
      await call(h, "DELETE", "/api/screen/ticker", as("ticker"));
      expect(changes().at(-1)).toMatchObject({ text: evening.text, source: "window" });
    });

    it("announces the window's end", async () => {
      const before = changes().length;
      await tickAt(Date.parse("2026-01-01T20:00:00Z"));
      expect(changes()).toHaveLength(before + 1);
      expect(changes().at(-1)).toMatchObject({ text: null, source: null });
    });

    it("deletes a window, audited, and announces the change when it was showing", async () => {
      await tickAt(Date.parse("2026-01-08T19:00:00Z"));
      expect(changes().at(-1)).toMatchObject({ source: "window" });
      const before = changes().length;
      const res = await call(h, "DELETE", `/api/screen/ticker/windows/${windowId}`, as("ticker"));
      expect(res.statusCode).toBe(204);
      expect(h.audits.at(-1)).toMatchObject({
        action: "screen.ticker_window.deleted",
        target: { type: "ticker_window", id: windowId },
      });
      expect(changes()).toHaveLength(before + 1);
      expect(changes().at(-1)).toMatchObject({ text: null, actor_user_id: "u_ticker" });
      const again = await call(h, "DELETE", `/api/screen/ticker/windows/${windowId}`, as("ticker"));
      expect(again.statusCode).toBe(404);
      expect((await call(h, "GET", "/api/screen/ticker/windows", as("ticker"))).json()).toEqual({
        windows: [],
      });
    });

    it("keeps windows per event", async () => {
      await call(h, "POST", "/api/screen/ticker/windows", as("admin", evening, "beta.test"));
      expect((await call(h, "GET", "/api/screen/ticker/windows", as("ticker"))).json()).toEqual({
        windows: [],
      });
    });
  });
});
