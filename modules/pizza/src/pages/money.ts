/**
 * The money step's pages (`/pizza/hold/{order}/money…`, mockups 18 and 19): for the order's holder
 * and the crew once it is called in, also after done, until the API says the holder's money is
 * locked. Each form is the API's own write, so its rights, idempotency and audit are the API's.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppDeps } from "../http.js";
import { MANAGE } from "../policy.js";
import { readerAvailable } from "../reader-key.js";
import { back, formText, hubPage, must, pageCtx, refusal, viaApi } from "./kit.js";
import type { ApiAnswer, PageCtx } from "./kit.js";
import { parseEuro } from "./money-format.js";
import type { MoneyView, ReceiptView } from "./money-format.js";
import { moneyPageView } from "./money-views.js";
import type { OrderView } from "./order-view.js";
import { failureOf, failureQuery, readErrorView } from "./read-errors.js";
import { checkView, padView, scanView } from "./receipt-views.js";
import { photosOf } from "./uploads.js";

type Params = { id: string };
type Q = {
  error?: string;
  receipt?: string;
  failed?: string;
  after?: string;
  why?: string;
  tries?: string;
};
const MONEY_STATES = new Set(["placed", "arrived", "done"]);

/** A failed read or upload the address names: why, and its ways on (#789 item 11). */
function failed(c: PageCtx, id: string, q: Q) {
  const f = failureOf(q);
  const base = `/pizza/hold/${encodeURIComponent(id)}/money`;
  return f === null ? "" : readErrorView(c, f, { retry: `${base}/read`, type: `${base}/total` });
}

