/** Web-standard adapter (Request → Response): Hono, Bun, Deno-style and fetch handlers. */
import { CORRELATION_HEADER, withCorrelation } from "../context.js";
import { KitError, MissingRight, codeForStatus, errorBody, internalErrorBody } from "../errors.js";
import type { TenantContext } from "../access.js";
import type { Health } from "../health.js";
import { UnknownHost } from "../resolve.js";
import type { TenantResolver } from "../resolve.js";
import { withTenant } from "../tenant.js";
import type { Logger } from "../log.js";
import type { RightsChecker, Session } from "../rights.js";
import { SERVICE_HEADER, serviceHasRight } from "../service.js";
import type { ServiceIdentity } from "../service.js";
import { checkOrigin } from "../web-security.js";

export type FetchHandler = (request: Request) => Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** The error body for any thrown value; unexpected errors become 500 internal_error. */
export function errorResponse(err: unknown, log?: Logger): Response {
  if (err instanceof KitError) return json(err.toBody(), err.status);
  log?.error({ err }, "unhandled error");
  return json(internalErrorBody(), 500);
}

/** Answer a bare status (e.g. 404 from a router) with the error body. */
export function statusResponse(status: number, message: string): Response {
  return json(errorBody(codeForStatus(status), message), status);
}

export function healthHandler(health: Health): FetchHandler {
  return async () => {
    const result = await health.run();
    return json(result.body, result.httpStatus);
  };
}

/**
 * Run `handler` only when the request's canccu_session holds `right`. With `service`, a request
 * carrying the service header is a module's: it passes for the module's own rights only, and the
 * handler gets a null session and the calling module.
 */
export function withRight(
  checker: RightsChecker,
  right: string,
  handler: (request: Request, session: Session) => Promise<Response>,
): FetchHandler;
export function withRight(
  checker: RightsChecker,
  right: string,
  handler: (request: Request, session: Session | null, service: string | null) => Promise<Response>,
  options: { service: ServiceIdentity },
): FetchHandler;
export function withRight(
  checker: RightsChecker,
  right: string,
  handler: (request: Request, session: Session, service: string | null) => Promise<Response>,
  options: { service?: ServiceIdentity } = {},
): FetchHandler {
  return async (request) => {
    const token = request.headers.get(SERVICE_HEADER);
    if (options.service !== undefined && token !== null) {
      const caller = options.service.verify(token);
      if (!serviceHasRight(caller, right)) throw new MissingRight(`needs right ${right}`);
      // Only the overload with `service` gets here, and its handler takes a null session; the
      // first overload's handler type keeps `Session` so existing callers need no null check.
      return handler(request, null as unknown as Session, caller);
    }
    const session = await checker.check(request.headers.get("cookie"), right);
    return handler(request, session, null);
  };
}

/**
 * Every request under `prefix` must carry a valid service token for this module, else 401
 * `service_unauthenticated`; the handler gets the calling module (null elsewhere and on the
 * `exempt` paths). Wrap it in withKit, so errors get the error body.
 */
export function withServiceIdentity(
  identity: ServiceIdentity,
  handler: (request: Request, service: string | null) => Promise<Response>,
  options: { prefix?: string; exempt?: readonly string[] } = {},
): FetchHandler {
  const prefix = options.prefix ?? "/internal/";
  const exempt = new Set(options.exempt ?? []);
  return async (request) => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith(prefix) || exempt.has(path)) return handler(request, null);
    return handler(request, identity.verify(request.headers.get(SERVICE_HEADER)));
  };
}

/**
 * Outermost wrapper: correlation id in and out, the origin check (contracts/theming.md, The
 * sandbox; `originCheck: false` turns it off), error body for anything thrown.
 */
export function withKit(
  handler: FetchHandler,
  log?: Logger,
  options: { originCheck?: boolean } = {},
): FetchHandler {
  return (request) =>
    withCorrelation(request.headers.get(CORRELATION_HEADER) ?? undefined, async (id) => {
      let response: Response;
      try {
        if (options.originCheck !== false) {
          const url = new URL(request.url);
          checkOrigin(
            request.method,
            url.pathname,
            request.headers.get("origin"),
            request.headers.get("host") ?? url.host,
            request.headers.get("sec-fetch-site"),
          );
        }
        response = await handler(request);
      } catch (err) {
        response = errorResponse(err, log);
      }
      const headers = new Headers(response.headers);
      headers.set(CORRELATION_HEADER, id);
      return new Response(response.body, { status: response.status, headers });
    });
}

/**
 * Resolve the request's tenant from its Host header and run `handler` inside withTenant.
 * `GET /health` passes with a null tenant (0013 item 2); a platform hostname is 404 unless
 * `platformHosts` is `serve`, and then also gets a null tenant.
 */
export function withTenancy(
  resolver: TenantResolver,
  handler: (request: Request, tenant: TenantContext | null) => Promise<Response>,
  options: { platformHosts?: "serve" | "refuse" } = {},
): FetchHandler {
  return async (request) => {
    const url = new URL(request.url);
    const isHealth =
      (request.method === "GET" || request.method === "HEAD") && url.pathname === "/health";
    if (isHealth) return handler(request, null);
    const resolution = await resolver.resolve(request.headers.get("host") ?? url.host);
    if (resolution.kind === "platform") {
      if (options.platformHosts !== "serve") throw new UnknownHost();
      return handler(request, null);
    }
    return withTenant(resolution.context.tenant_id, () => handler(request, resolution.context));
  };
}
