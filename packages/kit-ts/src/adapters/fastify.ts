/** Fastify adapter: /health route, rights preHandler, error body, correlation id. */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";
import { CORRELATION_HEADER, withCorrelation } from "../context.js";
import { KitError, codeForStatus, errorBody, internalErrorBody } from "../errors.js";
import type { Health } from "../health.js";
import type { RightsChecker, Session } from "../rights.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by requireRight. */
    session: Session | null;
  }
}

/** Add the error body handlers, correlation id and (optionally) GET /health. */
export function install(app: FastifyInstance, options: { health?: Health } = {}): void {
  app.decorateRequest("session", null);

  app.addHook("onRequest", (request, reply, done) => {
    const incoming = request.headers[CORRELATION_HEADER];
    withCorrelation(typeof incoming === "string" ? incoming : undefined, (id) => {
      void reply.header(CORRELATION_HEADER, id);
      done();
    });
  });

  app.setErrorHandler((err: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof KitError) return reply.status(err.status).send(err.toBody());
    const status = (err as { statusCode?: unknown }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const message = err instanceof Error ? err.message : "request failed";
      return reply.status(status).send(errorBody(codeForStatus(status), message));
    }
    request.log.error({ err }, "unhandled error");
    return reply.status(500).send(internalErrorBody());
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(errorBody("not_found", `no route ${request.method} ${request.url}`)),
  );

  const health = options.health;
  if (health !== undefined) {
    app.get("/health", async (_request, reply) => {
      const result = await health.run();
      return reply.status(result.httpStatus).send(result.body);
    });
  }
}

/** preHandler that sets request.session or answers 401/403/503 with the error body. */
export function requireRight(checker: RightsChecker, right: string): preHandlerAsyncHookHandler {
  return async (request) => {
    request.session = await checker.check(request.headers.cookie, right);
  };
}
