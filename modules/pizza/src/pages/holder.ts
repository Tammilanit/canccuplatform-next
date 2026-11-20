/**
 * The holder's pages (`/pizza/hold/{order}`, mockups 07–09). Each reads the order through the API
 * as the caller, so the holder and the crew see it all and anyone else what a member sees; each
 * form is the API's own step.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { html, timeLabel } from "@canccu/ui";
import type { AppDeps } from "../http.js";
import type { Summary } from "../summary.js";
import { nextLocalTime } from "../time.js";
import { cancelView, handOutView, overView } from "./handout-views.js";
import { calledInView, callView, checklistView, hereView, notHeldView } from "./holder-views.js";
import type { MoneyView } from "./money-format.js";
import type { OrderView } from "./order-view.js";
import { back, formText, hubPage, must, pageCtx, viaApi } from "./kit.js";
import type { PageCtx } from "./kit.js";

type Params = { id: string };
type Q = { error?: string };
const STEPS = new Set(["close", "reopen", "release", "claim", "undo", "done", "cancel"]);

export function holderPages(app: FastifyInstance, deps: AppDeps): void {
  const read = async (request: FastifyRequest, id: string): Promise<OrderView> =>
    must(
      await viaApi(app, request, "GET", `/api/pizza/orders/${encodeURIComponent(id)}`),
    ) as unknown as OrderView;
  const backTo = (c: PageCtx, o: OrderView) => ({
    href: `/pizza/hold/${o.id}`,
    label: c.t("hold.back", { seq: o.seq }),
  });
  /** The holder's own pages: anyone else sees whose order it is, or that it needs someone. */
  const mine = (o: OrderView, c: PageCtx) =>
    o.you_hold === true || (o.items !== undefined && c.session.rights.has("pizza.order.manage"));

  app.get<{ Params: Params; Querystring: Q }>("/hold/:id", async (request, reply) => {
    const c = await pageCtx(deps, request);
    const o = await read(request, request.params.id);
    const title =
      o.you_hold === true
        ? c.t("hold.your_order", { seq: o.seq })
        : c.t("hold.order", { seq: o.seq });
    // The money step stays open after done (mockup 18): the holder's until the day turns.
    const money =
      mine(o, c) && ["placed", "arrived", "done"].includes(o.state)
        ? html`<a
            class="canccu-button canccu-button--secondary pizza-wide"
            href="/pizza/hold/${o.id}/money"
            >${c.t("hand.order_money")}</a
          >`
        : "";
    if (o.state === "done" || o.state === "cancelled")
      return hubPage(request, reply, c, { title, body: html`${overView(c, o)}${money}` });
    if (!mine(o, c))
      return hubPage(request, reply, c, {
        title,
        body: notHeldView(c, o, request.query.error),
      });
    const s = await deps.settings(c.tenant);
    const lastCall = timeLabel(
      new Date(new Date(o.closes_at).getTime() - s.last_call_minutes * 60_000).toISOString(),
      c.zone,
    );
    return hubPage(request, reply, c, {
      title,
      body: html`${checklistView(c, o, { lastCall, autoClose: s.auto_close, ...opt(request.query.error) })}${money}`,
    });
  });

  const holderOnly = async (
    request: FastifyRequest<{ Params: Params; Querystring: Q }>,
    reply: FastifyReply,
    title: (c: PageCtx, o: OrderView) => string,
    body: (
      c: PageCtx,
      o: OrderView,
    ) => Promise<ReturnType<typeof callView>> | ReturnType<typeof callView>,
    states: OrderView["state"][],
  ) => {
    const c = await pageCtx(deps, request);
    const o = await read(request, request.params.id);
    if (!mine(o, c) || !states.includes(o.state)) return reply.redirect(`/pizza/hold/${o.id}`, 303);
    return hubPage(request, reply, c, {
      title: title(c, o),
      back: backTo(c, o),
      body: await body(c, o),
    });
  };

  app.get<{ Params: Params; Querystring: Q }>("/hold/:id/call", (request, reply) =>
    holderOnly(
      request,
      reply,
      (c) => c.t("call.title"),
      async (c, o) => {
        const summary = must(
          await viaApi(app, request, "GET", `/api/pizza/orders/${o.id}/summary`),
        ) as unknown as Summary;
        return callView(c, o, summary);
      },
      ["open", "closed", "placed"],
    ),
  );

  app.get<{ Params: Params; Querystring: Q }>("/hold/:id/called-in", (request, reply) =>
    holderOnly(
      request,
      reply,
      (c) => c.t("called.title"),
      (c, o) => {
        // U13: the payer is the holder, or someone with a pizza in the order.
        const people = new Map<string, string>();
        if (o.holder?.user_id !== undefined) people.set(o.holder.user_id, o.holder.name ?? "—");
        for (const i of o.items ?? [])
          if (i.user_id !== null && i.name !== null) people.set(i.user_id, i.name);
        return calledInView(
          c,
          o,
          [...people].map(([user_id, name]) => ({ user_id, name })),
          o.holder?.user_id ?? c.session.userId,
          request.query.error,
        );
      },
      ["open", "closed"],
    ),
  );

  app.get<{ Params: Params; Querystring: Q }>("/hold/:id/here", (request, reply) =>
    holderOnly(
      request,
      reply,
      (c) => c.t("here.title"),
      (c, o) => hereView(c, o, request.query.error),
      ["placed"],
    ),
  );

  app.get<{ Params: Params; Querystring: Q }>("/hold/:id/hand-out", (request, reply) =>
    holderOnly(
      request,
      reply,
      (c) => c.t("hand.title"),
      async (c, o) => {
        const m = await viaApi(app, request, "GET", `/api/pizza/orders/${o.id}/money`);
        return handOutView(
          c,
          o,
          c.session.userId,
          request.query.error,
          m.status < 400 ? (m.body as unknown as MoneyView) : undefined,
        );
      },
      ["arrived", "done"],
    ),
  );

  app.get<{ Params: Params; Querystring: Q }>("/hold/:id/cancel", (request, reply) =>
    holderOnly(
      request,
      reply,
      (c) => c.t("cancel.title"),
      (c, o) => cancelView(c, o, request.query.error),
      ["open", "closed"],
    ),
  );

  // The forms: each one the API's step, then back to where the holder goes next.
  app.post<{ Params: Params & { step: string } }>(
    "/hold/:id/step/:step",
    async (request, reply) => {
      const { id, step } = request.params;
      if (!STEPS.has(step)) return reply.redirect(`/pizza/hold/${id}`, 303);
      const reason = formText(request, "reason");
      const a = await viaApi(
        app,
        request,
        "POST",
        `/api/pizza/orders/${id}/${step}`,
        reason === null ? {} : { reason },
      );
      if (a.status >= 400)
        return back(
          reply,
          step === "cancel"
            ? `hold/${id}/cancel`
            : step === "done"
              ? `hold/${id}/hand-out`
              : `hold/${id}`,
          a,
        );
      return back(reply, step === "close" ? `hold/${id}/call` : `hold/${id}`);
    },
  );

  app.post<{ Params: Params }>("/hold/:id/called-in", async (request, reply) => {
    const { id } = request.params;
    const minutes = formText(request, "estimate_minutes");
    const payer = formText(request, "payer_user_id");
    const a = await viaApi(app, request, "POST", `/api/pizza/orders/${id}/place`, {
      ...(minutes === null ? {} : { estimate_minutes: Number(minutes) }),
      ...(payer === null ? {} : { payer_user_id: payer }),
    });
    return a.status >= 400 ? back(reply, `hold/${id}/called-in`, a) : back(reply, `hold/${id}`);
  });

  app.post<{ Params: Params }>("/hold/:id/here", async (request, reply) => {
    const { id } = request.params;
    const pickup = formText(request, "pickup");
    const a = await viaApi(
      app,
      request,
      "POST",
      `/api/pizza/orders/${id}/arrive`,
      pickup === null ? {} : { pickup },
    );
    return a.status >= 400 ? back(reply, `hold/${id}/here`, a) : back(reply, `hold/${id}/hand-out`);
  });

  app.post<{ Params: Params }>("/hold/:id/hand-out", async (request, reply) => {
    const { id } = request.params;
    const a = await viaApi(app, request, "POST", `/api/pizza/orders/${id}/hand-out`, {});
    return back(reply, `hold/${id}/hand-out`, a);
  });

  app.post<{ Params: Params }>("/hold/:id/nudge", async (request, reply) => {
    const { id } = request.params;
    const a = await viaApi(app, request, "POST", `/api/pizza/orders/${id}/nudge`, {});
    return back(reply, `hold/${id}/hand-out`, a);
  });

  /** A person's tick: each of their pizzas, one API call each (the last one may make it done). */
  app.post<{ Params: Params }>("/hold/:id/tick", async (request, reply) => {
    const { id } = request.params;
    const who = formText(request, "user_id");
    const handed = formText(request, "handed_out") !== "no";
    const o = await read(request, id);
    for (const [n, i] of (o.items ?? []).entries()) {
      if ((i.user_id ?? i.id) !== who || i.handed_out === handed) continue;
      const a = await viaApi(
        app,
        request,
        "POST",
        `/api/pizza/items/${i.id}/hand-out`,
        { handed_out: handed },
        n,
      );
      if (a.status >= 400) return back(reply, `hold/${id}/hand-out`, a);
    }
    return back(reply, `hold/${id}/hand-out`);
  });

  /**
   * Edit: the close time (today's, in the event's zone, or tomorrow's when it has passed) and the
   * note. An unchanged time is not sent: it may have passed, and would then turn into tomorrow's.
   */
  app.post<{ Params: Params }>("/hold/:id/edit", async (request, reply) => {
    const { id } = request.params;
    const c = await pageCtx(deps, request);
    const submitted = formText(request, "closes");
    const changed = submitted !== formText(request, "closes_was");
    const closes = changed ? nextLocalTime(submitted, c.zone, deps.now()) : null;
    const a = await viaApi(app, request, "PATCH", `/api/pizza/orders/${id}`, {
      ...(closes === null ? {} : { closes_at: closes }),
      note: formText(request, "note"),
    });
    return back(reply, `hold/${id}`, a);
  });
}

const opt = (error: string | undefined) => (error === undefined ? {} : { error });
