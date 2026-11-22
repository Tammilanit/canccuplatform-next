/**
 * The Food pages: the attendee's and the holder's (hub) and the crew's (organiser shell), in one
 * scope of their own.
 */
import type { FastifyInstance } from "fastify";
import { emptyState } from "@canccu/ui";
import { tenantOf } from "../http.js";
import type { AppDeps } from "../http.js";
import { foodOn } from "../switch.js";
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
import { hubPage } from "./kit.js";
import { translator } from "./messages.js";

export function pageRoutes(app: FastifyInstance, deps: AppDeps): void {
  void app.register((pages, _opts, done) => {
    pageErrors(pages, deps);
    // Food switched off for the event: every page says so, for guests too; its look still loads.
    pages.addHook("onRequest", async (request, reply) => {
      if (foodOn(tenantOf(request)) || request.url.startsWith("/static/")) return;
      const lang = await deps.language(tenantOf(request).tenant_id).catch(() => "en");
      const t = translator(lang);
      return hubPage(
        request,
        reply,
        { lang },
        {
          title: t("off.title"),
          status: 404,
          body: emptyState({ icon: "food", title: t("off.title"), text: t("off.text") }),
        },
      );
    });
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
