/** Web-standard adapter (Request → Response): Hono, Bun, Deno-style and fetch handlers. */
import { CORRELATION_HEADER, withCorrelation } from "../context.js";
import { KitError, codeForStatus, errorBody, internalErrorBody } from "../errors.js";
import type { Health } from "../health.js";
import type { Logger } from "../log.js";
import type { RightsChecker, Session } from "../rights.js";

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

/** Run `handler` only when the request's canccu_session holds `right`. */
export function withRight(
  checker: RightsChecker,
  right: string,
  handler: (request: Request, session: Session) => Promise<Response>,
): FetchHandler {
  return async (request) => {
    const session = await checker.check(request.headers.get("cookie"), right);
    return handler(request, session);
  };
}

/** Outermost wrapper: correlation id in and out, error body for anything thrown. */
export function withKit(handler: FetchHandler, log?: Logger): FetchHandler {
  return (request) =>
    withCorrelation(request.headers.get(CORRELATION_HEADER) ?? undefined, async (id) => {
      let response: Response;
      try {
        response = await handler(request);
      } catch (err) {
        response = errorResponse(err, log);
      }
      const headers = new Headers(response.headers);
      headers.set(CORRELATION_HEADER, id);
      return new Response(response.body, { status: response.status, headers });
    });
}
