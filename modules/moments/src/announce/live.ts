/**
 * The hub's read of the live announcements (contracts/moments.md, Sending; #780): no right, for the
 * front door's cards, so it carries nothing about who sent one, and it follows the event's
 * info-page mode as the hub's other reads do.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { InfoPagesClosed, NotSignedIn, checkInfoAccess, sessionIdFromCookie } from "@canccu/kit";
import type { RightsChecker, SqlClient } from "@canccu/kit";
import { tenantOf } from "../http.js";
import type { AppDeps } from "../http.js";

/** A guest the mode keeps out is refused; a signed-in person reads on, as Screen's hub read does. */
async function checkHubReader(request: FastifyRequest, rights: RightsChecker): Promise<void> {
  const ctx = tenantOf(request);
  try {
    checkInfoAccess(ctx, { clientIp: request.ip, viewer: "guest" });
  } catch (err) {
    if (!(err instanceof InfoPagesClosed)) throw err;
    if (sessionIdFromCookie(request.headers.cookie) === undefined) throw err;
    try {
      const session = await rights.session(request.headers.cookie);
      if (session.expiresAt.getTime() <= Date.now()) throw err;
    } catch (e) {
      if (e instanceof NotSignedIn) throw err;
      throw e;
    }
  }
}

async function liveAnnouncements(c: SqlClient): Promise<Record<string, unknown>[]> {
  const { rows } = await c.query(
    `SELECT id, level, title, body, icon, sent_at, expires_at, zones FROM moments_announcements
     WHERE status = 'live' AND (channels ->> 'screen')::boolean
     ORDER BY sent_at DESC, id`,
    [],
  );
  return rows.map((r) => ({
    id: r.id as string,
    level: r.level as string,
    title: (r.title as string | null) ?? "",
    body: (r.body as string | null) ?? "",
    icon: (r.icon as string | null) ?? "info",
    // A composed announcement has no source art; only a rule's card carries one.
    art: null,
    sent_at: (r.sent_at as Date).toISOString(),
    expires_at: (r.expires_at as Date).toISOString(),
    zones: r.zones as string[],
  }));
}

export function liveRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/moments/announcements/live", async (request) => {
    await checkHubReader(request, deps.rights);
    return deps.db.tenant(async (c) => ({ announcements: await liveAnnouncements(c) }));
  });
}
