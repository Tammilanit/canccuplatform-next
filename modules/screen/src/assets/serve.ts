/**
 * `GET /api/screen/files/{file}` (contracts/screen.md, Content and scheduling): for the event's
 * devices and for sessions with `screen.content.read`. The name must resolve to a file row of
 * the current tenant, and the path is built from that row, never joined from the request.
 * Byte ranges are served, so a screen can resume a video at its bookmark.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { errorBody } from "@canccu/kit";
import type { RightsChecker } from "@canccu/kit";
import type { Db } from "../db.js";
import { requireDevice } from "../device-access.js";
import { DEVICE_COOKIE, cookie, needs, notFound } from "../http.js";
import { filePath } from "./files.js";

const FILE_NAME = /^[a-f0-9]{64}\.[a-z0-9]{1,8}$/;

/**
 * The one range a screen asks for (`bytes=a-b`, `bytes=a-`, `bytes=-n`): null serves the whole
 * file, as RFC 9110 has a server ignore a range it cannot parse or whose end comes before its
 * start; "unsatisfiable" is a range that starts past the end (or `bytes=-0`), answered 416.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): [number, number] | null | "unsatisfiable" {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    return suffix === 0 ? "unsatisfiable" : [Math.max(0, size - suffix), size - 1];
  }
  const start = Number(match[1]);
  if (match[2] !== "" && Number(match[2]) < start) return null;
  if (start >= size) return "unsatisfiable";
  return [start, match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1)];
}

export function fileRoutes(
  app: FastifyInstance,
  deps: { db: Db; rights: RightsChecker; filesRoot: string },
): void {
  const device = requireDevice(deps.db);
  const session = needs(deps.rights, "screen.content.read");
  // A device cookie means a screen: it passes the device check or nothing, never a session's.
  const access = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (cookie(request, DEVICE_COOKIE) !== undefined) {
      await device.call(app, request, reply);
      return;
    }
    for (const step of session) await step.call(app, request, reply);
  };

  app.get("/api/screen/files/:file", { preHandler: access }, async (request, reply) => {
    const { file } = request.params as { file: string };
    if (!FILE_NAME.test(file)) throw notFound();
    const row = await deps.db.tenant(async (c) => {
      const { rows } = await c.query("SELECT name, mime_type FROM screen_files WHERE name = $1", [
        file,
      ]);
      return rows[0] as { name: string; mime_type: string } | undefined;
    });
    if (row === undefined) throw notFound();
    const path = filePath(deps.filesRoot, row.name);
    const size = (await stat(path).catch(() => null))?.size;
    if (size === undefined) throw notFound();
    const range = parseRange(request.headers.range, size);
    void reply
      .header("content-type", row.mime_type)
      .header("cache-control", "private, max-age=31536000, immutable")
      .header("accept-ranges", "bytes")
      .header("x-content-type-options", "nosniff");
    if (range === "unsatisfiable") {
      return reply
        .status(416)
        .header("content-range", `bytes */${size}`)
        .type("application/json")
        .send(errorBody("invalid_request", "The range is outside the file."));
    }
    if (range === null) {
      return reply.header("content-length", size).send(createReadStream(path));
    }
    const [start, end] = range;
    return reply
      .status(206)
      .header("content-range", `bytes ${start}-${end}/${size}`)
      .header("content-length", end - start + 1)
      .send(createReadStream(path, { start, end }));
  });
}
