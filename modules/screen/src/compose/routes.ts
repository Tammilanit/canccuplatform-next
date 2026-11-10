/** `GET /api/screen/device/state` and `GET /api/screen/now` (contracts/screen.md, Composed state). */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { InfoPagesClosed, NotSignedIn, checkInfoAccess, sessionIdFromCookie } from "@canccu/kit";
import type { RightsChecker } from "@canccu/kit";
import { requireDevice } from "../device-access.js";
import { notFound, tenantOf } from "../http.js";
import { zoneKey } from "../zone-input.js";
import { deviceState, nowView } from "./state.js";
import type { ComposeDeps } from "./state.js";

export interface ComposeRouteDeps extends ComposeDeps {
  rights: RightsChecker;
}

// The other modules resolve the event from the same hostname the screen or phone used.
const hostOf = (request: FastifyRequest): string => request.headers.host ?? "";

/**
 * The info-page mode, guests first, as theming reads it: a public event's hub never waits on
 * admin. Any valid session counts as a member until the tenants membership lookup lands (#150).
 */
async function hubReader(request: FastifyRequest, rights: RightsChecker): Promise<boolean> {
  const ctx = tenantOf(request);
  const hasCookie = sessionIdFromCookie(request.headers.cookie) !== undefined;
  const signedIn = async (): Promise<boolean> => {
    try {
      const session = await rights.session(request.headers.cookie);
      return session.expiresAt.getTime() > Date.now();
    } catch (err) {
      if (err instanceof NotSignedIn) return false;
      throw err;
    }
  };
  try {
    checkInfoAccess(ctx, { clientIp: request.ip, viewer: "guest" });
    return hasCookie ? await signedIn() : false;
  } catch (err) {
    if (!(err instanceof InfoPagesClosed) || !hasCookie) throw err;
    if (!(await signedIn())) throw err;
    checkInfoAccess(ctx, { clientIp: request.ip, viewer: "member" });
    return true;
  }
}

export function composeRoutes(app: FastifyInstance, deps: ComposeRouteDeps): void {
  app.get(
    "/api/screen/device/state",
    { preHandler: requireDevice(deps.db, { now: () => new Date((deps.now ?? Date.now)()) }) },
    async (request) => {
      // requireDevice sets it or answers 401; null here would be a wiring bug.
      if (request.device === null) throw notFound();
      return deviceState(deps, tenantOf(request), hostOf(request), request.device);
    },
  );

  app.get<{ Querystring: { zone?: string } }>("/api/screen/now", async (request) => {
    const key = zoneKey(request.query.zone, "zone");
    const member = await hubReader(request, deps.rights);
    const view = await nowView(deps, tenantOf(request), hostOf(request), key, member);
    if (view === null) throw notFound();
    return view;
  });
}
