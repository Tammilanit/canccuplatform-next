/**
 * A zone for a signed-in person (contracts/screen.md, Preview and A zone for a session): the
 * zone's state and stream as a mirror's, and the preview of an unsaved zone.
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, SESSIONS, call, code, events, harness } from "./helpers.js";
import type { Harness } from "./helpers.js";
import { pushClient } from "./sse.js";
import { MAX_PREVIEWS_PER_MINUTE, MAX_SESSION_STREAMS } from "../src/push/zone-routes.js";

interface State {
  state_version: number;
  device: { id: string; name: string; mirror: boolean };
  zone: { key: string; name: string; epoch: string };
  layout: { id: string } | null;
  sound: { enabled: boolean };
}

const ZONE = {
  key: "stage",
  name: "Stage",
  layout_id: null,
  regions: {},
  sound: { enabled: true, device_id: null },
};

describe.skipIf(!DATABASE_URL)("a zone for a signed-in person", () => {
  let h: Harness;
  let client: ReturnType<typeof pushClient>;

  beforeAll(async () => {
    h = await harness();
    await h.app.listen({ host: "127.0.0.1", port: 0 });
    client = pushClient(h, (h.app.server.address() as AddressInfo).port);
    h.sources.event = { name: "Demo Event" };
    expect((await call(h, "GET", "/api/screen/zones", { session: "admin" })).statusCode).toBe(200);
  });
  afterAll(async () => {
    await h.close();
  });

  const zoneState = (session: string, query = "") =>
    call(h, "GET", `/api/screen/zones/main/state${query}`, { session });

  describe("its state", () => {
    it("is the zone's own, as a mirror that never sounds", async () => {
      const res = await zoneState("crew");
      expect(res.statusCode).toBe(200);
      const state = res.json<State>();
      expect(state.device).toEqual({ id: "mirror", name: "Main", mirror: true });
      expect(state.sound.enabled).toBe(false);
      expect(state.zone.key).toBe("main");
      expect(state.zone.epoch).not.toBe("preview");
      expect(state.state_version).toBeGreaterThan(0);
      expect(state.layout?.id).toBe("pulse");
    });

    it("stands for a portrait screen with `orientation=portrait`", async () => {
      const res = await zoneState("crew", "?orientation=portrait");
      expect(res.json<State>().layout?.id).toBe("pulse_portrait");
      expect((await zoneState("crew", "?orientation=sideways")).statusCode).toBe(400);
    });

    it("needs a session with `screen.devices.read`, and a zone that exists", async () => {
      expect((await call(h, "GET", "/api/screen/zones/main/state")).statusCode).toBe(401);
      expect((await zoneState("content")).statusCode).toBe(403);
      const missing = await call(h, "GET", "/api/screen/zones/nowhere/state", { session: "crew" });
      expect(missing.statusCode).toBe(404);
      expect(code(missing)).toBe("not_found");
    });
  });

  describe("its stream", () => {
    it("pushes changes as a device's stream does, without commands", async () => {
      const sse = client.openZone("/api/screen/zones/main/stream", "crew");
      expect(await sse.status).toBe(200);
      const first = await sse.next();
      expect(first.event).toBe("state");
      expect(first.data.device).toMatchObject({ id: "mirror", mirror: true });
      const zone = first.data.zone as { epoch: string };
      const version = first.data.state_version as number;
      expect(first.id).toBe(`main.${zone.epoch}.${version}`);

      // A device of the zone gets a command; the person's page never does.
      const { id } = await client.screen("main");
      await call(h, "POST", `/api/screen/devices/${id}/commands`, {
        session: "admin",
        body: { command: "identify" },
      });
      await call(h, "PUT", "/api/screen/ticker", {
        session: "admin",
        body: { text: "Doors at ten", until: null },
      });
      client.pump();
      const pushed = await sse.next();
      expect(pushed.event).not.toBe("command");
      const later = pushed.event === "ticker" ? pushed : await sse.next("ticker");
      expect(later.data.ticker).toMatchObject({ text: "Doors at ten" });
      sse.close();
      await sse.ended;
    });

    it("resumes with Last-Event-ID", async () => {
      const sse = client.openZone("/api/screen/zones/main/stream", "crew");
      const first = await sse.next("state");
      sse.close();
      await sse.ended;
      await call(h, "PUT", "/api/screen/ticker", {
        session: "admin",
        body: { text: "Bring a cup", until: null },
      });
      await zoneState("crew");
      const resumed = client.openZone("/api/screen/zones/main/stream", "crew", first.id);
      const missed = await resumed.next();
      expect(missed.event).toBe("ticker");
      expect(missed.data.ticker).toMatchObject({ text: "Bring a cup" });
      resumed.close();
      await resumed.ended;
    });

    it("refuses a missing zone or right before it opens", async () => {
      const missing = client.openZone("/api/screen/zones/nowhere/stream", "crew");
      expect(await missing.status).toBe(404);
      const nobody = client.openZone("/api/screen/zones/main/stream", "content");
      expect(await nobody.status).toBe(403);
    });

    it("ends when the session loses its right, and when the zone is removed", async () => {
      SESSIONS.leaver = ["screen.devices.read"];
      const sse = client.openZone("/api/screen/zones/main/stream", "leaver");
      await sse.next("state");
      delete SESSIONS.leaver;
      h.rights.handleEvent({
        type: "admin.rights.changed",
        data: { user_id: "u_leaver" },
      } as unknown as Parameters<Harness["rights"]["handleEvent"]>[0]);
      await sse.ended;

      expect(
        (await call(h, "POST", "/api/screen/zones", { session: "admin", body: ZONE })).statusCode,
      ).toBe(201);
      const stage = client.openZone("/api/screen/zones/stage/stream", "crew");
      await stage.next("state");
      expect(
        (await call(h, "DELETE", "/api/screen/zones/stage", { session: "admin" })).statusCode,
      ).toBe(204);
      client.pump();
      await stage.ended;
    });

    it(`holds at most ${MAX_SESSION_STREAMS} open streams per session`, async () => {
      const open = Array.from({ length: MAX_SESSION_STREAMS }, () =>
        client.openZone("/api/screen/zones/main/stream", "crew"),
      );
      for (const sse of open) expect(await sse.status).toBe(200);
      const one = client.openZone("/api/screen/zones/main/stream", "crew");
      expect(await one.status).toBe(429);
      // Another person's views are their own.
      const admin = client.openZone("/api/screen/zones/main/stream", "admin");
      expect(await admin.status).toBe(200);
      for (const sse of [...open, admin]) sse.close();
      await Promise.all([...open, admin].map((s) => s.ended));
      await new Promise((r) => setTimeout(r, 50));
      const again = client.openZone("/api/screen/zones/main/stream", "crew");
      expect(await again.status).toBe(200);
      again.close();
    });
  });

  describe("the preview", () => {
    const preview = (body: unknown, session = "admin", key = "lobby", query = "") =>
      call(h, "POST", `/api/screen/zones/${key}/preview${query}`, { session, body });

    it("answers the state a new zone would have, and saves and emits nothing", async () => {
      const before = h.store.streams.get("t:alpha:events:screen")?.length ?? 0;
      const res = await preview({ ...ZONE, key: "lobby", name: "Lobby" });
      expect(res.statusCode).toBe(200);
      const state = res.json<State>();
      expect(state.device).toEqual({ id: "preview", name: "Lobby", mirror: true });
      expect(state.state_version).toBe(0);
      expect(state.zone).toEqual({ key: "lobby", name: "Lobby", epoch: "preview" });
      expect(state.sound.enabled).toBe(false);
      expect(state.layout?.id).toBe("pulse");
      expect(h.store.streams.get("t:alpha:events:screen")?.length ?? 0).toBe(before);
      expect(events(h, "screen.zone.saved").some((e) => e.zone_key === "lobby")).toBe(false);
      const zones = await call(h, "GET", "/api/screen/zones", { session: "admin" });
      expect(zones.json<{ zones: { key: string }[] }>().zones.map((z) => z.key)).not.toContain(
        "lobby",
      );
    });

    it("draws a saved zone's proposed change, also for a portrait screen", async () => {
      const res = await preview(
        { ...ZONE, key: "main", name: "Main renamed", layout_id: "pulse_portrait" },
        "admin",
        "main",
        "?orientation=portrait",
      );
      expect(res.statusCode).toBe(200);
      expect(res.json<State>().zone.name).toBe("Main renamed");
    });

    it("refuses a body for another key, an unknown layout and a missing right", async () => {
      const other = await preview({ ...ZONE, key: "other" });
      expect(other.statusCode).toBe(400);
      expect(code(other)).toBe("invalid_request");
      const layout = await preview({ ...ZONE, key: "lobby", layout_id: "nope" });
      expect(layout.statusCode).toBe(400);
      expect(code(layout)).toBe("unknown_layout");
      expect((await preview({ ...ZONE, key: "lobby" }, "crew")).statusCode).toBe(403);
    });

    it(`allows ${MAX_PREVIEWS_PER_MINUTE} previews a minute per session`, async () => {
      SESSIONS.previewer = ["screen.zones.write"];
      const body = { ...ZONE, key: "lobby" };
      for (let i = 0; i < MAX_PREVIEWS_PER_MINUTE; i++) {
        expect((await preview(body, "previewer")).statusCode).toBe(200);
      }
      const over = await preview(body, "previewer");
      expect(over.statusCode).toBe(429);
      expect(code(over)).toBe("rate_limited");
      h.clock.now += 61_000;
      expect((await preview(body, "previewer")).statusCode).toBe(200);
    });

    it("counts only previews it accepts", async () => {
      SESSIONS.refused = ["screen.zones.write"];
      const bad = { ...ZONE, key: "lobby", layout_id: "nope" };
      for (let i = 0; i < MAX_PREVIEWS_PER_MINUTE; i++) {
        expect(code(await preview(bad, "refused"))).toBe("unknown_layout");
      }
      expect((await preview({ ...ZONE, key: "lobby" }, "refused")).statusCode).toBe(200);
    });
  });
});
