/**
 * Reading a menu's photos (#644; #789 items 4–6 and 15, D9, D12–D15): up to six pages in one call
 * to the reader, in order, as one menu, so a category that runs on keeps its price on the next
 * page. The body is one photo, or `multipart/form-data` with a `page` part per photo. The answer is
 * the rows (each with its page and category, a category's price given to its items without one,
 * toppings gathered when the menu lists none), the campaign and lunch notes, and the same rows as
 * a menu CSV for the import's preview. Nothing changes and no photo is kept.
 */
import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { notFound } from "./http.js";
import type { AppDeps } from "./http.js";
import { applyCategories, gatherToppings, rowsToCsv } from "./menu-rows.js";
import {
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  cleanPhoto,
  forProvider,
  photoOf,
  tooLarge,
} from "./photos.js";
import { NO_FACTS, authorize } from "./policy.js";
import { takeReader } from "./reader-key.js";
import { counted, signedIn } from "./reader-routes.js";
import { MAX_PAGES, PAGE_COST_MICRO_USD } from "./reader.js";
import type { Page } from "./reader.js";
import { getPizzeria } from "./store.js";
import { InvalidBody } from "./validate.js";
import { KitError } from "@canccu/kit";

const tooMany = () => new InvalidBody("page", `at most ${MAX_PAGES} pages in one read`);

/** The photos as sent: one image body, or each `page` part of a multipart body, in order. */
async function pagesOf(request: FastifyRequest): Promise<Page[]> {
  if (!request.isMultipart()) {
    const { photo, type } = photoOf(request.body, request.headers["content-type"]);
    return [{ image: photo, type }];
  }
  const pages: Page[] = [];
  try {
    for await (const part of request.parts()) {
      if (part.type !== "file" || part.fieldname !== "page") continue;
      const image = await part.toBuffer();
      if (part.file.truncated) throw tooLarge();
      if (PHOTO_TYPES[part.mimetype] === undefined)
        throw new KitError("Send JPEG, PNG or WebP photos.", {
          status: 415,
          code: "unsupported_media_type",
        });
      pages.push({ image, type: part.mimetype });
    }
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT") throw tooMany();
    if (code === "FST_REQ_FILE_TOO_LARGE") throw tooLarge();
    throw err;
  }
  if (pages.length === 0) throw new InvalidBody("page", "at least one photo of the menu");
  return pages;
}

export function menuReadRoute(app: FastifyInstance, deps: AppDeps): void {
  void app.register(async (scope) => {
    await scope.register(multipart, {
      limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PAGES, fields: 0, parts: MAX_PAGES },
    });
    scope.post<{ Querystring: { pizzeria_id?: string } }>(
      "/api/pizza/menu/read",
      async (request) => {
        const { ctx, caller } = await signedIn(deps, request);
        authorize("menu.read_photo", caller, NO_FACTS);
        const id = request.query.pizzeria_id;
        if (typeof id !== "string")
          throw new InvalidBody("pizzeria_id", "the pizzeria the menu is of");
        // Cleaned before a read is reserved: a photo that is not one costs no read.
        const sent: Page[] = [];
        for (const p of await pagesOf(request)) {
          const clean = await cleanPhoto(p.image, p.type);
          sent.push(await forProvider(clean.image, clean.type));
        }
        const { pizzeria, taken } = await deps.db.tenant(async (c) => {
          const pizzeria = await getPizzeria(c, id);
          if (pizzeria === null) throw notFound("pizzeria");
          return {
            pizzeria,
            taken: await takeReader(
              c,
              deps,
              ctx.tenant_id,
              ctx.time_zone,
              deps.now(),
              "menu",
              sent.length,
            ),
          };
        });
        const { reading } = await counted(deps, taken, (reader) => reader.menu(sent));
        const rows = gatherToppings(applyCategories(reading.rows));
        const items = rows.filter((r) => r.kind === "item");
        return {
          pizzeria_id: pizzeria.id,
          csv: rowsToCsv(pizzeria.name, rows),
          items: items.length,
          unsure: items.filter((r) => r.unsure).map((r) => r.number as string),
          rows,
          notes: reading.notes,
          pages: sent.length,
          cost_estimate_micro_usd: sent.length * PAGE_COST_MICRO_USD,
        };
      },
    );
  });
}
