/**
 * Reading a receipt or a menu photo (#644, M3, D10). The provider gets the photo and fixed
 * instructions, nothing else; its answer is kept as a suggestion on the receipt and never touches
 * the order's money, which changes only when the holder confirms it (PATCH …/money). A menu read
 * becomes a menu CSV for the import's preview, and its photo is not kept.
 *
 * Not idempotent by key: each call is a read, counted against the event's daily reads. The call
 * to the provider runs outside a transaction, so a slow provider holds no lock, and a failed read
 * is still counted (it was paid for) and a refused key still stops the reader.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { NotSignedIn } from "@canccu/kit";
import { csvLine, euros } from "./csv.js";
import { eventArchived, notFound, tenantOf, whoIs } from "./http.js";
import type { AppDeps } from "./http.js";
import { CALLED_IN } from "./model.js";
import { cleanPhoto, forProvider, photoOf } from "./photos.js";
import { NO_FACTS, authorize } from "./policy.js";
import { facts } from "./present.js";
import { matchReceipt } from "./receipt-match.js";
import { noteRead, takeReader } from "./reader-key.js";
import type { Taken } from "./reader-key.js";
import type { Reader } from "./reader.js";

import { ReaderKeyRejected } from "./reader.js";
import { getReceipt, receiptPath, receiptView } from "./receipts.js";
import type { ReceiptRow } from "./receipts.js";
import { cannot } from "./conflicts.js";
import { getOrder, getPizzeria, itemsOf } from "./store.js";
import type { OrderRow } from "./store.js";
import { InvalidBody } from "./validate.js";
import { readFile } from "node:fs/promises";

/** The provider call, counted however it ends. */
async function counted<T>(
  deps: AppDeps,
  taken: Taken,
  call: (reader: Reader) => Promise<T>,
): Promise<T> {
  let outcome: "ok" | "failed" | "rejected" = "ok";
  try {
    return await call(taken.reader);
  } catch (err) {
    outcome = err instanceof ReaderKeyRejected ? "rejected" : "failed";
    throw err;
  } finally {
    await deps.db.tenant((c) => noteRead(c, taken, outcome, deps.now()));
  }
}

async function signedIn(deps: AppDeps, request: FastifyRequest) {
  const ctx = tenantOf(request);
  const { caller } = await whoIs(deps, request);
  if (caller === null) throw new NotSignedIn("sign in first");
  if (ctx.status === "archived") throw eventArchived();
  return { ctx, caller };
}

export function readerRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post<{ Params: { id: string } }>("/api/pizza/receipts/:id/read", async (request) => {
    const { ctx, caller } = await signedIn(deps, request);
    const now = deps.now();
    const { receipt, taken } = await deps.db.tenant(async (c) => {
      const receipt = await getReceipt(c, request.params.id);
      if (receipt === null) throw notFound("receipt");
      const order = (await getOrder(c, receipt.order_id)) as OrderRow;
      authorize("receipt.add", caller, facts(ctx, now, order));
      if (order.state === "cancelled" || !CALLED_IN.includes(order.state))
        throw cannot("total", order);
      return {
        receipt,
        taken: await takeReader(c, deps, ctx.tenant_id, ctx.time_zone, now, "receipt"),
      };
    });
    const stored = await readFile(receiptPath(deps.filesRoot, receipt.file));
    const { image, type } = await forProvider(stored, receipt.type);
    const reading = await counted(deps, taken, (reader) => reader.receipt(image, type));
    // The match names each pizza's person, and the provider may take long: match against the
    // items as they are when the write happens, so a person deleted meanwhile (`anon_…`, no name)
    // is never stored again.
    const { rows } = await deps.db.tenant(async (c) => {
      const read = matchReceipt(reading, await itemsOf(c, [receipt.order_id]), now);
      return c.query(`UPDATE pizza_receipts SET read = $2 WHERE id = $1 RETURNING *`, [
        receipt.id,
        JSON.stringify(read),
      ]);
    });
    return receiptView(rows[0] as unknown as ReceiptRow);
  });

  app.post<{ Querystring: { pizzeria_id?: string } }>("/api/pizza/menu/read", async (request) => {
    const { ctx, caller } = await signedIn(deps, request);
    authorize("menu.read_photo", caller, NO_FACTS);
    const { photo, type } = photoOf(request.body, request.headers["content-type"]);
    const id = request.query.pizzeria_id;
    if (typeof id !== "string") throw new InvalidBody("pizzeria_id", "the pizzeria the menu is of");
    const { pizzeria, taken } = await deps.db.tenant(async (c) => {
      const pizzeria = await getPizzeria(c, id);
      if (pizzeria === null) throw notFound("pizzeria");
      return {
        pizzeria,
        taken: await takeReader(c, deps, ctx.tenant_id, ctx.time_zone, deps.now(), "menu"),
      };
    });
    const sent = await forProvider(await cleanPhoto(photo, type), type);
    const rows = await counted(deps, taken, (reader) => reader.menu(sent.image, sent.type));
    const csv = [
      csvLine(["pizzeria", "kind", "number", "name", "description", "price"]),
      ...rows.map((r) =>
        csvLine([
          pizzeria.name,
          "item",
          r.number,
          r.name,
          r.description ?? "",
          r.price_cents === null ? "" : euros(r.price_cents),
        ]),
      ),
      "",
    ].join("\n");
    return {
      pizzeria_id: pizzeria.id,
      csv,
      items: rows.length,
      unsure: rows.filter((r) => r.unsure).map((r) => r.number),
    };
  });
}
