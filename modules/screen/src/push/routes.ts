/** `GET /api/screen/device/stream`, the push channel (contracts/screen.md, Push). */
import type { FastifyInstance, FastifyReply } from "fastify";
import { requireDevice } from "../device-access.js";
import { DEVICE_COOKIE, cookie, notFound, tenantOf } from "../http.js";
import type { HubDeps, PushHub } from "./hub.js";
import type { Feed } from "./feed.js";
import { DeviceStream } from "./stream.js";

/**
 * Serves `stream` as the answer to `reply`, for the device stream and a session's zone stream
 * alike: the hub reaches it while it is open, and a hang-up ends it. `start` gets what to run
 * once it has ended, and adds the stream's own cleanup.
 */
export function serveFeed(
  reply: FastifyReply,
  hub: PushHub,
  stream: Feed,
  start: (ended: () => void) => Promise<void>,
): FastifyReply {
  hub.add(stream);
  reply.raw.on("close", () => {
    stream.end();
  });
  void reply
    .header("content-type", "text/event-stream; charset=utf-8")
    // No proxy or browser may keep or buffer a live stream.
    .header("cache-control", "no-store")
    .header("x-accel-buffering", "no");
  void start(() => {
    hub.remove(stream);
  });
  // A client that hung up during the handler's awaits fired its `close` before the listener
  // above: end now, after `start`, so the stream's own cleanup (a session's slot) runs too.
  if (reply.request.raw.destroyed || reply.raw.destroyed) stream.end();
  return reply.send(stream.out);
}

export function streamRoutes(app: FastifyInstance, deps: HubDeps & { hub: PushHub }): void {
  app.get(
    "/api/screen/device/stream",
    { preHandler: requireDevice(deps.db, { now: () => new Date((deps.now ?? Date.now)()) }) },
    async (request, reply) => {
      // requireDevice sets it or answers 401; null here would be a wiring bug.
      if (request.device === null) throw notFound();
      const lastEventId = request.headers["last-event-id"];
      const stream = new DeviceStream(deps, {
        ctx: tenantOf(request),
        // The other modules resolve the event from the same hostname the screen used.
        host: request.headers.host ?? "",
        device: request.device,
        token: cookie(request, DEVICE_COOKIE) ?? "",
        ip: request.ip,
        lastEventId: typeof lastEventId === "string" ? lastEventId : undefined,
      });
      return serveFeed(reply, deps.hub, stream, (ended) => stream.start(ended));
    },
  );
  // Open streams would hold the server's close until their screens hang up.
  app.addHook("preClose", (done) => {
    deps.hub.close();
    done();
  });
}
