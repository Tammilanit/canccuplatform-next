/**
 * The crew's Food page (`/pizza/crew`, mockup 10): the day's orders and one order to step in on.
 * Stepping in always asks for a reason, which the API puts in the audit entry (D16).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import { html } from "@canccu/ui";
import type { AppDeps } from "../http.js";
import { tenantOf, today } from "../http.js";
import { MANAGE, MENU_WRITE, RECORD_READ } from "../policy.js";
import { DAY } from "../time.js";
import { CREW_STEP_NAMES, orderView, ordersView } from "./crew-views.js";
import type { HistoryEntry } from "./crew-views.js";
import type { OrderView } from "./order-view.js";
import {
  PREFIX,
  SETTINGS_WRITE,
  back,
  formText,
  must,
  organiserPage,
  pageCtx,
  viaApi,
} from "./kit.js";

type Q = { day?: string; error?: string };
const CREW_STEPS = new Set(CREW_STEP_NAMES);

const missing = () =>
  new KitError("needs right pizza.order.manage", { status: 403, code: "missing_right" });

export function crewPages(app: FastifyInstance, deps: AppDeps): void {
  const crewOnly = async (request: FastifyRequest) => {
    const c = await pageCtx(deps, request);
    if (!c.session.rights.has(MANAGE)) throw missing();
    return c;
  };

  app.get<{ Querystring: Q }>("/crew", async (request, reply) => {
    const c = await pageCtx(deps, request);
    // Food in the menu opens what the person may do: the orders, else the menus, else settings.
    if (!c.session.rights.has(MANAGE)) {
      if (c.session.rights.has(MENU_WRITE)) return reply.redirect(`${PREFIX}crew/pizzerias`, 303);
      if (c.session.rights.has(RECORD_READ)) return reply.redirect(`${PREFIX}crew/record`, 303);
      if (c.session.rights.has(SETTINGS_WRITE))
        return reply.redirect(`${PREFIX}crew/settings`, 303);
      throw missing();
    }
    const now = deps.now();
    const asked = request.query.day;
    const day = asked !== undefined && DAY.test(asked) ? asked : today(tenantOf(request), now);
    const answer = must(await viaApi(app, request, "GET", `/api/pizza/orders?day=${day}`));
    const orders = (answer.orders as OrderView[]).slice().reverse();
    const settings = await deps.settings(c.tenant);
    return organiserPage(request, reply, deps, c, {
      title: c.t("crew.title"),
      description: c.t("about.crew"),
      tab: "orders",
      wide: true,
      body: ordersView(c, day, orders, settings, now, request.query.error),
    });
  });

  app.get<{ Params: { id: string }; Querystring: Q }>(
    "/crew/orders/:id",
    async (request, reply) => {
      const c = await crewOnly(request);
      const id = encodeURIComponent(request.params.id);
      const o = must(
        await viaApi(app, request, "GET", `/api/pizza/orders/${id}`),
      ) as unknown as OrderView;
      const history = must(await viaApi(app, request, "GET", `/api/pizza/orders/${id}/history`));
      return organiserPage(request, reply, deps, c, {
        title: c.t("order.title", { seq: o.seq, pizzeria: o.pizzeria.name }),
        description: c.t("about.order"),
        crumb: { href: `${PREFIX}crew?day=${o.day}`, label: c.t("crew.title") },
        wide: true,
        // The holder's pages work for the crew too: call mode, the hand-out list.
        actions: html`<a class="canccu-button canccu-button--secondary" href="${PREFIX}hold/${o.id}"
          >${c.t("crew.holder_pages")}</a
        >`,
        body: orderView(c, o, history.entries as HistoryEntry[], request.query.error),
      });
    },
  );

  app.post<{ Params: { id: string } }>("/crew/orders/:id", async (request, reply) => {
    await crewOnly(request);
    const id = encodeURIComponent(request.params.id);
    const step = formText(request, "step") ?? "";
    if (!CREW_STEPS.has(step)) return back(reply, `crew/orders/${id}`);
    const reason = formText(request, "reason");
    const pickup = formText(request, "pickup");
    const a = await viaApi(app, request, "POST", `/api/pizza/orders/${id}/${step}`, {
      ...(reason === null ? {} : { reason }),
      ...(step === "arrive" && pickup !== null ? { pickup } : {}),
    });
    return back(reply, `crew/orders/${id}`, a);
  });
}
