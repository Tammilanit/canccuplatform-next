/** The current theme and the served theme files (contracts/theming.md, Upload safety). */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  KitError,
  NotSignedIn,
  checkAdminAccess,
  checkInfoAccess,
  sessionIdFromCookie,
} from "@canccu/kit";
import type { RightsChecker, TenantContext } from "@canccu/kit";
import { requireRight } from "@canccu/kit/fastify";
import type { Db } from "./db.js";
import { CONTENT_TYPES, FILE_NAME, extOf } from "./files.js";
import type { FileStore } from "./files.js";
import { currentTheme } from "./theme.js";
import type { Builtins } from "./theme.js";

export interface RouteDeps {
  db: Db;
  files: FileStore;
  builtins: Builtins;
  rights: RightsChecker;
}

const notFound = (): KitError => new KitError("Not found.", { status: 404, code: "not_found" });

function tenantOf(request: FastifyRequest): TenantContext {
  // installTenancy sets it on every route of this module; null would be a wiring bug.
  if (request.tenant === null) throw notFound();
  return request.tenant;
}

/** Signed in counts as a member; no session, or an expired one, is a guest. */
async function viewer(request: FastifyRequest, rights: RightsChecker): Promise<"guest" | "member"> {
  if (sessionIdFromCookie(request.headers.cookie) === undefined) return "guest";
  try {
    await rights.session(request.headers.cookie);
    return "member";
  } catch (err) {
    if (err instanceof NotSignedIn) return "guest";
    throw err;
  }
}

const SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

function sendFile(reply: FastifyReply, name: string, bytes: Buffer, cache: string): FastifyReply {
  const ext = extOf(name);
  void reply
    .header("content-type", CONTENT_TYPES[ext])
    .header("x-content-type-options", "nosniff")
    .header("cross-origin-resource-policy", "same-origin")
    .header("cache-control", cache);
  if (ext === "svg") {
    // Even opened on its own, an SVG runs nothing and is never shown inline as a page.
    void reply
      .header("content-security-policy", SVG_POLICY)
      .header("content-disposition", "attachment");
  }
  return reply.send(bytes);
}

export function themeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get("/api/theming/current", async (request, reply) => {
    const ctx = tenantOf(request);
    checkInfoAccess(ctx, { clientIp: request.ip, viewer: await viewer(request, deps.rights) });
    const theme = await deps.db.tenant((c) => currentTheme(c, deps.builtins));
    // Short-lived: surfaces switch on theming.theme.published, this read only catches up.
    void reply.header("cache-control", "no-cache");
    return theme;
  });

  // Public like the pages that link it; the file name is its content's hash, so it never changes.
  app.get<{ Params: { file: string } }>("/theming/a/:file", async (request, reply) => {
    const name = request.params.file;
    if (!FILE_NAME.test(name)) throw notFound();
    const builtin = deps.builtins.files.get(name);
    const cache = "public, max-age=31536000, immutable";
    if (builtin !== undefined) return sendFile(reply, name, builtin, cache);
    const kept = await deps.db.tenant(async (c) => {
      const { rows } = await c.query(
        `SELECT 1 FROM file_refs WHERE file = $1 AND owner <> 'draft' LIMIT 1`,
        [name],
      );
      return rows.length > 0 ? deps.files.read(name) : undefined;
    });
    if (kept === undefined) throw notFound();
    return sendFile(reply, name, kept, cache);
  });

  app.get<{ Params: { file: string } }>(
    "/theming/draft/:file",
    {
      preHandler: [
        async (request) => {
          checkAdminAccess(tenantOf(request), request.ip);
          await Promise.resolve();
        },
        requireRight(deps.rights, "theming.theme.write"),
      ],
    },
    async (request, reply) => {
      const name = request.params.file;
      if (!FILE_NAME.test(name)) throw notFound();
      const bytes = await deps.db.tenant(async (c) => {
        const { rows } = await c.query(
          `SELECT 1 FROM file_refs WHERE file = $1 AND owner = 'draft'`,
          [name],
        );
        return rows.length > 0 ? deps.files.read(name) : undefined;
      });
      if (bytes === undefined) throw notFound();
      return sendFile(reply, name, bytes, "no-store");
    },
  );
}
