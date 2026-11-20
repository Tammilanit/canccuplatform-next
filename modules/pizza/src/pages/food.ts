/**
 * The attendee's Food pages (#119; mockups 02–06 and 16), phone first in the hub's look: the Food
 * page, starting an order, my order and the menu. Guests reach the Food page and an order's page
 * (U15: what the screen shows); adding a pizza needs sign-in. Each page reads and writes through
 * the API as the caller, so its rights, idempotency and audit are the API's.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { tenantOf, whoIs } from "../http.js";
import type { AppDeps } from "../http.js";
import { OPEN } from "../policy.js";
import { nextLocalTime } from "../time.js";
import { translator } from "./messages.js";
import { back, formText, hubPage, must, pageCtx, refusal, viaApi } from "./kit.js";
import { foodView, isOpen, orderHref, startView } from "./food-views.js";
import type { FoodCtx, PizzeriaChoice } from "./food-views.js";
import { closedWhileView, myOrderView } from "./my-order-views.js";
import type { MineView, OrderView } from "./order-view.js";
import { pickView } from "./pick-views.js";
import type { Menu, Tab } from "./pick-views.js";

type Params = { id: string };
type Q = { error?: string };
const STREAM = "/api/pizza/stream";

/** The viewer of an attendee page: anyone the event's info-page mode lets in, signed in or not. */
async function foodCtx(deps: AppDeps, request: FastifyRequest): Promise<FoodCtx> {
  const ctx = tenantOf(request);
  const { session, caller } = await whoIs(deps, request);
  const lang = await deps.language(ctx.tenant_id).catch(() => "en");
  const s = await deps.settings(ctx.tenant_id);
  const member = caller?.member === true;
  return {
    t: translator(lang),
    lang,
    zone: ctx.time_zone,
    tenant: ctx.tenant_id,
    signedIn: session !== null,
    member,
    mayStart:
      member && s.ordering_open && (s.open_by === "anyone" || (session?.rights.has(OPEN) ?? false)),
  };
}

/** The next three half hours at least 20 minutes away, on the event's clock (mockup 06). */
function closeTimes(now: Date, zone: string): string[] {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: zone,
  });
  const step = 30 * 60_000;
  const first = Math.ceil((now.getTime() + 20 * 60_000) / step) * step;
  return [0, 1, 2].map((n) => fmt.format(new Date(first + n * step)));
}

