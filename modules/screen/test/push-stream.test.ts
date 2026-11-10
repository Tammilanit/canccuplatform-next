/**
 * The push channel end to end on a listening server (inject cannot read a response that never
 * ends): the first state, pushed changes, resume, commands, reassignment, revocation, and an
 * open stream counting as seen. The bus is fed to the hub by hand, as main's subscription does.
 */
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnvelope } from "@canccu/kit";
import type { Event } from "@canccu/kit";
import { DATABASE_URL, TENANTS, VENUE_IP, call, context, harness, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

interface Frame {
  event: string;
  id: string;
  data: Record<string, unknown>;
}

interface Sse {
  /** The next frame of `event` (pings skipped unless asked for). */
  next(event?: string, timeoutMs?: number): Promise<Frame>;
  status: Promise<number>;
  ended: Promise<void>;
  close(): void;
}

describe.skipIf(!DATABASE_URL)("the push channel", () => {
  let h: Harness;
  let port: number;
  const consumed = new Map<string, number>();

  beforeAll(async () => {
    h = await harness();
    await h.app.listen({ host: "127.0.0.1", port: 0 });
    port = (h.app.server.address() as AddressInfo).port;
    h.sources.event = { name: "Demo Event" };
  });
  afterAll(async () => {
    await h.close();
  });

  /** Hand the hub the events published since the last pump, as main's subscription would. */
  function pump(tenant = "alpha"): void {
    for (const module of ["screen"]) {
      const stream = `t:${tenant}:events:${module}`;
      const entries = h.store.streams.get(stream) ?? [];
      for (const [, fields] of entries.slice(consumed.get(stream) ?? 0)) {
        h.app.pushHub.handleEvent(parseEnvelope(fields.event ?? ""));
      }
      consumed.set(stream, entries.length);
    }
  }

  function open(token: string, lastEventId?: string): Sse {
    const frames: Frame[] = [];
    const waiters: (() => void)[] = [];
    let status!: (code: number) => void;
    let ended!: () => void;
    const statusP = new Promise<number>((r) => (status = r));
    const endedP = new Promise<void>((r) => (ended = r));
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/screen/device/stream",
        headers: {
          host: "alpha.test",
          "x-forwarded-for": VENUE_IP,
          cookie: `canccu_device=${token}`,
          ...(lastEventId === undefined ? {} : { "last-event-id": lastEventId }),
        },
      },
      (res) => {
        status(res.statusCode ?? 0);
        let buffer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let cut;
          while ((cut = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const line = (name: string) =>
              block
                .split("\n")
                .find((l) => l.startsWith(`${name}: `))
                ?.slice(name.length + 2);
            const event = line("event");
            if (event === undefined) continue;
            frames.push({
              event,
              id: line("id") ?? "",
              data: JSON.parse(line("data") ?? "{}") as Frame["data"],
            });
            for (const w of waiters.splice(0)) w();
          }
        });
        res.on("end", ended);
        res.on("close", ended);
      },
    );
    req.on("error", () => {
      ended();
    });
    req.end();
    return {
      status: statusP,
      ended: endedP,
      close: () => req.destroy(),
      next: async (event, timeoutMs = 3000) => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const i = frames.findIndex((f) => (event ? f.event === event : f.event !== "ping"));
          if (i >= 0) return frames.splice(0, i + 1).at(-1) as Frame;
          const left = deadline - Date.now();
          if (left <= 0) throw new Error(`no ${event ?? "frame"} within ${timeoutMs} ms`);
          await new Promise<void>((resolve) => {
            waiters.push(resolve);
            setTimeout(resolve, left);
          });
        }
      },
    };
  }

  async function screen(zone = "main"): Promise<{ id: string; token: string }> {
    const device = await pairDevice(h);
    await call(h, "GET", "/api/screen/zones", { session: "admin" });
    const res = await call(h, "PUT", `/api/screen/devices/${device.id}/assignment`, {
      session: "admin",
      body: { zone_key: zone },
    });
    expect(res.statusCode).toBe(200);
    // Taken off the bus now, so only what each test does reaches its streams.
    pump();
    return device;
  }

  const ticker = (text: string) =>
    call(h, "PUT", "/api/screen/ticker", { session: "admin", body: { text, until: null } });

  it("refuses a browser without a device", async () => {
    const sse = open("nope");
    expect(await sse.status).toBe(401);
    sse.close();
  });

  it("opens with the whole state, then pushes a ticker change as one `ticker` message", async () => {
    const { token } = await screen();
    const sse = open(token);
    expect(await sse.status).toBe(200);
    const first = await sse.next();
    expect(first.event).toBe("state");
    const zone = first.data.zone as { key: string; epoch: string };
    const version = first.data.state_version as number;
    expect(first.id).toBe(`main.${zone.epoch}.${version}`);

    const started = Date.now();
    expect((await ticker("Doors close at ten")).statusCode).toBe(200);
    pump();
    const pushed = await sse.next();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(pushed).toMatchObject({
      event: "ticker",
      id: `main.${zone.epoch}.${version + 1}`,
      data: { state_version: version + 1, ticker: { text: "Doors close at ten" } },
    });
    sse.close();
  });

  it("resumes with the changes since Last-Event-ID, and sends a state when it cannot", async () => {
    const { token } = await screen();
    const sse = open(token);
    const first = await sse.next("state");
    sse.close();
    await sse.ended;
    // No stream is open now: the next read builds the change, as a polling screen's would.
    await ticker("Bring your own cup");
    await call(h, "GET", "/api/screen/device/state", { cookies: { canccu_device: token } });

    const resumed = open(token, first.id);
    const missed = await resumed.next();
    expect(missed.event).toBe("ticker");
    expect(missed.data.ticker).toMatchObject({ text: "Bring your own cup" });
    resumed.close();

    const epoch = (first.data.zone as { epoch: string }).epoch;
    for (const stale of [`main.other.${String(first.data.state_version)}`, `main.${epoch}.999`]) {
      const fresh = open(token, stale);
      expect((await fresh.next()).event).toBe("state");
      fresh.close();
    }
  });

  it("rebuilds a zone with streams on the refresh too, in one container per period", async () => {
    const { token } = await screen();
    const sse = open(token);
    await sse.next("state");
    // A change whose event no container read (it came while none ran).
    await ticker("Late shuttle at two");
    await h.app.pushHub.refreshAll();
    const pushed = await sse.next();
    expect(pushed.data.ticker).toMatchObject({ text: "Late shuttle at two" });
    // The claim for this period is taken: another container's refresh builds nothing.
    await ticker("Later shuttle at three");
    await h.app.pushHub.refreshAll();
    const later: Frame[] = [];
    await sse
      .next(undefined, 400)
      .then((f) => later.push(f))
      .catch(() => undefined);
    // Only the rest of the first change (the ticker widget's view) may still arrive.
    expect(later.every((f) => f.data.state_version === pushed.data.state_version)).toBe(true);
    sse.close();
  });

  it("delivers a command once, as a `command` message", async () => {
    const { id, token } = await screen();
    const sse = open(token);
    await sse.next("state");
    const sent = await call(h, "POST", `/api/screen/devices/${id}/commands`, {
      session: "admin",
      body: { command: "identify" },
    });
    expect(sent.statusCode).toBe(202);
    const command = await sse.next("command");
    expect(command.data).toMatchObject({ command: "identify" });
    expect(typeof command.data.expires_at).toBe("string");
    await sse.next("ping");
    await sse.next("ping");
    await expect(sse.next("command", 300)).rejects.toThrow();
    sse.close();
  });

  it("sends a new state when the device moves to another zone", async () => {
    const { id, token } = await screen();
    const zone = { key: "cafe", name: "Café", layout_id: "pulse", regions: {} };
    expect(
      (await call(h, "POST", "/api/screen/zones", { session: "admin", body: zone })).statusCode,
    ).toBe(201);
    const sse = open(token);
    await sse.next("state");
    await call(h, "PUT", `/api/screen/devices/${id}/assignment`, {
      session: "admin",
      body: { zone_key: "cafe" },
    });
    pump();
    const moved = await sse.next();
    expect(moved.event).toBe("state");
    expect(moved.data.zone).toMatchObject({ key: "cafe" });
    expect(moved.id.startsWith("cafe.")).toBe(true);
    sse.close();
  });

  it("ends the stream when the device is revoked", async () => {
    const { id, token } = await screen();
    const sse = open(token);
    await sse.next("state");
    await call(h, "POST", `/api/screen/devices/${id}/revoke`, { session: "admin" });
    pump();
    await sse.ended;
    const again = open(token);
    expect(await again.status).toBe(401);
    again.close();
  });

  it("ends the stream at the next ping once the venue check refuses the screen", async () => {
    const { token } = await screen();
    const sse = open(token);
    await sse.next("state");
    const before = TENANTS["alpha.test"];
    TENANTS["alpha.test"] = context("alpha", {
      venue: { id: "v_1", name: "Demo Hall", addresses: ["10.1.0.0/24"] },
    });
    try {
      h.tenants.handleEvent({ source: "tenants", tenant: "alpha" } as Event);
      await sse.ended;
      const again = open(token);
      expect(await again.status).toBe(403);
      again.close();
    } finally {
      TENANTS["alpha.test"] = before as (typeof TENANTS)[string];
      h.tenants.handleEvent({ source: "tenants", tenant: "alpha" } as Event);
    }
  });

  it("counts an open stream as seen, and shows the lag behind the zone", async () => {
    const { id, token } = await screen();
    const health = async () =>
      (await call(h, "GET", "/api/screen/devices", { session: "admin" }))
        .json<{ devices: { id: string; health: Record<string, unknown> }[] }>()
        .devices.find((d) => d.id === id)?.health;
    const sse = open(token);
    const first = await sse.next("state");
    expect(await health()).toMatchObject({ online: true });
    expect(typeof (await health())?.last_seen_at).toBe("string");
    h.clock.now += 40_000;
    await sse.next("ping");
    await sse.next("ping");
    expect(await health()).toMatchObject({
      online: true,
      last_seen_at: new Date(h.clock.now).toISOString(),
    });
    const version = first.data.state_version as number;
    const beat = await call(h, "POST", "/api/screen/device/heartbeat", {
      cookies: { canccu_device: token },
      body: { state_version: version - 1, bundle_version: "test", theme_revision: 0 },
    });
    expect(beat.statusCode).toBe(200);
    expect((await health())?.state_lag).toBe(1);
    sse.close();
  });
});
