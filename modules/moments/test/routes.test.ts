/**
 * The moments API: the crew spotlight, emergency (also venue-wide), ending and extending,
 * idempotent crew actions with their audit (E18, O4), priorities that re-rank live, rules,
 * history with CSV, a module's request, archived events, and privacy.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { ServiceIdentity } from "@canccu/kit";
import { DEFAULT_ORDER } from "../src/arbiter.js";
import { applyClaims } from "../src/placements.js";
import { addZone } from "../src/store.js";
import { DATABASE_URL, claims, freshDatabase } from "./helpers.js";
import { SERVICE_KEY, SUPERADMIN_HOST, appWorld, errorOf, idOf, json } from "./app.js";
import type { AppWorld } from "./app.js";

const run = DATABASE_URL ? describe : describe.skip;

run("the moments API", () => {
  let pool: pg.Pool | undefined;
  let w: AppWorld;
  beforeEach(async () => {
    // The world of the test before, if any: both are set together.
    if (pool !== undefined) {
      await w.app.close();
      await pool.end();
    }
    pool = await freshDatabase();
    w = await appWorld(pool);
    // One override per moment and zone (#777): a moment shows on the zones Moments knows.
    await w.tx("demo", (c) => addZone(c, "main"));
  });
  afterAll(async () => {
    await w.app.close();
    await pool?.end();
  });

  const started = (tenant = "demo") =>
    w.events(tenant).filter((e) => e.type === "moments.override.started");

  it("starts a crew spotlight in the hero that says it is from the crew, never who", async () => {
    const r = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "Pizza is here",
      body: "Pick up at the café",
      qr: { path: "/notify/", label: "Scan for the hub" },
    });
    expect(r.statusCode).toBe(201);
    const [e] = started();
    expect(e?.data.override).toMatchObject({
      rank: 70,
      regions: ["hero"],
      template: "announcement",
      content: {
        title: "Pizza is here",
        from_crew: true,
        qr: { url: "https://demo.test/notify/", label: "Scan for the hub" },
      },
    });
    expect(JSON.stringify(e?.data.override)).not.toContain("Demo crew");
    expect(json(r)).toMatchObject({ origin: "crew", actor: { name: "Demo crew" } });
    expect(w.audit.map((a) => a.action)).toEqual(["moments.spotlight.started"]);
  });

  it("answers a repeated key as the first time and does nothing again (E18)", async () => {
    const body = { show: "message", title: "Once" };
    const a = await w.call("crew", "POST", "/api/moments/spotlight", body, {
      key: "phone-retry-1",
    });
    const b = await w.call("crew", "POST", "/api/moments/spotlight", body, {
      key: "phone-retry-1",
    });
    expect(b.statusCode).toBe(a.statusCode);
    expect(json(b)).toEqual(json(a));
    expect(started()).toHaveLength(1);
    expect(w.audit).toHaveLength(1);
    const none = await w.app.inject({
      method: "POST",
      url: "/api/moments/spotlight",
      headers: {
        host: "demo.test",
        cookie: "canccu_session=crew",
        "content-type": "application/json",
      },
      payload: JSON.stringify(body),
    });
    expect(none.statusCode).toBe(400);
  });

  it("needs moments.take for a spotlight, and refuses writes on an archived event", async () => {
    expect(
      (await w.call("reader", "POST", "/api/moments/spotlight", { show: "message", title: "x" }))
        .statusCode,
    ).toBe(403);
    const archived = await w.call(
      "admin",
      "POST",
      "/api/moments/spotlight",
      { show: "message", title: "x" },
      { host: "archived.test" },
    );
    expect(archived.statusCode).toBe(409);
    expect(errorOf(archived).code).toBe("event_archived");
  });

  it("runs an emergency on every zone at rank 100, one at a time, and ends it with All clear", async () => {
    expect((await w.call("crew", "POST", "/api/moments/emergency", {})).statusCode).toBe(403);
    const r = await w.call("admin", "POST", "/api/moments/emergency", {});
    expect(r.statusCode).toBe(201);
    expect(started()[0]?.data.override).toMatchObject({
      kind: "takeover",
      zones: [],
      rank: 100,
      regions: ["full"],
      expires_at: null,
      content: { title: "Please leave the hall", level: "emergency" },
    });
    expect(errorOf(await w.call("admin", "POST", "/api/moments/emergency", {})).code).toBe(
      "emergency_active",
    );
    const end = await w.call("admin", "POST", "/api/moments/emergency/end", { all_clear: true });
    expect(end.statusCode).toBe(200);
    const after = w.events("demo").slice(-2);
    expect(after[0]).toMatchObject({
      type: "moments.override.ended",
      data: { reason: "cleared", final: true },
    });
    expect(after[1]?.data.override).toMatchObject({
      content: { title: "All clear" },
      regions: ["rail", "ticker"],
    });
    expect(w.audit.map((a) => a.action)).toEqual([
      "moments.emergency.started",
      "moments.emergency.ended",
    ]);
    // Nothing else ends an emergency.
    const again = await w.call("admin", "POST", "/api/moments/emergency", {});
    const id = idOf(again);
    expect((await w.call("admin", "POST", `/api/moments/moments/${id}/end`, {})).statusCode).toBe(
      400,
    );
  });

  it("starts the superadmin's emergency on every event at the venue, only on the superadmin hostname", async () => {
    for (const host of ["demo.test", "two.test", "away.test"])
      await w.call("reader", "GET", "/api/moments/moments", undefined, { host });
    expect(
      (await w.call("super", "POST", "/api/moments/venue-emergency", { venue_id: "v_1" }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await w.call(
          "admin",
          "POST",
          "/api/moments/venue-emergency",
          { venue_id: "v_1" },
          { host: SUPERADMIN_HOST },
        )
      ).statusCode,
    ).toBe(403);
    const r = await w.call(
      "super",
      "POST",
      "/api/moments/venue-emergency",
      { venue_id: "v_1" },
      { host: SUPERADMIN_HOST },
    );
    expect(r.statusCode).toBe(200);
    expect((json(r).tenant_ids as string[]).sort()).toEqual(["demo", "two"]);
    expect(started("two")[0]?.data.override).toMatchObject({ rank: 100 });
    expect(started("away")).toHaveLength(0);
    const end = await w.call(
      "super",
      "POST",
      "/api/moments/venue-emergency/end",
      { venue_id: "v_1" },
      { host: SUPERADMIN_HOST },
    );
    expect(json(end).tenant_ids).toHaveLength(2);
  });

  it("ends a rule's moment on one zone only, and extends a crew moment", async () => {
    const module = new ServiceIdentity({ module: "games", key: SERVICE_KEY }).headers("moments");
    const req = await w.app.inject({
      method: "POST",
      url: "/internal/moments/moments?tenant_id=demo",
      headers: { ...module, "content-type": "application/json" },
      payload: JSON.stringify({
        class: "hot_game",
        template: "hot_game",
        content: { players: 3 },
        zones: ["main", "stage"],
      }),
    });
    expect(req.statusCode).toBe(201);
    const id = idOf(req);
    expect((await w.call("crew", "POST", `/api/moments/moments/${id}/end`, {})).statusCode).toBe(
      400,
    );
    const end = await w.call("crew", "POST", `/api/moments/moments/${id}/end`, {
      zone_key: "main",
    });
    expect(end.statusCode).toBe(200);
    expect(w.events("demo").at(-1)?.data).toMatchObject({
      override_id: `${id}.main`,
      zones: ["main"],
      final: true,
      reason: "cleared",
    });
    const spot = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "Longer",
    });
    const ext = await w.call("crew", "POST", `/api/moments/moments/${idOf(spot)}/extend`, {
      seconds: 300,
    });
    expect(json(ext).expires_at).toBe(new Date(w.now.getTime() + 600_000).toISOString());
  });

  it("refuses to end a moment on a zone it does not cover, and never narrows on an unknown zone", async () => {
    await w.tx("demo", (c) =>
      c.query(`INSERT INTO moments_zones (zone_key) VALUES ('main') ON CONFLICT DO NOTHING`),
    );
    const some = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "Main only",
      zones: ["main"],
    });
    const other = await w.call("crew", "POST", `/api/moments/moments/${idOf(some)}/end`, {
      zone_key: "stage",
    });
    expect(other.statusCode).toBe(400);
    const every = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "Everywhere",
    });
    const before = w.events("demo").length;
    const unknown = await w.call("crew", "POST", `/api/moments/moments/${idOf(every)}/end`, {
      zone_key: "nowhere",
    });
    expect(unknown.statusCode).toBe(400);
    expect(w.events("demo").length).toBe(before);
    const running = json(await w.call("reader", "GET", "/api/moments/moments")).moments as {
      id: string;
      zones: string[];
    }[];
    expect(running.map((m) => m.id).sort()).toEqual([idOf(some), idOf(every)].sort());
  });

  it("lets only one of two saves of one revision through, also before any order was saved", async () => {
    const order = [...DEFAULT_ORDER];
    const both = await Promise.all(
      [0, 1].map(() =>
        w.call("admin", "PUT", "/api/moments/priorities", { order, zones: [], revision: 0 }),
      ),
    );
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it("queues a module's moment when its regions are held, and needs the service identity", async () => {
    const top = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "Top",
      zones: ["main"],
    });
    await w.tx("demo", (c) => applyClaims(c, claims("main", [[idOf(top), "hero"]]), w.now));
    const body = JSON.stringify({
      class: "hot_game",
      template: "hot_game",
      content: {},
      regions: ["hero"],
      zones: ["main"],
    });
    const unsigned = await w.app.inject({
      method: "POST",
      url: "/internal/moments/moments?tenant_id=demo",
      payload: body,
      headers: { "content-type": "application/json" },
    });
    expect(unsigned.statusCode).toBe(401);
    const r = await w.app.inject({
      method: "POST",
      url: "/internal/moments/moments?tenant_id=demo",
      headers: {
        ...new ServiceIdentity({ module: "games", key: SERVICE_KEY }).headers("moments"),
        "content-type": "application/json",
      },
      payload: body,
    });
    // It waits in the queue instead of a refusal (#777).
    expect(r.statusCode).toBe(201);
  });

  it("re-ranks what runs when the order is saved, refuses a bad or stale order, and audits it", async () => {
    await w.call("crew", "POST", "/api/moments/spotlight", { show: "message", title: "Ranked" });
    const order = [...DEFAULT_ORDER];
    order.splice(order.indexOf("spotlight"), 1);
    order.splice(1, 0, "spotlight");
    const bad = await w.call("admin", "PUT", "/api/moments/priorities", {
      order: [...order.slice(1), "emergency"],
      zones: [],
      revision: 0,
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (await w.call("crew", "PUT", "/api/moments/priorities", { order, zones: [], revision: 0 }))
        .statusCode,
    ).toBe(403);
    const ok = await w.call("admin", "PUT", "/api/moments/priorities", {
      order,
      zones: [],
      revision: 0,
    });
    expect(ok.statusCode).toBe(200);
    expect(json(ok)).toMatchObject({ revision: 1, ranks: { spotlight: 90, stream: 80 } });
    expect(w.events("demo").at(-1)).toMatchObject({
      type: "moments.override.changed",
      data: { changed: ["rank"] },
    });
    expect(
      (await w.call("admin", "PUT", "/api/moments/priorities", { order, zones: [], revision: 0 }))
        .statusCode,
    ).toBe(409);
    expect(w.audit.at(-1)).toMatchObject({
      action: "moments.priorities.changed",
      changes: { order: { new: order } },
    });
  });

  it("carries the airtime settings, checks them and keeps them when a save leaves them out (#777)", async () => {
    const order = [...DEFAULT_ORDER];
    const first = json(await w.call("reader", "GET", "/api/moments/priorities"));
    const every30 = Object.fromEntries(order.map((c) => [c, 30]));
    expect(first.airtime).toEqual({
      min_on_air_seconds: 90,
      gap_seconds: 10,
      stale_after_minutes: every30,
    });
    const low = await w.call("admin", "PUT", "/api/moments/priorities", {
      order,
      zones: [],
      airtime: { min_on_air_seconds: 59 },
      revision: 0,
    });
    expect(low.statusCode).toBe(400);
    const ok = await w.call("admin", "PUT", "/api/moments/priorities", {
      order,
      zones: [],
      airtime: { min_on_air_seconds: 120, gap_seconds: 0, stale_after_minutes: { hot_game: 5 } },
      revision: 0,
    });
    expect(ok.statusCode).toBe(200);
    const saved = {
      min_on_air_seconds: 120,
      gap_seconds: 0,
      stale_after_minutes: { ...every30, hot_game: 5 },
    };
    expect(json(ok).airtime).toEqual(saved);
    expect(w.audit.at(-1)).toMatchObject({
      action: "moments.priorities.changed",
      changes: { airtime: { new: saved } },
    });
    const kept = await w.call("admin", "PUT", "/api/moments/priorities", {
      order,
      zones: [],
      revision: 1,
    });
    expect(json(kept).airtime).toEqual(saved);
  });

  it("keeps an event's saved order when the default changes (#777)", async () => {
    const old = [
      "emergency",
      "stream",
      "announcement",
      "spotlight",
      "storyboard",
      "tournament",
      "finals",
      "hot_game",
      "reactions",
      "ticker",
    ];
    await w.call("admin", "PUT", "/api/moments/priorities", { order: old, zones: [], revision: 0 });
    const got = json(await w.call("reader", "GET", "/api/moments/priorities"));
    expect(got.order).toEqual(old);
    expect(got.ranks).toMatchObject({ storyboard: 65, finals: 55 });
  });

  it("changes a rule's settings with its revision, audited with what changed", async () => {
    const { rules } = json(await w.call("reader", "GET", "/api/moments/rules")) as unknown as {
      rules: Record<string, unknown>[];
    };
    const pizza = rules.find((r) => r.rule_id === "pizza") ?? {};
    const r = await w.call("admin", "PUT", "/api/moments/rules/pizza", {
      ...pizza,
      enabled: false,
      ttl_seconds: 90,
    });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ enabled: false, ttl_seconds: 90, revision: 1 });
    expect(w.audit.at(-1)?.changes).toEqual({
      enabled: { old: true, new: false },
      ttl_seconds: { old: 300, new: 90 },
    });
    expect(
      (await w.call("admin", "PUT", "/api/moments/rules/pizza", { ...pizza, enabled: true }))
        .statusCode,
    ).toBe(409);
  });

  it("answers the history by zone, as JSON and as CSV that no spreadsheet runs", async () => {
    await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "=1+1",
      zones: ["main"],
    });
    const rows = json(await w.call("reader", "GET", "/api/moments/history?zone=main"))
      .rows as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      action: "started",
      title: "=1+1",
      why: "Demo crew · spotlight",
      actor_name: "Demo crew",
    });
    const csv = await w.call("reader", "GET", "/api/moments/history.csv?origin=crew");
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\r\n")[1]).toContain(",'=1+1,");
    expect((await w.call("reader", "GET", "/api/moments/history?origin=nobody")).statusCode).toBe(
      400,
    );
  });

  it("exports and forgets the caller's own rows", async () => {
    await w.call("crew", "POST", "/api/moments/spotlight", { show: "message", title: "Mine" });
    expect(json(await w.call("crew", "GET", "/api/moments/me/export")).history).toHaveLength(1);
    expect((await w.call("crew", "DELETE", "/api/moments/me")).statusCode).toBe(204);
    const rows = json(await w.call("reader", "GET", "/api/moments/history")).rows as Record<
      string,
      unknown
    >[];
    expect(rows[0]).toMatchObject({ actor_name: null, why: "A person · spotlight" });
  });

  it("lists what runs with where Screen placed it", async () => {
    const spot = await w.call("crew", "POST", "/api/moments/spotlight", {
      show: "message",
      title: "Placed",
    });
    // Screen saves a zone before it reports on it: a report alone adds no zone (#642).
    await w.tx("demo", async (c) => {
      await addZone(c, "main");
      await applyClaims(c, claims("main", [[`${idOf(spot)}.main`, "hero"]]), w.now);
    });
    const list = json(await w.call("reader", "GET", "/api/moments/moments"));
    expect(list.zones).toEqual(["main"]);
    expect((list.moments as unknown[])[0]).toMatchObject({
      rank: 70,
      placements: [{ zone_key: "main", state: "placed", role: "hero" }],
    });
  });
});
