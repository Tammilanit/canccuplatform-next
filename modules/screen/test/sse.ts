/** An SSE client for the push channel on a listening harness, and the bus pump main's subscription stands for. */
import { request } from "node:http";
import { expect } from "vitest";
import { parseEnvelope } from "@canccu/kit";
import { VENUE_IP, call, pairDevice } from "./helpers.js";
import type { Harness } from "./helpers.js";

export interface Frame {
  event: string;
  id: string;
  data: Record<string, unknown>;
}

export interface Sse {
  /** The next frame of `event` (pings skipped unless asked for). */
  next(event?: string, timeoutMs?: number): Promise<Frame>;
  status: Promise<number>;
  ended: Promise<void>;
  close(): void;
}

export function pushClient(h: Harness, port: number) {
  const consumed = new Map<string, number>();
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
    return connect("/api/screen/device/stream", {
      "x-forwarded-for": VENUE_IP,
      cookie: `canccu_device=${token}`,
      ...(lastEventId === undefined ? {} : { "last-event-id": lastEventId }),
    });
  }

  /** A signed-in person's stream of a zone (`session` is a SESSIONS key). */
  function openZone(path: string, session: string, lastEventId?: string): Sse {
    return connect(path, {
      "x-forwarded-for": VENUE_IP,
      cookie: `canccu_session=${session}`,
      ...(lastEventId === undefined ? {} : { "last-event-id": lastEventId }),
    });
  }

  function connect(path: string, headers: Record<string, string>): Sse {
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
        path,
        headers: { host: "alpha.test", ...headers },
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
  return { pump, open, openZone, screen };
}
