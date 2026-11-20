/**
 * The daily record and the export (`/pizza/crew/record…`, `/pizza/crew/export`, mockup 12), in
 * the organiser shell for `pizza.record.read`. Everything is read through the API as the person.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import { html } from "@canccu/ui";
import { readCsv } from "../csv.js";
import { tenantOf, today } from "../http.js";
import type { AppDeps } from "../http.js";
import { MANAGE, RECORD_READ } from "../policy.js";
import type { DailyRecord } from "../record.js";
import { DAY } from "../time.js";
import { PREFIX, must, organiserPage, pageCtx, viaApi } from "./kit.js";
import type { MoneyView } from "./money-format.js";
import { WHOLE, exportView, recordOrderView, recordView } from "./record-views.js";
import type { ExportAnswer } from "./record-views.js";

type Q = { day?: string };

export function recordPages(app: FastifyInstance, deps: AppDeps): void {
  const reader = async (request: FastifyRequest) => {
    const c = await pageCtx(deps, request);
    if (!c.session.rights.has(RECORD_READ))
      throw new KitError(`needs right ${RECORD_READ}`, { status: 403, code: "missing_right" });
    return c;
  };
  const whole = async (request: FastifyRequest) =>
    must(await viaApi(app, request, "GET", "/api/pizza/record")) as unknown as DailyRecord;
  /** The asked day, else today's when it has orders, else the latest that has, else the event. */
  const pick = (request: FastifyRequest<{ Querystring: Q }>, r: DailyRecord) => {
    const asked = request.query.day;
    if (asked === WHOLE || (asked !== undefined && DAY.test(asked))) return asked;
    const now = today(tenantOf(request), deps.now());
    return r.days.some((d) => d.day === now) ? now : (r.days.at(-1)?.day ?? WHOLE);
  };

  app.get<{ Querystring: Q }>("/crew/record", async (request, reply) => {
    const c = await reader(request);
    const r = await whole(request);
    return organiserPage(request, reply, deps, c, {
      title: c.t("crew.title"),
      tab: "record",
      narrow: true,
      body: recordView(c, r, pick(request, r), r.days),
    });
  });

  app.get<{ Params: { id: string } }>("/crew/record/:id", async (request, reply) => {
    const c = await reader(request);
    const r = await whole(request);
    const day = r.days.find((d) => d.orders.some((o) => o.id === request.params.id));
    const o = day?.orders.find((x) => x.id === request.params.id);
    if (day === undefined || o === undefined)
      throw new KitError("No such order.", { status: 404, code: "not_found" });
    const id = encodeURIComponent(o.id);
    const m = must(
      await viaApi(app, request, "GET", `/api/pizza/orders/${id}/money`),
    ) as unknown as MoneyView;
    const history = c.session.rights.has(MANAGE)
      ? html`<a href="${PREFIX}crew/orders/${o.id}">${c.t("record.history")} ›</a>`
      : "";
    return organiserPage(request, reply, deps, c, {
      title: c.t("hold.order", { seq: o.seq }),
      crumb: { href: `${PREFIX}crew/record?day=${day.day}`, label: c.t("tab.record") },
      narrow: true,
      body: recordOrderView(
        c,
        o as Parameters<typeof recordOrderView>[1],
        day.label,
        m,
        r.flags,
        history,
      ),
    });
  });

  app.get<{ Querystring: Q }>("/crew/export", async (request, reply) => {
    const c = await reader(request);
    const r = await whole(request);
    const picked = pick(request, r);
    const q = picked === WHOLE ? "" : `?day=${picked}`;
    const e = must(
      await viaApi(app, request, "GET", `/api/pizza/export${q}`),
    ) as unknown as ExportAnswer;
    return organiserPage(request, reply, deps, c, {
      title: c.t("export.title"),
      crumb: { href: `${PREFIX}crew/record?day=${picked}`, label: c.t("tab.record") },
      narrow: true,
      body: exportView(c, e, readCsv(e.csv), picked, r.days),
    });
  });
}
