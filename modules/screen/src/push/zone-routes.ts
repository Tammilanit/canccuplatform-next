/**
 * A zone for a signed-in person (contracts/screen.md, Preview and A zone for a session):
 * `GET /api/screen/zones/{zone_key}/state` and `/stream`, and `POST …/preview`.
 */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError, sessionIdFromCookie, tenantKey } from "@canccu/kit";
import { BUILT_IN_LAYOUTS, themeLayouts } from "../compose/layouts.js";
import { composeZone } from "../compose/state.js";
import { body, invalidRequest, needs, notFound, rateLimited, tenantOf } from "../http.js";
import { zoneExistsHere } from "../zones.js";
import { zoneInput } from "../zone-input.js";
import { recordOf, refreshZone } from "./device-state.js";
import { PING_MS } from "./feed.js";
import type { HubDeps, PushHub } from "./hub.js";
import { serveFeed } from "./routes.js";
import { SESSION_RIGHT, SessionStream, viewerState } from "./session.js";
import type { SessionDeps } from "./session.js";
import type { Orientation } from "./store.js";

/** Open zone streams per session (all containers), and previews per session and minute. */
export const MAX_SESSION_STREAMS = 20;
export const MAX_PREVIEWS_PER_MINUTE = 30;

type ZoneQuery = { Params: { zone_key: string }; Querystring: { orientation?: string } };

function orientationOf(value: string | undefined): Orientation {
  if (value === undefined || value === "landscape") return "landscape";
  if (value === "portrait") return "portrait";
  throw invalidRequest("`orientation` must be landscape or portrait.");
}

// The other modules resolve the event from the same hostname the page used.
const hostOf = (request: FastifyRequest): string => request.headers.host ?? "";

/** Per-session keys hold a hash of the session id, never the id itself. */
function sessionKey(request: FastifyRequest, what: string): string {
  const id = sessionIdFromCookie(request.headers.cookie) ?? "";
  const hash = createHash("sha256").update(id).digest("base64url").slice(0, 32);
  return tenantKey("screen", "session", hash, what);
}

const unknownLayout = (): KitError =>
  new KitError("No built-in or theme layout has this id.", { status: 400, code: "unknown_layout" });

export function zoneViewRoutes(
  app: FastifyInstance,
  deps: HubDeps & SessionDeps & { hub: PushHub },
): void {
  const read = needs(deps.rights, SESSION_RIGHT);
  const write = needs(deps.rights, "screen.zones.write");
  const now = (): number => (deps.now ?? Date.now)();

  app.get<ZoneQuery>("/api/screen/zones/:zone_key/state", { preHandler: read }, async (request) => {
    const orientation = orientationOf(request.query.orientation);
    const ctx = tenantOf(request);
    const record = await refreshZone(deps, ctx, hostOf(request), request.params.zone_key);
    if (record === null) throw notFound();
    return viewerState(record, orientation, {
      id: "mirror",
      nowMs: now(),
      ctx,
      bundleVersion: deps.bundleVersion,
    });
  });

  app.get<ZoneQuery>(
    "/api/screen/zones/:zone_key/stream",
    { preHandler: read },
    async (request, reply) => {
      const orientation = orientationOf(request.query.orientation);
      const zone = request.params.zone_key;
      if (!(await deps.db.tenant((c) => zoneExistsHere(c, zone)))) throw notFound();
      // A sorted set of open streams that expire unless pinged, so a container that dies with
      // streams open does not hold the person's count up. Counting and adding are two steps: two
      // connects at the same moment may both pass at 19, which the limit can afford.
      const key = sessionKey(request, "streams");
      const ttl = 3 * (deps.streamPingMs ?? PING_MS);
      if ((await deps.kv.live(key, now())).length >= MAX_SESSION_STREAMS) {
        throw rateLimited(`At most ${MAX_SESSION_STREAMS} open zone views per sign-in.`);
      }
      const member = randomBytes(9).toString("base64url");
      await deps.kv.addExpiring(key, member, now() + ttl);
      const lastEventId = request.headers["last-event-id"];
      const stream = new SessionStream(
        deps,
        {
          ctx: tenantOf(request),
          host: hostOf(request),
          zone,
          orientation,
          cookie: request.headers.cookie ?? "",
          ip: request.ip,
        },
        () => deps.kv.addExpiring(key, member, now() + ttl),
      );
      return serveFeed(reply, deps.hub, stream, (ended) =>
        stream.start(
          () => {
            ended();
            void deps.kv.removeMember(key, member).catch(() => undefined);
          },
          typeof lastEventId === "string" ? lastEventId : undefined,
        ),
      );
    },
  );

  app.post<ZoneQuery>(
    "/api/screen/zones/:zone_key/preview",
    { preHandler: write },
    async (request) => {
      const orientation = orientationOf(request.query.orientation);
      const zone = zoneInput(body(request));
      if (zone.key !== request.params.zone_key) {
        throw invalidRequest("The body's `key` must be the zone key of the path.");
      }
      const key = sessionKey(request, "previews");
      if ((await deps.kv.live(key, now())).length >= MAX_PREVIEWS_PER_MINUTE) {
        throw rateLimited(`At most ${MAX_PREVIEWS_PER_MINUTE} previews a minute.`);
      }
      const ctx = tenantOf(request);
      const composed = await composeZone(deps, ctx, hostOf(request), zone.key, {
        key: zone.key,
        name: zone.name,
        layout_id: zone.layout_id,
        regions: zone.regions,
        header: zone.header,
        hub_qr: zone.hub_qr,
        hero_region: zone.hero_region,
        grow_for_showcase: zone.grow_for_showcase,
        // A preview never sounds, so whose sound it is does not matter.
        sound: zone.sound,
        epoch: "preview",
      });
      // composeZone answers null only when it reads the zone itself.
      if (composed === null) throw notFound();
      // Saved zones fall back to `pulse` for a layout a theme dropped later; a preview is where
      // Studio learns of a layout that does not exist now.
      const known = [...BUILT_IN_LAYOUTS, ...themeLayouts(composed.theme.layouts)];
      if (zone.layout_id !== null && !known.some((l) => l.id === zone.layout_id)) {
        throw unknownLayout();
      }
      // Counted once valid: a refused preview does not use up the person's minute.
      await deps.kv.addExpiring(key, randomBytes(9).toString("base64url"), now() + 60_000);
      return viewerState(recordOf(composed, 0), orientation, {
        id: "preview",
        nowMs: now(),
        ctx,
        bundleVersion: deps.bundleVersion,
      });
    },
  );
}