export function moneyPages(app: FastifyInstance, deps: AppDeps): void {
  const api = (request: FastifyRequest, path: string) =>
    viaApi(app, request, "GET", `/api/pizza/${path}`);

  /** The order and its money, for its holder and the crew; anyone else back to the order. */
  const load = async (request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) => {
    const c = await pageCtx(deps, request);
    const id = encodeURIComponent(request.params.id);
    const o = must(await api(request, `orders/${id}`)) as unknown as OrderView;
    const mine = o.you_hold === true || (o.items !== undefined && c.session.rights.has(MANAGE));
    if (!mine || !MONEY_STATES.has(o.state)) {
      void reply.redirect(`/pizza/hold/${o.id}`, 303);
      return null;
    }
    const m = must(await api(request, `orders/${id}/money`)) as unknown as MoneyView;
    return { c, o, m, reader: await readerAvailable(deps, c.tenant) };
  };
  const page = (
    request: FastifyRequest,
    reply: FastifyReply,
    c: PageCtx,
    o: OrderView,
    title: string,
    body: ReturnType<typeof moneyPageView>,
    to = `/pizza/hold/${o.id}`,
    /** The read to check sets its photo beside its lines (H3); every other money page is one flow. */
    layout?: "pair",
  ) =>
    hubPage(request, reply, deps, c, {
      title,
      ...(layout === undefined ? {} : { layout }),
      back: {
        href: to,
        label: to.endsWith("/money") ? c.t("money.title") : c.t("money.back", { seq: o.seq }),
      },
      body,
    });

  app.get<{ Params: Params; Querystring: Q }>("/hold/:id/money", async (request, reply) => {
    const l = await load(request, reply);
    if (l === null) return reply;
    const s = await deps.settings(l.c.tenant);
    return page(
      request,
      reply,
      l.c,
      l.o,
      l.c.t("money.title"),
      moneyPageView(l.c, l.o, l.m, {
        reader: l.reader,
        directly: s.settle_to_payer,
        me: l.c.session.userId,
        ...(request.query.error === undefined ? {} : { error: request.query.error }),
      }),
    );
  });

  app.get<{ Params: Params; Querystring: Q }>("/hold/:id/money/total", async (request, reply) => {
    const l = await load(request, reply);
    if (l === null) return reply;
    return page(
      request,
      reply,
      l.c,
      l.o,
      l.c.t("pad.title"),
      padView(l.c, l.o, {
        total: l.m.total_cents,
        reader: l.reader,
        ...(request.query.error === undefined ? {} : { error: request.query.error }),
      }),
      `/pizza/hold/${l.o.id}/money`,
    );
  });

  app.get<{ Params: Params; Querystring: Q }>("/hold/:id/money/scan", async (request, reply) => {
    const l = await load(request, reply);
    if (l === null) return reply;
    return page(
      request,
      reply,
      l.c,
      l.o,
      l.c.t("scan.title"),
      scanView(l.c, l.o, {
        reader: l.reader,
        ...(request.query.error === undefined ? {} : { error: request.query.error }),
        failure: failed(l.c, l.o.id, request.query),
      }),
      `/pizza/hold/${l.o.id}/money`,
    );
  });

  app.get<{ Params: Params; Querystring: Q }>("/hold/:id/money/check", async (request, reply) => {
    const l = await load(request, reply);
    if (l === null) return reply;
    const r = l.m.receipts.find((x: ReceiptView) => x.id === request.query.receipt);
    if (r?.read == null) return reply.redirect(`/pizza/hold/${l.o.id}/money`, 303);
    return page(
      request,
      reply,
      l.c,
      l.o,
      l.c.t("check.title"),
      checkView(l.c, l.o, r.id, r.read, request.query.error),
      `/pizza/hold/${l.o.id}/money/scan`,
      "pair",
    );
  });

  const moneyWrite = (request: FastifyRequest<{ Params: Params }>, body: Record<string, unknown>) =>
    viaApi(
      app,
      request,
      "PATCH",
      `/api/pizza/orders/${encodeURIComponent(request.params.id)}/money`,
      body,
    );
  const done = (reply: FastifyReply, id: string, a: ApiAnswer, failed = `hold/${id}/money`) =>
    back(reply, a.status >= 400 ? failed : `hold/${id}/money`, a);

  app.post<{ Params: Params }>("/hold/:id/money/total", async (request, reply) => {
    const { id } = request.params;
    const total = parseEuro(formText(request, "total"));
    if (total === null) {
      const c = await pageCtx(deps, request);
      return reply.redirect(
        `/pizza/hold/${id}/money/total?error=${encodeURIComponent(c.t("pad.invalid"))}`,
        303,
      );
    }
    return done(
      reply,
      id,
      await moneyWrite(request, { total_cents: total }),
      `hold/${id}/money/total`,
    );
  });

  app.post<{ Params: Params }>("/hold/:id/money/split", async (request, reply) => {
    const split = formText(request, "split");
    // A tap on the split already shown is not a choice: storing it would pin the even fallback of
    // a missing price, and the order would stay even once every pizza has its price (#789).
    const now = await viaApi(
      app,
      request,
      "GET",
      `/api/pizza/orders/${encodeURIComponent(request.params.id)}/money`,
    );
    // Nothing would change in storage: the same split is stored, or none is and the tap is the one shown.
    if (
      now.status === 200 &&
      (now.body.split === split || (now.body.split === null && now.body.split_effective === split))
    )
      return done(reply, request.params.id, now);
    return done(reply, request.params.id, await moneyWrite(request, { split }));
  });

  app.post<{ Params: Params }>("/hold/:id/money/settle", async (request, reply) => {
    const settle = formText(request, "settle_to");
    return done(reply, request.params.id, await moneyWrite(request, { settle_to: settle }));
  });

  app.post<{ Params: Params }>("/hold/:id/money/price", async (request, reply) => {
    const { id } = request.params;
    const item = formText(request, "item_id") ?? "";
    const price = parseEuro(formText(request, "price"));
    if (price === null) {
      const c = await pageCtx(deps, request);
      return reply.redirect(
        `/pizza/hold/${id}/money?error=${encodeURIComponent(c.t("pad.invalid"))}`,
        303,
      );
    }
    const a = await viaApi(
      app,
      request,
      "PUT",
      `/api/pizza/items/${encodeURIComponent(item)}/price`,
      {
        price_cents: price,
      },
    );
    return done(reply, id, a);
  });

  app.post<{ Params: Params }>("/hold/:id/money/pay-with", async (request, reply) => {
    const a = await viaApi(app, request, "PUT", "/api/pizza/me/pay-details", {
      mobilepay: formText(request, "mobilepay"),
      iban: formText(request, "iban"),
    });
    return done(reply, request.params.id, a);
  });

  app.post<{ Params: Params }>("/hold/:id/paid", async (request, reply) => {
    const { id } = request.params;
    const user = encodeURIComponent(formText(request, "user_id") ?? "");
    const a = await viaApi(
      app,
      request,
      "PUT",
      `/api/pizza/orders/${encodeURIComponent(id)}/paid/${user}`,
      {
        paid: formText(request, "paid") !== "no",
      },
    );
    return back(
      reply,
      formText(request, "back") === "money" ? `hold/${id}/money` : `hold/${id}/hand-out`,
      a,
    );
  });

  /** Reads a kept receipt: the check when it worked, else why and the way on. */
  const readReceipt = async (
    request: FastifyRequest<{ Params: Params }>,
    reply: FastifyReply,
    receipt: string,
    tries: number,
  ) => {
    const id = request.params.id;
    const read = await viaApi(
      app,
      request,
      "POST",
      `/api/pizza/receipts/${encodeURIComponent(receipt)}/read`,
      {},
      1 + tries,
    );
    if (read.status >= 400)
      return reply.redirect(
        `/pizza/hold/${id}/money/scan?${failureQuery(read, { receipt, tries })}`,
        303,
      );
    return reply.redirect(
      `/pizza/hold/${id}/money/check?receipt=${encodeURIComponent(receipt)}`,
      303,
    );
  };

  /** The photo: kept with the order, then read when the reader is on (after its notice). */
  app.post<{ Params: Params }>("/hold/:id/money/scan", async (request, reply) => {
    const { id } = request.params;
    let photo;
    try {
      [photo] = await photosOf(request);
    } catch (err) {
      // A photo over the limit is refused while it arrives: said on the page, not as an error page.
      if ((err as { code?: unknown }).code !== "file_too_large") throw err;
      return reply.redirect(`/pizza/hold/${id}/money/scan?failed=file_too_large`, 303);
    }
    if (photo === undefined) return back(reply, `hold/${id}/money/scan`);
    const added = await viaApi(
      app,
      request,
      "POST",
      `/api/pizza/orders/${encodeURIComponent(id)}/receipts`,
      photo,
      0,
    );
    if (added.status === 409 || added.status === 403)
      return back(reply, `hold/${id}/money/scan`, added);
    if (added.status >= 400)
      return reply.redirect(`/pizza/hold/${id}/money/scan?${failureQuery(added)}`, 303);
    const c = await pageCtx(deps, request);
    if (!(await readerAvailable(deps, c.tenant))) return back(reply, `hold/${id}/money/total`);
    return readReceipt(request, reply, String(added.body.id), 0);
  });

  /** Try again: the kept photo read once more (a busy reader's countdown sends it by itself). */
  app.post<{ Params: Params }>("/hold/:id/money/read", async (request, reply) => {
    const receipt = formText(request, "receipt_id");
    if (receipt === null) return back(reply, `hold/${request.params.id}/money/scan`);
    const tries = Math.min(Number(formText(request, "tries") ?? "1") || 1, 10);
    return readReceipt(request, reply, receipt, tries);
  });

  /** Confirm: the total, every price and the receipt they came from, in one write. */
  app.post<{ Params: Params }>("/hold/:id/money/check", async (request, reply) => {
    const { id } = request.params;
    const form = (request.body ?? {}) as Record<string, unknown>;
    const total = parseEuro(formText(request, "total"));
    const prices: { item_id: string; price_cents: number }[] = [];
    for (const [k, v] of Object.entries(form)) {
      const cents = typeof v === "string" ? parseEuro(v) : null;
      if (k.startsWith("price_") && cents !== null)
        prices.push({ item_id: k.slice(6), price_cents: cents });
    }
    const receipt = formText(request, "receipt_id");
    if (total === null) {
      const c = await pageCtx(deps, request);
      return reply.redirect(
        `/pizza/hold/${id}/money/check?receipt=${encodeURIComponent(receipt ?? "")}&error=${encodeURIComponent(c.t("pad.invalid"))}`,
        303,
      );
    }
    const a = await moneyWrite(request, { total_cents: total, receipt_id: receipt, prices });
    return done(
      reply,
      id,
      a,
      `hold/${id}/money/check?receipt=${encodeURIComponent(receipt ?? "")}`,
    );
  });
}
