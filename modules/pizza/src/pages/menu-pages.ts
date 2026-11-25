/**
 * Pizzerias and menus (`/pizza/crew/pizzerias`, mockup 11 A–C), with `pizza.menu.write`: each page
 * reads and writes through the API, the menu CSV's preview included, so the import's rules and
 * audit are the API's own.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import type { AppDeps } from "../http.js";
import { parseMenuCsv } from "../menu-csv.js";
import { MENU_WRITE } from "../policy.js";
import { readerAvailable } from "../reader-key.js";
import { PREFIX, back, formText, must, organiserPage, pageCtx, viaApi } from "./kit.js";
import type { PageCtx } from "./kit.js";
import { changesOf, importView, pizzeriaView, pizzeriasView, previewView } from "./menus-views.js";
import type { PizzeriaView } from "./menus-views.js";

type Q = { error?: string };
const P = `${PREFIX}crew/pizzerias`;

const pizzeriaOf = async (app: FastifyInstance, request: FastifyRequest, id: string) =>
  must(
    await viaApi(app, request, "GET", `/api/pizza/pizzerias/${encodeURIComponent(id)}?hidden=true`),
  ) as unknown as PizzeriaView;

async function allPizzerias(app: FastifyInstance, request: FastifyRequest) {
  const list = must(await viaApi(app, request, "GET", "/api/pizza/pizzerias"))
    .pizzerias as PizzeriaView[];
  return Promise.all(list.map((p) => pizzeriaOf(app, request, p.id)));
}

/**
 * The import's preview of a menu CSV: the API's answer (errors, warnings) and the changes item by
 * item against the menus as they are now; nothing is applied until its Apply. Also where a menu
 * read's "Check the import" lands (#789 item 3).
 */
export async function previewPage(
  app: FastifyInstance,
  deps: AppDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  c: PageCtx,
  csv: string,
  failedTo: string,
): Promise<FastifyReply> {
  const a = await viaApi(app, request, "POST", "/api/pizza/menu/import/preview", csv);
  if (a.status >= 400) return back(reply, failedTo, a);
  const file = parseMenuCsv(csv);
  const current = new Map((await allPizzerias(app, request)).map((p) => [p.name.toLowerCase(), p]));
  const rows = csv.split(/\r?\n/).filter((l) => l.trim() !== "").length - 1;
  return organiserPage(request, reply, deps, c, {
    title: c.t("import.title"),
    crumb: { href: `${P}/import`, label: c.t("import.back") },
    body: previewView(c, csv, file, changesOf(c, file, current), Math.max(rows, 0)),
  });
}

export function menuPages(app: FastifyInstance, deps: AppDeps): void {
  const writer = async (request: FastifyRequest) => {
    const c = await pageCtx(deps, request);
    if (!c.session.rights.has(MENU_WRITE))
      throw new KitError(`needs right ${MENU_WRITE}`, { status: 403, code: "missing_right" });
    return c;
  };
  const one = (request: FastifyRequest, id: string) => pizzeriaOf(app, request, id);
  const all = (request: FastifyRequest) => allPizzerias(app, request);

  app.get<{ Querystring: Q }>("/crew/pizzerias", async (request, reply) => {
    const c = await writer(request);
    return organiserPage(request, reply, deps, c, {
      title: c.t("crew.title"),
      tab: "pizzerias",
      body: pizzeriasView(c, await all(request), request.query.error),
    });
  });

  app.post("/crew/pizzerias", async (request, reply) => {
    await writer(request);
    const a = await viaApi(app, request, "POST", "/api/pizza/pizzerias", {
      name: formText(request, "name") ?? "",
    });
    if (a.status >= 400) return back(reply, "crew/pizzerias", a);
    return back(reply, `crew/pizzerias/${String(a.body.id)}`);
  });

  app.get<{ Querystring: Q }>("/crew/pizzerias/import", async (request, reply) => {
    const c = await writer(request);
    return organiserPage(request, reply, deps, c, {
      title: c.t("import.title"),
      crumb: { href: P, label: c.t("tab.pizzerias") },
      narrow: true,
      body: importView(c, request.query.error),
    });
  });

  /** The preview: the API's answer (errors, warnings), and the changes item by item. */
  app.post("/crew/pizzerias/import", async (request, reply) => {
    const c = await writer(request);
    const csv = formText(request, "csv") ?? "";
    return previewPage(app, deps, request, reply, c, csv, "crew/pizzerias/import");
  });

  app.post("/crew/pizzerias/import/apply", async (request, reply) => {
    await writer(request);
    const a = await viaApi(
      app,
      request,
      "POST",
      "/api/pizza/menu/import",
      formText(request, "csv") ?? "",
    );
    return back(reply, a.status >= 400 ? "crew/pizzerias/import" : "crew/pizzerias", a);
  });

  /** The same CSV of the current menus, to edit and import again. */
  app.get<{ Querystring: { pizzeria_id?: string } }>(
    "/crew/pizzerias/menu.csv",
    async (request, reply) => {
      await writer(request);
      const id = request.query.pizzeria_id;
      const a = await viaApi(
        app,
        request,
        "GET",
        `/api/pizza/menu.csv${id === undefined ? "" : `?pizzeria_id=${encodeURIComponent(id)}`}`,
      );
      must(a);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="menu.csv"')
        .send(a.text);
    },
  );

  app.get<{ Params: { id: string }; Querystring: Q }>(
    "/crew/pizzerias/:id",
    async (request, reply) => {
      const c = await writer(request);
      const p = await one(request, request.params.id);
      return organiserPage(request, reply, deps, c, {
        title: p.name,
        crumb: { href: P, label: c.t("tab.pizzerias") },
        body: pizzeriaView(c, p, request.query.error, await readerAvailable(deps, c.tenant)),
      });
    },
  );

  app.post<{ Params: { id: string } }>("/crew/pizzerias/:id", async (request, reply) => {
    await writer(request);
    const id = encodeURIComponent(request.params.id);
    const hide = formText(request, "do") === "hide";
    const a = await viaApi(
      app,
      request,
      "PATCH",
      `/api/pizza/pizzerias/${id}`,
      hide
        ? { hidden: true }
        : {
            name: formText(request, "name") ?? "",
            phone: formText(request, "phone"),
            website: formText(request, "website"),
            service: formText(request, "service") ?? "delivery",
          },
    );
    return back(reply, hide && a.status < 400 ? "crew/pizzerias" : `crew/pizzerias/${id}`, a);
  });
}
