/**
 * Receipts (#644; contracts/pizza.md, Receipts): photos of what the pizzeria was paid, kept with
 * the order in the files volume, per event, location stripped. A receipt can show card digits, so
 * only the holder, the crew and the organiser (`pizza.record.read`) see one, and every photo of the
 * event goes at the 12-month anonymisation.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FastifyInstance } from "fastify";
import { KitError, tenantFile } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import { notFound, ok, tenantOf, whoIs, write } from "./http.js";
import type { AppDeps } from "./http.js";
import { Conflict, cannot } from "./conflicts.js";
import { newId } from "./ids.js";
import { CALLED_IN } from "./model.js";
import { PHOTO_TYPES, cleanPhoto, photoOf } from "./photos.js";
import { authorize } from "./policy.js";
import { facts, orderFor } from "./present.js";
import { getOrder, logStep } from "./store.js";
import type { OrderRow } from "./store.js";

/** Enough for an order paid in parts; more is a mistake, not a receipt. */
export const MAX_RECEIPTS = 10;

export interface ReceiptRow {
  id: string;
  order_id: string;
  file: string;
  type: string;
  bytes: number;
  added_at: Date;
  added_by_user_id: string | null;
  added_by_name: string | null;
  read: Record<string, unknown> | null;
}

const MODULE = "pizza";
export const receiptPath = (root: string, file: string) =>
  tenantFile(MODULE, `receipts/${file}`, root);

export function receiptView(r: ReceiptRow) {
  return {
    id: r.id,
    order_id: r.order_id,
    type: r.type,
    bytes: r.bytes,
    added_at: r.added_at.toISOString(),
    added_by:
      r.added_by_user_id === null ? null : { user_id: r.added_by_user_id, name: r.added_by_name },
    read: r.read,
  };
}

export async function receiptsOf(c: SqlClient, orderId: string): Promise<ReceiptRow[]> {
  const { rows } = await c.query(
    `SELECT * FROM pizza_receipts WHERE order_id = $1 ORDER BY added_at, id`,
    [orderId],
  );
  return rows as unknown as ReceiptRow[];
}

export async function getReceipt(c: SqlClient, id: string): Promise<ReceiptRow | null> {
  const { rows } = await c.query(`SELECT * FROM pizza_receipts WHERE id = $1`, [id]);
  return (rows[0] as ReceiptRow | undefined) ?? null;
}

/** The receipt and its order, for a caller who may `action` on that order's money. */
export async function receiptFor(
  c: SqlClient,
  deps: AppDeps,
  request: Parameters<typeof tenantOf>[0],
  id: string,
  action: "receipt.read" | "receipt.add",
): Promise<{ receipt: ReceiptRow; order: OrderRow }> {
  const { caller } = await whoIs(deps, request);
  const receipt = await getReceipt(c, id);
  if (receipt === null) throw notFound("receipt");
  const order = (await getOrder(c, receipt.order_id)) as OrderRow;
  authorize(action, caller, facts(tenantOf(request), deps.now(), order));
  return { receipt, order };
}

/** Every receipt photo of the event, at the anonymisation and when the event is deleted. */
export async function deleteReceiptFiles(root: string): Promise<void> {
  await rm(dirname(receiptPath(root, "x")), { recursive: true, force: true });
}

export function receiptRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post<{ Params: { id: string } }>("/api/pizza/orders/:id/receipts", async (request, reply) => {
    // Re-encoded before the order's lock is taken: it is the slow part, and holds nobody up.
    const { photo, type: sent } = photoOf(request.body, request.headers["content-type"]);
    const { image: clean, type } = await cleanPhoto(photo, sent);
    return write(deps, request, reply, async (c, w) => {
      const order = await getOrder(c, request.params.id, true);
      if (order === null) throw notFound();
      authorize("receipt.add", w.caller, facts(w.ctx, w.now, order));
      if (order.state === "cancelled" || !CALLED_IN.includes(order.state))
        throw cannot("total", order);
      if ((await receiptsOf(c, order.id)).length >= MAX_RECEIPTS) {
        throw new Conflict("too_many_receipts", `An order keeps at most ${MAX_RECEIPTS} receipts.`);
      }
      const id = newId("pr");
      const file = `${id}.${(PHOTO_TYPES[type] as { ext: string }).ext}`;
      const path = receiptPath(deps.filesRoot, file);
      // Written before the row: a transaction that fails after leaves a file no row names, which
      // the anonymisation still deletes with the whole folder.
      await onVolume(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, clean);
      });
      const { rows } = await c.query(
        `INSERT INTO pizza_receipts (id, order_id, file, type, bytes, added_at, added_by_user_id, added_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [id, order.id, file, type, clean.length, w.now, w.session.userId, w.session.userName],
      );
      await logStep(
        c,
        order.id,
        w.now,
        { user_id: w.session.userId, name: w.session.userName },
        "receipt_added",
      );
      return ok(receiptView(rows[0] as unknown as ReceiptRow), 201);
    });
  });

  app.get<{ Params: { id: string } }>("/api/pizza/orders/:id/receipts", async (request) => {
    const ctx = tenantOf(request);
    const { caller } = await whoIs(deps, request);
    return deps.db.tenant(async (c) => {
      const { order } = await orderFor(
        c,
        request.params.id,
        "receipt.read",
        caller,
        ctx,
        deps.now(),
      );
      return { receipts: (await receiptsOf(c, order.id)).map(receiptView) };
    });
  });

  app.get<{ Params: { id: string } }>("/api/pizza/receipts/:id/photo", async (request, reply) => {
    const { receipt } = await deps.db.tenant((c) =>
      receiptFor(c, deps, request, request.params.id, "receipt.read"),
    );
    const bytes = await readFile(receiptPath(deps.filesRoot, receipt.file)).catch(() => {
      throw notFound("receipt");
    });
    return reply
      .type(receipt.type)
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .send(bytes);
  });
}

/** A volume the module may not write answers 503 an operator can act on, not a 500. */
async function onVolume(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "ENOSPC") {
      throw new KitError(
        "The files volume cannot be written, so receipts are off. Tell an operator.",
        {
          status: 503,
          code: "files_unavailable",
        },
      );
    }
    throw err;
  }
}
