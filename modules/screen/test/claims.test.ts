/**
 * Claims end to end with fixture `moments.override.*` events (#307): Screen's copy of the
 * overrides, their placement in the composed state, `screen.claims.changed`, expiry without
 * Moments, and the heartbeat's `claims_sounded` kept for step 4.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newId, withTenant } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { applyOverrideEvent, loadOverrides } from "../src/compose/overrides.js";
import { DATABASE_URL, call, events, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Claim {
  override_id: string;
  hidden: boolean;
  role: string;
  expires_at: string | null;
}
interface State {
  state_version: number;
  regions: { id: string; claim: Claim | null }[];
  unplaced: string[];
  hidden: string[];
  sound: { sounded_claims: string[] };
}

const STARTS = "2026-01-01T12:00:00Z";

function override(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    kind: "block",
    zones: ["main"],
    rank: 80,
    source: { module: "moments", event_id: null, ref: null },
    template: "announcement",
    content: { title: "Dinner is served", body: "Café", level: "info", starts_at: STARTS },
    regions: ["rail", "ticker"],
    ttl_seconds: 300,
    sound: null,
    steps: null,
    on_end: "resume",
    starts_at: STARTS,
    ends_at: null,
    ...over,
  };
}

describe.skipIf(!DATABASE_URL)("claims", () => {
  let h: Harness;
  let token = "";

  beforeAll(async () => {
    h = await harness();
    h.sources.event = { name: "Demo Event" };
    h.sources.agenda = { current: [], next: [] };
    const device = await pairDevice(h);
    token = device.token;
    await call(h, "GET", "/api/screen/zones", { session: "admin" });
    const res = await call(h, "PUT", `/api/screen/devices/${device.id}/assignment`, {
      session: "admin",
      body: { zone_key: "main" },
    });
    expect(res.statusCode).toBe(200);
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    h.clock.now = Date.parse("2026-01-01T12:01:00Z");
    await withTenant("alpha", () => h.db.tenant((c) => c.query("DELETE FROM screen_claims")));
    await state();
  });

  /** A Moments event as the bus delivers it; made now, so it sorts after every earlier one. */
  const moment = (type: string, data: Record<string, unknown>): Event => ({
    id: newId(),
    type,
    version: 1,
    time: new Date(h.clock.now).toISOString(),
    source: "moments",
    tenant: "alpha",
    data: { actor_user_id: null, ...data },
  });
  const apply = (event: Event) => withTenant("alpha", () => applyOverrideEvent(h.db, event));
  const start = (o: Record<string, unknown>) =>
    apply(moment("moments.override.started", { override: o }));
  const end = (id: string, zones: string[] = []) =>
    apply(moment("moments.override.ended", { override_id: id, zones, reason: "cleared" }));
  const state = async () =>
    (
      await call(h, "GET", "/api/screen/device/state", { cookies: { canccu_device: token } })
    ).json<State>();
  const claims = (s: State) =>
    Object.fromEntries(
      s.regions.flatMap((r) =>
        r.claim === null
          ? []
          : [[r.id, `${r.claim.override_id}${r.claim.hidden ? " hidden" : ""}`]],
      ),
    );
  const reports = () => events(h, "screen.claims.changed");

  it("places a block in the rail, and tells Moments once", async () => {
    const before = reports().length;
    await start(override("ov_10"));
    const s = await state();
    expect(claims(s)).toEqual({ rail: "ov_10" });
    expect(s.regions.find((r) => r.id === "rail")?.claim?.expires_at).toBe(
      "2026-01-01T12:05:00.000Z",
    );
    expect([s.unplaced, s.hidden]).toEqual([[], []]);
    await state();
    expect(reports().slice(before)).toEqual([
      {
        zone_key: "main",
        placed: [{ override_id: "ov_10", role: "rail" }],
        unplaced: [],
        hidden: [],
      },
    ]);
  });

  it("hides lower claims under a takeover and brings them back when it ends", async () => {
    await start(override("ov_10"));
    await state();
    const before = reports().length;
    await start(override("ov_11", { kind: "takeover", zones: [], rank: 100, regions: null }));
    const s = await state();
    expect(claims(s)).toEqual({ _full: "ov_11", rail: "ov_10 hidden" });
    expect(s.hidden).toEqual(["ov_10"]);
    await end("ov_11");
    expect(claims(await state())).toEqual({ rail: "ov_10" });
    expect(reports().slice(before)).toEqual([
      {
        zone_key: "main",
        placed: [
          { override_id: "ov_11", role: "full" },
          { override_id: "ov_10", role: "rail" },
        ],
        unplaced: [],
        hidden: ["ov_10"],
      },
      {
        zone_key: "main",
        placed: [{ override_id: "ov_10", role: "rail" }],
        unplaced: [],
        hidden: [],
      },
    ]);
  });

  it("lists what finds no role as unplaced", async () => {
    await start(override("a", { regions: ["rail"], rank: 90 }));
    await start(override("b", { regions: ["rail"], rank: 10 }));
    const s = await state();
    expect(claims(s)).toEqual({ rail: "a" });
    expect(s.unplaced).toEqual(["b"]);
  });

  it("renews without moving anything, and ends at its expiry without Moments", async () => {
    await start(override("ov_10"));
    const placed = await state();
    const before = reports().length;
    await apply(
      moment("moments.override.changed", {
        override: override("ov_10", { expires_at: "2026-01-01T12:10:00Z" }),
        changed: ["expires_at"],
      }),
    );
    const renewed = await state();
    expect(renewed.regions.find((r) => r.id === "rail")?.claim?.expires_at).toBe(
      "2026-01-01T12:10:00Z",
    );
    expect(renewed.state_version).toBe(placed.state_version + 1);
    expect(reports().length).toBe(before);

    h.clock.now = Date.parse("2026-01-01T12:10:00Z");
    expect(claims(await state())).toEqual({});
    expect(reports().at(-1)).toEqual({ zone_key: "main", placed: [], unplaced: [], hidden: [] });
  });

  it("keeps the newest word on an override when events come twice or late", async () => {
    const started = moment("moments.override.started", { override: override("ov_10") });
    const ended = moment("moments.override.ended", {
      override_id: "ov_10",
      zones: [],
      reason: "cleared",
    });
    await apply(started);
    await apply(ended);
    // A replay from the stream's start, or a container that lags: the older event loses.
    await apply(started);
    expect(claims(await state())).toEqual({});
    const late = moment("moments.override.changed", { override: override("ov_10"), changed: [] });
    await apply(late);
    expect(claims(await state())).toEqual({});
  });

  it("leaves only the zones an end names, and stays on the rest", async () => {
    await start(override("ov_12", { zones: [] }));
    await end("ov_12", ["cafe"]);
    const ids = (zone: string) =>
      withTenant("alpha", () => h.db.tenant((c) => loadOverrides(c, zone, h.clock.now))).then(
        (list) => list.map((o) => o.id),
      );
    expect(await ids("main")).toEqual(["ov_12"]);
    expect(await ids("cafe")).toEqual([]);
    await start(override("ov_13", { zones: ["main", "cafe"] }));
    await end("ov_13", ["main", "cafe"]);
    expect(await ids("main")).toEqual(["ov_12"]);
  });

  it("drops a malformed override and other events of the stream", async () => {
    await start(override("bad", { kind: "banner" }));
    await apply(moment("moments.something.else", { override: override("x") }));
    expect(claims(await state())).toEqual({});
  });

  it("validates the heartbeat's claims_sounded and keeps sounded_claims empty until step 4", async () => {
    await start(
      override("ov_10", { sound: { cue: "announce", url: null, volume: 1, play: "once" } }),
    );
    const beat = (claimsSounded: unknown) =>
      call(h, "POST", "/api/screen/device/heartbeat", {
        cookies: { canccu_device: token },
        body: {
          state_version: 1,
          bundle_version: "b1",
          theme_revision: 0,
          claims_sounded: claimsSounded,
        },
      });
    expect((await beat(["ov_10"])).statusCode).toBe(200);
    expect((await beat([7])).statusCode).toBe(400);
    expect((await state()).sound.sounded_claims).toEqual([]);
  });

  it("shows the hub the zone's active claims", async () => {
    await start(override("ov_10"));
    const res = await call(h, "GET", "/api/screen/now?zone=main");
    const rail = res.json<State>().regions.find((r) => r.id === "rail");
    expect(rail?.claim?.override_id).toBe("ov_10");
  });
});
