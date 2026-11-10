/** `GET /api/screen/device/stream`, the push channel (contracts/screen.md, Push). */
import type { FastifyInstance } from "fastify";
import { requireDevice } from "../device-access.js";
import { DEVICE_COOKIE, cookie, notFound, tenantOf } from "../http.js";
import type { HubDeps, PushHub } from "./hub.js";
import { DeviceStream } from "./stream.js";

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
      deps.hub.add(stream);
      reply.raw.on("close", () => {
        stream.end();
      });
      void reply
        .header("content-type", "text/event-stream; charset=utf-8")
        // No proxy or browser may keep or buffer a live stream.
        .header("cache-control", "no-store")
        .header("x-accel-buffering", "no");
      void stream.start(() => {
        deps.hub.remove(stream);
      });
      return reply.send(stream.out);
    },
  );
  // Open streams would hold the server's close until their screens hang up.
  app.addHook("preClose", (done) => {
    deps.hub.close();
    done();
  });
}