/** An earlier order's event day, said from `today`'s: today, yesterday, or its date. */
function ago(c: FoodCtx, day: string, today: string): string {
  if (day === today) return c.t("pick.today");
  const before = new Date(`${today}T12:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  return day === before.toISOString().slice(0, 10) ? c.t("pick.yesterday") : day;
}

export function foodPages(app: FastifyInstance, deps: AppDeps): void {
  const api = (
    request: FastifyRequest,
    method: Parameters<typeof viaApi>[2],
    url: string,
    payload?: Record<string, unknown>,
    part?: number,
  ) => viaApi(app, request, method, url, payload, part);
  const order = async (request: FastifyRequest, id: string) =>
    must(
      await api(request, "GET", `/api/pizza/orders/${encodeURIComponent(id)}`),
    ) as unknown as OrderView;
  const page = (
    request: FastifyRequest,
    reply: FastifyReply,
    c: FoodCtx,
    o: { title: string; back?: string; live?: string; body: Parameters<typeof hubPage>[3]["body"] },
  ) =>
    hubPage(request, reply, c, {
      title: o.title,
      ...(o.back === undefined ? {} : { back: { href: o.back, label: c.t("hold.food") } }),
      ...(o.live === undefined ? {} : { live: { url: o.live, offline: c.t("live.offline") } }),
      body: o.body,
    });

  app.get<{ Querystring: Q }>("/", async (request, reply) => {
    const c = await foodCtx(deps, request);
    const s = await deps.settings(c.tenant);
    const a = await api(request, "GET", "/api/pizza/orders");
    // A guest where the info pages need sign-in sees only the way in.
    const orders = a.status === 403 ? null : ((must(a).orders ?? []) as OrderView[]);
    return page(request, reply, c, {
      title: c.t("hold.food"),
      live: STREAM,
      body: foodView(c, orders, {
        ordering: s.ordering_open,
        note: s.ordering_note,
        ...(request.query.error === undefined ? {} : { error: request.query.error }),
      }),
    });
  });

  // L6: the screen's QR lands on the only open order's menu, else on the list.
  app.get("/go", async (request, reply) => {
    const { caller } = await whoIs(deps, request);
    if (caller?.member !== true) return reply.redirect("/pizza/", 303);
    const a = await api(request, "GET", "/api/pizza/orders");
    const open = a.status < 400 ? ((a.body.orders ?? []) as OrderView[]).filter(isOpen) : [];
    const only = open.length === 1 ? open[0] : undefined;
    return reply.redirect(only === undefined ? "/pizza/" : `${orderHref(only)}/add`, 303);
  });

  app.get<{ Querystring: Q }>("/start", async (request, reply) => {
    await pageCtx(deps, request);
    const c = await foodCtx(deps, request);
    if (!c.mayStart) return reply.redirect("/pizza/", 303);
    const pizzerias = (must(await api(request, "GET", "/api/pizza/pizzerias")).pizzerias ??
      []) as PizzeriaChoice[];
    const orders = (must(await api(request, "GET", "/api/pizza/orders")).orders ??
      []) as OrderView[];
    return page(request, reply, c, {
      title: c.t("start.title"),
      back: "/pizza/",
      body: startView(
        c,
        pizzerias,
        orders.filter(isOpen),
        closeTimes(deps.now(), c.zone),
        request.query.error,
      ),
    });
  });

  app.post("/start", async (request, reply) => {
    await pageCtx(deps, request);
    const c = await foodCtx(deps, request);
    const picked = formText(request, "closes");
    const closes = nextLocalTime(
      picked === null || picked === "other" ? formText(request, "closes_other") : picked,
      c.zone,
      deps.now(),
    );
    const note = formText(request, "note");
    const a = await api(request, "POST", "/api/pizza/orders", {
      pizzeria_id: formText(request, "pizzeria_id"),
      closes_at: closes,
      ...(note === null ? {} : { note }),
    });
    if (a.status >= 400) return back(reply, "start", a);
    return reply.redirect(`${orderHref(a.body as { id: string })}?opened=1`, 303);
  });

  app.get<{ Params: Params; Querystring: Q & { added?: string; opened?: string } }>(
    "/orders/:id",
    async (request, reply) => {
      const c = await foodCtx(deps, request);
      const o = await order(request, request.params.id);
      return page(request, reply, c, {
        title: c.t("hold.order", { seq: o.seq }),
        back: "/pizza/",
        live: `${STREAM}?order=${o.id}`,
        body: myOrderView(c, o, {
          added: request.query.added === "1",
          opened: request.query.opened === "1",
          ...(request.query.error === undefined ? {} : { error: request.query.error }),
        }),
      });
    },
  );

  app.get<{ Params: Params; Querystring: Q & { tab?: string; q?: string; edit?: string } }>(
    "/orders/:id/add",
    async (request, reply) => {
      await pageCtx(deps, request);
      const c = await foodCtx(deps, request);
      const o = await order(request, request.params.id);
      const edit = (o.mine ?? []).find((p) => p.id === request.query.edit) ?? null;
      if (o.state !== "open" || !c.member) return reply.redirect(orderHref(o), 303);
      const pz = must(await api(request, "GET", `/api/pizza/pizzerias/${o.pizzeria.id}`));
      const menu = pz.menu as Menu;
      const asked = request.query.tab;
      const tab: Tab =
        asked === "own" || asked === "other" || asked === "menu"
          ? asked
          : edit?.kind === "custom"
            ? "own"
            : edit?.kind === "text"
              ? "other"
              : "menu";
      return page(request, reply, c, {
        title: c.t("hold.order", { seq: o.seq }),
        back: orderHref(o),
        body: pickView(c, o, menu, {
          tab,
          query: request.query.q ?? "",
          edit,
          last: edit === null ? await lastTime(request, c, o, menu) : null,
          ...(request.query.error === undefined ? {} : { error: request.query.error }),
        }),
      });
    },
  );

  /** U6: your newest pizza from this pizzeria in an earlier order, if it can still be ordered. */
  async function lastTime(request: FastifyRequest, c: FoodCtx, o: OrderView, menu: Menu) {
    const a = await api(request, "GET", "/api/pizza/me/orders");
    if (a.status >= 400) return null;
    for (const x of (a.body.orders ?? []) as OrderView[]) {
      if (x.id === o.id || x.pizzeria.id !== o.pizzeria.id) continue;
      for (const p of [...(x.mine ?? [])].reverse()) {
        const when = ago(c, x.day, o.day);
        if (p.kind !== "menu") return { pizza: p, when };
        const item = menu.items.find((i) => i.number === p.number);
        if (item !== undefined) return { pizza: p, when, menuItem: item.id };
      }
    }
    return null;
  }

  app.post<{ Params: Params }>("/orders/:id/add", async (request, reply) => {
    const { id } = request.params;
    const kind = formText(request, "kind");
    const edit = formText(request, "edit");
    const raw = (request.body as Record<string, unknown> | undefined)?.toppings;
    const toppings = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map(String);
    const payload = {
      kind,
      ...(kind === "menu" ? { menu_item_id: formText(request, "menu_item_id") } : {}),
      ...(kind === "custom" ? { toppings } : {}),
      ...(kind === "text" ? { text: formText(request, "text") } : {}),
      note: formText(request, "note"),
      comment: formText(request, "comment"),
    };
    const a =
      edit === null
        ? await api(request, "POST", `/api/pizza/orders/${id}/items`, payload)
        : await api(request, "PUT", `/api/pizza/items/${encodeURIComponent(edit)}`, payload);
    if (a.status < 400)
      return reply.redirect(`/pizza/orders/${id}${edit === null ? "?added=1" : ""}`, 303);
    const err = (a.body.error ?? {}) as { code?: string; open_orders?: [] };
    if (a.status === 409 && err.code === "closed" && edit === null) {
      const c = await foodCtx(deps, request);
      const o = await order(request, id);
      return page(request, reply, c, {
        title: c.t("hold.order", { seq: o.seq }),
        back: "/pizza/",
        body: closedWhileView(c, o, err.open_orders ?? []),
      });
    }
    const tab = kind === "custom" ? "own" : kind === "text" ? "other" : "menu";
    return reply.redirect(
      `/pizza/orders/${id}/add?tab=${tab}${edit === null ? "" : `&edit=${encodeURIComponent(edit)}`}&error=${encodeURIComponent(refusal(a))}`,
      303,
    );
  });

  app.post<{ Params: Params }>("/items/:id/delete", async (request, reply) => {
    const orderId = formText(request, "order_id") ?? "";
    const a = await api(
      request,
      "DELETE",
      `/api/pizza/items/${encodeURIComponent(request.params.id)}`,
    );
    return back(reply, `orders/${encodeURIComponent(orderId)}`, a);
  });

  app.post<{ Params: Params }>("/orders/:id/got-mine", async (request, reply) => {
    const o = await order(request, request.params.id);
    for (const [n, p] of (o.mine ?? ([] as MineView[])).entries()) {
      if (p.handed_out) continue;
      const a = await api(
        request,
        "POST",
        `/api/pizza/items/${p.id}/hand-out`,
        { handed_out: true },
        n,
      );
      if (a.status >= 400) return back(reply, `orders/${o.id}`, a);
    }
    return back(reply, `orders/${o.id}`);
  });

  // Mockup 16: taking over an order nobody holds, and cancelling one left from an earlier day.
  app.post<{ Params: Params & { step: string } }>(
    "/orders/:id/step/:step",
    async (request, reply) => {
      const { id, step } = request.params;
      if (step !== "claim" && step !== "cancel") return reply.redirect("/pizza/", 303);
      const a = await api(
        request,
        "POST",
        `/api/pizza/orders/${encodeURIComponent(id)}/${step}`,
        {},
      );
      if (step === "claim")
        return a.status >= 400 ? back(reply, `orders/${id}`, a) : back(reply, `hold/${id}`);
      return back(reply, "", a);
    },
  );
}
