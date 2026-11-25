/**
 * Reading a menu's photos (mockup 11 D; `pizza.menu.write`, the AI reader on; #789 items 1–6 and
 * 15): the photos, up to six pages, go to the reader in one read; its answer is an editable table
 * (`menu-table.ts`) that travels in its form, so nothing is saved here and no photo is kept. The
 * table's "Check the import" goes to the import's own preview, which shows the changes against the
 * menus as they are then, before anything is applied. With the page's script the read answers its
 * steps as it takes them (steps.ts) and ends with the table's fields to post.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import type { AppDeps } from "../http.js";
import { mergeRows, rowsToCsv } from "../menu-rows.js";
import { MENU_WRITE } from "../policy.js";
import { readerAvailable } from "../reader-key.js";
import type { MenuNote, MenuRow } from "../reader.js";
import { PREFIX, backTo, formText, must, organiserPage, pageCtx, viaApi } from "./kit.js";
import type { PageCtx, Photo } from "./kit.js";
import { previewPage } from "./menu-pages.js";
import { MENU_SECONDS_PER_PAGE, pickView } from "./menu-read-views.js";
import { act, tableFields, tableOf } from "./menu-table.js";
import { tableView } from "./menu-table-views.js";
import type { Table } from "./menu-table.js";
import { failedTo, failureFrom, failureOf } from "./read-errors.js";
import type { ReadFailure } from "./read-errors.js";
import { stepsFor } from "./steps.js";
import type { Steps } from "./steps.js";
import { photosOf } from "./uploads.js";

const P = `${PREFIX}crew/pizzerias`;
type Params = { id: string };

/** Several pages go to the API as one multipart body, a `page` part each, in order. */
function pagesBody(photos: Photo[]): Photo {
  if (photos.length === 1) return photos[0] as Photo;
  const boundary = `----canccuMenuPages${Date.now().toString(36)}`;
  const parts = photos.flatMap((p, i) => [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="page"; filename="page${i + 1}"\r\nContent-Type: ${p.type}\r\n\r\n`,
    ),
    p.bytes,
    Buffer.from("\r\n"),
  ]);
  return {
    bytes: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]),
    type: `multipart/form-data; boundary=${boundary}`,
  };
}

/** A failure carried in the table's own fields (after "Add more pages"), as in an address. */
const failureFields = (f: ReadFailure | null): Record<string, string> =>
  f === null
    ? {}
    : {
        failed: f.failed,
        ...(f.after === null ? {} : { after: String(f.after) }),
        ...(f.why === null ? {} : { why: f.why }),
      };

export function menuReadPages(app: FastifyInstance, deps: AppDeps): void {
  const writer = async (request: FastifyRequest) => {
    const c = await pageCtx(deps, request);
    if (!c.session.rights.has(MENU_WRITE))
      throw new KitError(`needs right ${MENU_WRITE}`, { status: 403, code: "missing_right" });
    if (!(await readerAvailable(deps, c.tenant)))
      throw new KitError("The reader is off here.", { status: 409, code: "reader_off" });
    return c;
  };

  const page = (
    request: FastifyRequest<{ Params: Params }>,
    reply: FastifyReply,
    c: PageCtx,
    body: Parameters<typeof organiserPage>[4]["body"],
  ) =>
    organiserPage(request, reply, deps, c, {
      title: c.t("read.title"),
      crumb: { href: `${P}/${encodeURIComponent(request.params.id)}`, label: c.t("tab.pizzerias") },
      narrow: true,
      body,
    });

  /** The table: drawn, or, for the page's script, its fields to post to the table's page. */
  const show = async (
    request: FastifyRequest<{ Params: Params }>,
    reply: FastifyReply,
    steps: Steps,
    c: PageCtx,
    table: Table,
    failure: ReadFailure | null = null,
  ) => {
    const id = request.params.id;
    if (steps.streamed)
      return steps.post(`${P}/${encodeURIComponent(id)}/read/table`, {
        ...tableFields(table),
        do: "show",
        ...failureFields(failure),
      });
    const pizzeria = must(
      await viaApi(app, request, "GET", `/api/pizza/pizzerias/${encodeURIComponent(id)}`),
    );
    return page(
      request,
      reply,
      c,
      tableView(c, { pizzeriaId: id, pizzeria: String(pizzeria.name), table, failure }),
    );
  };

  /** The photos as sent, or where the page goes when they cannot be. */
  const photosFor = async (request: FastifyRequest) => {
    try {
      return { photos: await photosOf(request) };
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      // Too large or too many is said on the page, not as an error page.
      if (code !== "file_too_large" && code !== "too_many_pages") throw err;
      return { photos: [], failed: code as string };
    }
  };

  /** A read of `photos`: the API's answer, the page told the steps as they are taken. */
  const read = async (
    request: FastifyRequest<{ Params: Params }>,
    steps: Steps,
    photos: Photo[],
  ) => {
    steps.phase({
      phase: "reading",
      pages: photos.length,
      seconds: MENU_SECONDS_PER_PAGE * photos.length,
    });
    const a = await viaApi(
      app,
      request,
      "POST",
      `/api/pizza/menu/read?pizzeria_id=${encodeURIComponent(request.params.id)}`,
      pagesBody(photos),
    );
    if (a.status < 400) steps.phase({ phase: "checking" });
    return a;
  };

  /** The script's stream must end with somewhere to go, also when the page itself failed. */
  const streamed =
    (
      fn: (
        request: FastifyRequest<{ Params: Params }>,
        reply: FastifyReply,
        steps: Steps,
      ) => Promise<FastifyReply>,
    ) =>
    async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
      const steps = stepsFor(request, reply);
      try {
        return await fn(request, reply, steps);
      } catch (err) {
        if (!steps.streamed) throw err;
        request.log.error({ err }, "a menu read's page failed");
        return steps.go(`${P}/${encodeURIComponent(request.params.id)}/read?failed=failed`);
      }
    };

  app.get<{ Params: Params; Querystring: Record<string, string | undefined> }>(
    "/crew/pizzerias/:id/read",
    async (request, reply) => {
      const c = await writer(request);
      const id = encodeURIComponent(request.params.id);
      return page(
        request,
        reply,
        c,
        pickView(c, {
          action: `${P}/${id}/read`,
          type: `${P}/${id}`,
          error: request.query.error,
          failure: failureOf(request.query),
        }),
      );
    },
  );

  app.post<{ Params: Params }>(
    "/crew/pizzerias/:id/read",
    streamed(async (request, reply, steps) => {
      const c = await writer(request);
      const back = `crew/pizzerias/${encodeURIComponent(request.params.id)}/read`;
      const { photos, failed } = await photosFor(request);
      if (failed !== undefined) return steps.go(`${PREFIX}${back}?failed=${failed}`);
      if (photos.length === 0) return steps.go(backTo(back));
      const a = await read(request, steps, photos);
      if (a.status >= 400) return steps.go(failedTo(back, a));
      const r = must(a) as { rows: MenuRow[]; notes: MenuNote[] };
      return show(request, reply, steps, c, { rows: r.rows, notes: r.notes, conflicts: [] });
    }),
  );

  /** The table's own actions: show, add, delete, merge, more pages, and the import's preview. */
  app.post<{ Params: Params }>(
    "/crew/pizzerias/:id/read/table",
    streamed(async (request, reply, steps) => {
      const c = await writer(request);
      const { photos, failed } = await photosFor(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const table = tableOf(body);
      const action = formText(request, "do") ?? "show";
      if (action === "check") {
        const pizzeria = must(
          await viaApi(
            app,
            request,
            "GET",
            `/api/pizza/pizzerias/${encodeURIComponent(request.params.id)}`,
          ),
        );
        const csv = rowsToCsv(String(pizzeria.name), table.rows);
        return previewPage(
          app,
          deps,
          request,
          reply,
          c,
          csv,
          `crew/pizzerias/${request.params.id}`,
        );
      }
      if (action !== "more") {
        const kept = failureOf(body as Record<string, string | undefined>);
        return show(request, reply, steps, c, act(table, action), kept);
      }
      if (failed !== undefined) return show(request, reply, steps, c, table, failureOf({ failed }));
      if (photos.length === 0) return show(request, reply, steps, c, table);
      const a = await read(request, steps, photos);
      if (a.status >= 400) return show(request, reply, steps, c, table, failureFrom(a));
      const r = must(a) as { rows: MenuRow[]; notes: MenuNote[] };
      // The new pages come after those read before.
      const offset = Math.max(0, ...table.rows.map((x) => x.page));
      const added = r.rows.map((x) => ({ ...x, page: x.page + offset }));
      const merged = mergeRows(table.rows, added);
      return show(request, reply, steps, c, {
        rows: merged.rows,
        notes: [...table.notes, ...r.notes.map((n) => ({ ...n, page: n.page + offset }))],
        conflicts: [...new Set([...table.conflicts, ...merged.conflicts])],
      });
    }),
  );
}
