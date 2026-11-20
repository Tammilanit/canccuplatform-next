/** The pizza module's Fastify app: health and the API, every route on an event's hostname. */
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { install, installTenancy } from "@canccu/kit/fastify";
import { noteTenant } from "./db.js";
import type { AppDeps } from "./http.js";
import { itemRoutes } from "./item-routes.js";
import { liveRoutes } from "./live.js";
import { MAX_BYTES } from "./menu-csv.js";
import { menuRoutes } from "./menu-routes.js";
import { moneyRoutes } from "./money-routes.js";
import { orderRoutes } from "./order-routes.js";
import { pageRoutes } from "./pages/index.js";
import { recordRoutes } from "./record-routes.js";

export function buildApp(deps: AppDeps): FastifyInstance {
  // One trusted hop, Caddy: request.ip is the address Caddy appended, never one a client sent.
  const app = Fastify({ logger: false, trustProxy: (_address: string, hop: number) => hop === 0 });
  install(app, { health: deps.health });
  // JSON, the menu CSV as text and the pages' forms; nothing else is a body here (415 for the rest).
  app.removeContentTypeParser("text/plain");
  app.addContentTypeParser(
    "text/csv",
    // Twice the file limit: a larger file gets the import's own "at most 512 KiB" answer.
    { parseAs: "string", bodyLimit: 2 * MAX_BYTES },
    (_request, body, done) => {
      done(null, body);
    },
  );
  // The pages post plain forms; a menu CSV's text comes in one, so the limit is the CSV's,
  // escaped (every byte up to three).
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 3 * MAX_BYTES + 16_384 },
    (_request, body, done) => {
      // A repeated field (a switch's hidden "off" and its box) becomes a list.
      const form: Record<string, string | string[]> = {};
      for (const [k, v] of new URLSearchParams(body as string)) {
        const had = form[k];
        form[k] = had === undefined ? v : [...(Array.isArray(had) ? had : [had]), v];
      }
      done(null, form);
    },
  );
  void app.register((event, _opts, done) => {
    installTenancy(event, deps.tenants);
    const noted = new Set<string>();
    // A deleted user is forgotten in every event pizza has served; an event is one from its first request.
    event.addHook("preHandler", async (request) => {
      const id = request.tenant?.tenant_id;
      if (id === undefined || noted.has(id)) return;
      await noteTenant(deps.db, id);
      noted.add(id);
    });
    orderRoutes(event, deps);
    itemRoutes(event, deps);
    moneyRoutes(event, deps);
    menuRoutes(event, deps);
    recordRoutes(event, deps);
    liveRoutes(event, deps);
    pageRoutes(event, deps);
    done();
  });
  return app;
}
