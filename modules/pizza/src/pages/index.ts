/** The Food pages: the holder's (hub) and the crew's (organiser shell), in one scope of their own. */
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../http.js";
import { crewPages } from "./crew.js";
import { holderPages } from "./holder.js";
import { pageErrors, staticRoutes } from "./kit.js";
import { menuPages } from "./menu-pages.js";
import { settingsPage } from "./settings-page.js";

export function pageRoutes(app: FastifyInstance, deps: AppDeps): void {
  void app.register((pages, _opts, done) => {
    pageErrors(pages, deps);
    staticRoutes(pages);
    holderPages(pages, deps);
    crewPages(pages, deps);
    menuPages(pages, deps);
    settingsPage(pages, deps);
    done();
  });
}
