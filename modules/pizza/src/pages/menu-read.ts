/**
 * Reading a menu photo (mockup 11 D; `pizza.menu.write`, the AI reader on): the notice of the
 * outside service first, then the photos, one page each, read into one menu CSV. Nothing is saved
 * here and no photo is kept: the CSV goes to the import's own preview, which shows the changes
 * before anything is applied.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import { html } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { AppDeps } from "../http.js";
import { MENU_WRITE } from "../policy.js";
import { readerAvailable } from "../reader-key.js";
import { PROVIDER } from "../reader.js";
import { PREFIX, back, formKey, must, organiserPage, pageCtx, viaApi } from "./kit.js";
import type { PageCtx } from "./kit.js";
import { outsideNotice } from "./money-views.js";
import { flash } from "./order-view.js";
import { photosOf } from "./uploads.js";

const P = `${PREFIX}crew/pizzerias`;

function pickView(c: PageCtx, id: string, error?: string): Html {
  return html`${flash(error)}
    ${outsideNotice(c, c.t("read.outside_text", { provider: PROVIDER.name }))}
    <form
      method="post"
      action="${P}/${id}/read"
      enctype="multipart/form-data"
      class="pizza-part pizza-form"
    >
      ${formKey()}
      <label class="canccu-field"
        ><span class="canccu-field__label">${c.t("read.photos")}</span
        ><input
          class="canccu-input"
          type="file"
          name="photo"
          accept="image/jpeg,image/png,image/webp"
          multiple
          required
      /></label>
      <button class="canccu-button canccu-button--primary" type="submit">${c.t("read.go")}</button>
    </form>`;
}

interface Read {
  csv: string;
  items: number;
  unsure: string[];
}

function resultView(c: PageCtx, csv: string, items: number, unsure: string[]): Html {
  const rows = csv
    .split("\n")
    .slice(1)
    .filter((l) => l !== "");
  return html`<p class="pizza-title">${c.t("read.result", { n: items })}</p>
    ${
      unsure.length === 0
        ? ""
        : html`<p class="pizza-badge pizza-badge--warn">
            ${unsure.join(", ")}: ${c.t("read.unsure")}
          </p>`
    }
    <p class="canccu-muted canccu-small">${c.t("read.fix")}</p>
    <form method="post" action="${P}/import" class="pizza-part pizza-form">
      ${formKey()}
      <textarea
        class="canccu-input pizza-csv"
        name="csv"
        rows="${Math.min(rows.length + 2, 20)}"
        spellcheck="false"
      >
${csv}</textarea>
      <div class="canccu-cluster">
        <button class="canccu-button canccu-button--primary" type="submit">
          ${c.t("read.use")}
        </button>
        <a
          class="canccu-button canccu-button--secondary"
          download="menu.csv"
          href="data:text/csv;charset=utf-8,${encodeURIComponent(csv)}"
          >${c.t("read.download")}</a
        >
      </div>
    </form>`;
}

export function menuReadPages(app: FastifyInstance, deps: AppDeps): void {
  const writer = async (request: FastifyRequest) => {
    const c = await pageCtx(deps, request);
    if (!c.session.rights.has(MENU_WRITE))
      throw new KitError(`needs right ${MENU_WRITE}`, { status: 403, code: "missing_right" });
    if (!(await readerAvailable(deps, c.tenant)))
      throw new KitError("The reader is off here.", { status: 409, code: "reader_off" });
    return c;
  };

  app.get<{ Params: { id: string }; Querystring: { error?: string } }>(
    "/crew/pizzerias/:id/read",
    async (request, reply) => {
      const c = await writer(request);
      return organiserPage(request, reply, deps, c, {
        title: c.t("read.title"),
        crumb: { href: `${P}/${request.params.id}`, label: c.t("tab.pizzerias") },
        narrow: true,
        body: pickView(c, request.params.id, request.query.error),
      });
    },
  );

  app.post<{ Params: { id: string } }>("/crew/pizzerias/:id/read", async (request, reply) => {
    const c = await writer(request);
    const id = encodeURIComponent(request.params.id);
    const photos = await photosOf(request);
    let header = "";
    const rows: string[] = [];
    const unsure: string[] = [];
    let items = 0;
    for (const [n, photo] of photos.entries()) {
      const a = await viaApi(
        app,
        request,
        "POST",
        `/api/pizza/menu/read?pizzeria_id=${id}`,
        photo,
        n,
      );
      if (a.status >= 400) return back(reply, `crew/pizzerias/${id}/read`, a);
      const r = must(a) as unknown as Read;
      const [head = "", ...lines] = r.csv.split("\n");
      header = head;
      rows.push(...lines.filter((l) => l !== ""));
      unsure.push(...r.unsure);
      items += r.items;
    }
    if (header === "") return back(reply, `crew/pizzerias/${id}/read`);
    return organiserPage(request, reply, deps, c, {
      title: c.t("read.title"),
      crumb: { href: `${P}/${id}`, label: c.t("tab.pizzerias") },
      narrow: true,
      body: resultView(c, [header, ...rows, ""].join("\n"), items, unsure),
    });
  });
}
