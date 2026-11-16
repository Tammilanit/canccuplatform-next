/** The moments module's Fastify app: health, the internal request, the venue emergency, the API and the pages. */
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { install, installServiceIdentity, installTenancy } from "@canccu/kit/fastify";
import type { AppDeps } from "./http.js";
import { internalRoutes, venueRoutes } from "./module-routes.js";
import { pageRoutes } from "./pages.js";
import { momentRoutes } from "./routes.js";
import { sceneRoutes } from "./scene-routes.js";
import { settingsRoutes } from "./settings-routes.js";
import { noteTenant } from "./tick.js";

export function buildApp(deps: AppDeps): FastifyInstance {
  // One trusted hop, Caddy: request.ip is the address Caddy appended, never one a client sent.
  const app = Fastify({ logger: false, trustProxy: (_address: string, hop: number) => hop === 0 });
  install(app, { health: deps.health });
  // The pages post plain forms; their fields arrive as strings, as the browser sends them.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 16_384 },
    (_request, body, done) => {
      // A repeated field (the spotlight's zone boxes) becomes a list.
      const form: Record<string, string | string[]> = {};
      for (const [k, v] of new URLSearchParams(body as string)) {
        const had = form[k];
        form[k] = had === undefined ? v : [...(Array.isArray(had) ? had : [had]), v];
      }
      done(null, form);
    },
  );
  void app.register((internal, _opts, done) => {
    installServiceIdentity(internal, deps.service);
    internalRoutes(internal, deps);
    done();
  });
  // The superadmin's hostname is no event's: these routes resolve no tenant.
  void app.register((platform, _opts, done) => {
    venueRoutes(platform, deps);
    done();
  });
  void app.register((event, _opts, done) => {
    installTenancy(event, deps.tenants);
    const noted = new Set<string>();
    // The tick visits the events Moments serves; an event is one from its first request.
    event.addHook("preHandler", async (request) => {
      const id = request.tenant?.tenant_id;
      if (id === undefined || noted.has(id)) return;
      await noteTenant(deps.db, id);
      noted.add(id);
    });
    momentRoutes(event, deps);
    settingsRoutes(event, deps);
    sceneRoutes(event, deps);
    pageRoutes(event, deps);
    done();
  });
  return app;
}
