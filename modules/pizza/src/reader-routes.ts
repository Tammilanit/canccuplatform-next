/**
 * Reading a receipt or a menu photo (#644, M3, D10). The provider gets the photo and fixed
 * instructions, nothing else; its answer is kept as a suggestion on the receipt and never touches
 * the order's money, which changes only when the holder confirms it (PATCH …/money). A menu read
 * (`menu-read-route.ts`) becomes a table and a menu CSV for the import's preview.
 *
 * Not idempotent by key: each call is a read, logged, and counted against the event's daily reads
 * unless the provider billed nothing for it (#789 D6). The call to the provider runs outside a
 * transaction, so a slow provider holds no lock; a refused key still stops the reader.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { NotSignedIn } from "@canccu/kit";
import { eventArchived, notFound, tenantOf, whoIs } from "./http.js";
import type { AppDeps } from "./http.js";
import { CALLED_IN } from "./model.js";
import { forProvider } from "./photos.js";
import { authorize } from "./policy.js";
import { facts } from "./present.js";
import { matchReceipt } from "./receipt-match.js";
import { noteRead, takeReader } from "./reader-key.js";
import type { ReadResult, Taken } from "./reader-key.js";
import type { ReadUsage, Reader } from "./reader.js";
import { ReaderFailed, ReaderKeyRejected } from "./reader.js";
import { getReceipt, receiptPath, receiptView } from "./receipts.js";
import type { ReceiptRow } from "./receipts.js";
import { cannot } from "./conflicts.js";
import { getOrder, itemsOf } from "./store.js";
import type { OrderRow } from "./store.js";
import { readFile } from "node:fs/promises";

/**
 * The provider call, logged however it ends: its outcome, the model's reason, the tokens and the
 * time. A failed read changes nothing else; the crew may be told the reader stopped (`noteRead`).
 */
export async function counted<T extends { usage: ReadUsage }>(
  deps: AppDeps,
  taken: Taken,
  call: (reader: Reader) => Promise<T>,
): Promise<T> {
  const started = performance.now();
  let result: ReadResult = { outcome: "failed", reason: null, usage: null, ms: 0 };
  try {
    const answer = await call(taken.reader);
    result = { outcome: "ok", reason: null, usage: answer.usage, ms: 0 };
    return answer;
  } catch (err) {
    if (err instanceof ReaderKeyRejected) result = { ...result, outcome: "rejected" };
    if (err instanceof ReaderFailed)
      result = {
        outcome: err.reason,
        reason: err.reason === "unreadable" ? err.message : null,
        usage: err.usage,
        ms: 0,
      };
    throw err;
  } finally {
    const ms = performance.now() - started;
    await deps.db.tenant((c) => noteRead(c, deps, taken, { ...result, ms }, deps.now()));
    await deps.outbox.flush();
  }
}

export async function signedIn(deps: AppDeps, request: FastifyRequest) {
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
    const { reading } = await counted(deps, taken, (reader) => reader.receipt(image, type));
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
}
