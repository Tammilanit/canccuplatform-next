/**
 * Fastify adapter: /health route, rights preHandler, error body, correlation id, origin check,
 * tenancy and the service identity on internal paths.
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";
import { CORRELATION_HEADER, withCorrelation } from "../context.js";
import { KitError, MissingRight, codeForStatus, errorBody, internalErrorBody } from "../errors.js";
import type { TenantContext } from "../access.js";
import type { Health } from "../health.js";
import { UnknownHost } from "../resolve.js";
import type { TenantResolver } from "../resolve.js";
import type { RightsChecker, Session } from "../rights.js";
import { SERVICE_HEADER, serviceHasRight } from "../service.js";
import type { ServiceIdentity } from "../service.js";
import { withTenant } from "../tenant.js";
import { canonicalPath, checkOrigin } from "../web-security.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by requireRight. */
    session: Session | null;
    /** Set by installTenancy; null on /health and on a served platform hostname. */
    tenant: TenantContext | null;
    /** The calling module, set by installServiceIdentity or requireRight's `service`. */
    service: string | null;
  }
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

/** The decoded path the router matches (throws 400 for a path it would read differently). */
function pathOf(request: FastifyRequest): string {
  return canonicalPath(request.url);
}

/** Both install() and installServiceIdentity() may come first; Fastify refuses a second decorate. */
function decorateService(app: FastifyInstance): void {
  if (!app.hasRequestDecorator("service")) app.decorateRequest("service", null);
}

/**
 * Add the error body handlers, correlation id, the origin check (contracts/theming.md, The
 * sandbox; `originCheck: false` turns it off) and (optionally) GET /health.
 */
export function install(
  app: FastifyInstance,
  options: { health?: Health; originCheck?: boolean } = {},
): void {
  app.decorateRequest("session", null);
  decorateService(app);

  app.addHook("onRequest", (request, reply, done) => {
    const incoming = request.headers[CORRELATION_HEADER];
    withCorrelation(typeof incoming === "string" ? incoming : undefined, (id) => {
      void reply.header(CORRELATION_HEADER, id);
      done();
    });
  });

  if (options.originCheck !== false) {
    app.addHook("onRequest", (request, _reply, done) => {
      try {
        checkOrigin(
          request.method,
          pathOf(request),
          header(request, "origin"),
          header(request, "host"),
          header(request, "sec-fetch-site"),
        );
      } catch (err) {
        done(err as Error);
        return;
      }
      done();
    });
  }

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

/**
 * preHandler that sets request.session or answers 401/403/503 with the error body. With `service`,
 * a request carrying the service header is a module's: it passes for the module's own rights only
 * and gets `request.service` instead of a session.
 */
export function requireRight(
  checker: RightsChecker,
  right: string,
  options: { service?: ServiceIdentity } = {},
): preHandlerAsyncHookHandler {
  return async (request) => {
    const token = header(request, SERVICE_HEADER);
    if (options.service !== undefined && token !== undefined) {
      const caller = options.service.verify(token);
      if (!serviceHasRight(caller, right)) throw new MissingRight(`needs right ${right}`);
      request.service = caller;
      request.session = null;
      return;
    }
    request.session = await checker.check(request.headers.cookie, right);
  };
}

/**
 * Every request under `prefix` must carry a valid service token for this module, else 401
 * `service_unauthenticated`; sets request.service. Call after install(), so errors get the error
 * body. `exempt` lists exact paths that stay open.
 */
export function installServiceIdentity(
  app: FastifyInstance,
  identity: ServiceIdentity,
  options: { prefix?: string; exempt?: readonly string[] } = {},
): void {
  const prefix = options.prefix ?? "/internal/";
  const exempt = new Set(options.exempt ?? []);
  decorateService(app);
  app.addHook("onRequest", (request, _reply, done) => {
    try {
      const path = pathOf(request);
      if (!path.startsWith(prefix) || exempt.has(path)) {
        done();
        return;
      }
      request.service = identity.verify(header(request, SERVICE_HEADER));
    } catch (err) {
      done(err as Error);
      return;
    }
    done();
  });
}

export interface TenancyOptions {
  /** `serve` only in a module that answers on the sign-in or superadmin hostname. */
  platformHosts?: "serve" | "refuse";
}

/** `GET /health` stays outside tenant resolution (0013 item 2). */
export function isHealthRequest(method: string, path: string): boolean {
  return (method === "GET" || method === "HEAD") && path === "/health";
}

/**
 * Resolve every request's tenant from its Host header (Caddy forwards it unchanged) and run the
 * rest of the request inside withTenant. Call after install(), so errors get the error body.
 */
export function installTenancy(
  app: FastifyInstance,
  resolver: TenantResolver,
  options: TenancyOptions = {},
): void {
  app.decorateRequest("tenant", null);
  app.addHook("onRequest", (request, _reply, done) => {
    // The raw path: an escaped /health only loses its exemption, which fails safe.
    if (isHealthRequest(request.method, request.url.split("?")[0] ?? "")) {
      done();
      return;
    }
    resolver.resolve(request.headers.host).then(
      (resolution) => {
        if (resolution.kind === "platform") {
          if (options.platformHosts === "serve") done();
          else done(new UnknownHost());
          return;
        }
        request.tenant = resolution.context;
        // done() inside withTenant: Fastify runs the handler in this async context.
        withTenant(resolution.context.tenant_id, () => {
          done();
        });
      },
      (err: unknown) => {
        done(err as Error);
      },
    );
  });
}
