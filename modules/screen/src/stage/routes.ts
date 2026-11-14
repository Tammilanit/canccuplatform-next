/**
 * `GET /api/screen/art/{art_id}.webp` (contracts/screen.md, The stage): the blurred game art the
 * stage's state names, for the event's devices and sessions with `screen.devices.read`. Read from
 * the current tenant's cache only, so an id never reaches another event's art.
 */
import type { FastifyInstance } from "fastify";
import type { RightsChecker } from "@canccu/kit";
import type { Db } from "../db.js";
import { contentAccess } from "../assets/serve.js";
import { notFound } from "../http.js";
import type { ArtCache } from "./art.js";

const ART_NAME = /^([a-f0-9]{64})\.webp$/;

export function artRoutes(
  app: FastifyInstance,
  deps: { db: Db; rights: RightsChecker; art: ArtCache },
): void {
  const access = contentAccess(app, deps, "screen.devices.read");
  app.get("/api/screen/art/:art", { preHandler: access }, async (request, reply) => {
    const id = ART_NAME.exec((request.params as { art: string }).art)?.[1];
    if (id === undefined) throw notFound();
    const bytes = await deps.art.bytes(id);
    if (bytes === null) throw notFound();
    // Content-addressed, so it never changes; `private`, as only the event's screens may read it.
    return reply
      .header("content-type", "image/webp")
      .header("cache-control", "private, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .send(bytes);
  });
}
