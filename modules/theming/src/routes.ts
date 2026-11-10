/** The current theme and the served theme files (contracts/theming.md, Upload safety). */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  InfoPagesClosed,
  NotSignedIn,
  checkInfoAccess,
  requireTenant,
  sessionIdFromCookie,
} from "@canccu/kit";
import type { RightsChecker, Session } from "@canccu/kit";
import type { Db } from "./db.js";
import { CONTENT_TYPES, FILE_NAME, extOf } from "./files.js";
import type { FileStore } from "./files.js";
import { needs, notFound, tenantOf } from "./http.js";
import type { ProfileSource } from "./profile.js";
import { resolvedRevision, revisionZero } from "./theme.js";

export interface RouteDeps {
  db: Db;
  files: FileStore;
  profile: ProfileSource;
  rights: RightsChecker;
}

/**
 * Until the tenants membership API lands (#150), any valid session on the event's hostname counts
 * as a member, as in the agenda module. #150 replaces this one check.
 */
function isMember(session: Session): boolean {
  return session.expiresAt.getTime() > Date.now();
}

/**
 * The info-page mode: guests first, so a public event's theme never waits on admin; a session is
 * looked up only when guests are kept out.
 */
async function checkReader(request: FastifyRequest, rights: RightsChecker): Promise<void> {
  const ctx = tenantOf(request);
  try {
    checkInfoAccess(ctx, { clientIp: request.ip, viewer: "guest" });
    return;
  } catch (err) {
    if (!(err instanceof InfoPagesClosed)) throw err;
    if (sessionIdFromCookie(request.headers.cookie) === undefined) throw err;
    let member = false;
    try {
      member = isMember(await rights.session(request.headers.cookie));
    } catch (sessionErr) {
      if (!(sessionErr instanceof NotSignedIn)) throw sessionErr;
    }
    if (!member) throw err;
  }
}

const SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const IMMUTABLE = "public, max-age=31536000, immutable";

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

/** Whether `owner` refers to the file: the transaction ends before the disk read, freeing its connection. */
function referenced(db: Db, name: string, draft: boolean): Promise<boolean> {
  return db.tenant(async (c) => {
    const { rows } = await c.query(
      `SELECT 1 FROM theming_file_refs WHERE file = $1 AND (owner = 'draft') = $2 LIMIT 1`,
      [name, draft],
    );
    return rows.length > 0;
  });
}

export function themeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get("/api/theming/current", async (request, reply) => {
    await checkReader(request, deps.rights);
    const theme =
      (await deps.db.tenant((c) => resolvedRevision(c))) ??
      revisionZero(await deps.profile(requireTenant())).theme;
    // Short-lived: surfaces switch on theming.theme.published, this read only catches up.
    void reply.header("cache-control", "no-cache");
    return theme;
  });

  // Public like the pages that link it; the file name is its content's hash, so it never changes.
  app.get<{ Params: { file: string } }>("/theming/a/:file", async (request, reply) => {
    const name = request.params.file;
    if (!FILE_NAME.test(name)) throw notFound();
    const generated = revisionZero(await deps.profile(requireTenant())).files.get(name);
    if (generated !== undefined) return sendFile(reply, name, generated, IMMUTABLE);
    const bytes = (await referenced(deps.db, name, false))
      ? await deps.files.read(name)
      : undefined;
    if (bytes === undefined) throw notFound();
    return sendFile(reply, name, bytes, IMMUTABLE);
  });

  app.get<{ Params: { file: string } }>(
    "/theming/draft/:file",
    { preHandler: needs(deps.rights, "theming.theme.write") },
    async (request, reply) => {
      const name = request.params.file;
      if (!FILE_NAME.test(name)) throw notFound();
      const bytes = (await referenced(deps.db, name, true))
        ? await deps.files.read(name)
        : undefined;
      if (bytes === undefined) throw notFound();
      return sendFile(reply, name, bytes, "no-store");
    },
  );
}
