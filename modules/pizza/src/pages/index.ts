/**
 * The Food pages: the attendee's and the holder's (hub) and the crew's (organiser shell), in one
 * scope of their own.
 */
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../http.js";
import { crewPages } from "./crew.js";
import { foodPages } from "./food.js";
import { holderPages } from "./holder.js";
import { pageErrors, staticRoutes } from "./kit.js";
import { integrationsPages } from "./integrations.js";
import { menuPages } from "./menu-pages.js";
import { menuReadPages } from "./menu-read.js";
import { moneyPages } from "./money.js";
import { recordPages } from "./record-pages.js";
import { settingsPage } from "./settings-page.js";
import { photoForms } from "./uploads.js";

export function pageRoutes(app: FastifyInstance, deps: AppDeps): void {
  void app.register((pages, _opts, done) => {
    pageErrors(pages, deps);
    photoForms(pages);
    staticRoutes(pages);
    foodPages(pages, deps);
    holderPages(pages, deps);
    moneyPages(pages, deps);
    crewPages(pages, deps);
    menuPages(pages, deps);
    menuReadPages(pages, deps);
    integrationsPages(pages, deps);
    settingsPage(pages, deps);
    recordPages(pages, deps);
    done();
  });
}
