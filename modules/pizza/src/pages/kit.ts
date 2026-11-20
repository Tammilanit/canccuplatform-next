/**
 * What the Food pages share: the holder's pages in the hub's look (the event's theme), the crew's
 * in the organiser shell, the static files, refusals in words, and form posts that run through the
 * API itself, so a page action has the API's rights, idempotency and audit and nothing of its own
 * (as Moments' pages do).
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KitError, NotSignedIn, eventPageCsp, newNonce } from "@canccu/kit";
import type { Session } from "@canccu/kit";
import { errorTitle, errorView, html, shellPage } from "@canccu/ui";
import type { EventInfo, Html, Slot, Tab } from "@canccu/ui";
import { tenantOf, whoIs } from "../http.js";
import type { AppDeps } from "../http.js";
import { MANAGE, MENU_WRITE } from "../policy.js";
import { translator } from "./messages.js";
import type { Translate } from "./messages.js";

export const SIGN_IN = "/admin/sign-in";
/** Caddy strips this prefix (handle_path), so the module's own paths start at `/`. */
export const PREFIX = "/pizza/";
export const SETTINGS_WRITE = "admin.settings.write";
const STATIC = new URL("../../static/", import.meta.url);

/** A fresh key in every form, so a form sent twice does nothing twice (E2). */
export const formKey = (): Html =>
  html`<input
    type="hidden"
    name="idempotency_key"
    value="${randomBytes(12).toString("base64url")}"
  />`;

/** What a page knows of its caller and event. */
export interface PageCtx {
  t: Translate;
  lang: string;
  zone: string;
  session: Session;
  tenant: string;
}

/** The signed-in caller, the event's language and time zone; signed out goes to sign-in. */
export async function pageCtx(deps: AppDeps, request: FastifyRequest): Promise<PageCtx> {
  const ctx = tenantOf(request);
  const { session } = await whoIs(deps, request);
  if (session === null) throw new NotSignedIn("sign in first");
  const lang = await deps.language(ctx.tenant_id).catch(() => "en");
  return { t: translator(lang), lang, zone: ctx.time_zone, session, tenant: ctx.tenant_id };
}

async function eventOf(request: FastifyRequest, deps: AppDeps): Promise<EventInfo | undefined> {
  const e = await deps.tenants
    .event(request.headers.host, request.headers.cookie)
    .catch(() => null);
  if (!e) return undefined;
  return {
    name: e.name,
    status: e.status,
    timeZone: e.time_zone ?? "UTC",
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    venue: e.venue?.name,
  };
}

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  doc: Html,
  o: { status: number; page: "admin" | "surface"; nonce: string },
): FastifyReply {
  return reply
    .type("text/html; charset=utf-8")
    .header("content-security-policy", eventPageCsp(o.nonce, request.hostname, { page: o.page }))
    .header("cache-control", "no-store")
    .header("x-content-type-options", "nosniff")
    .status(o.status)
    .send(doc.toString());
}

/**
 * The holder's page: the hub's look, which takes the event's theme (theming's tokens.css for the
 * `hub` surface), phone first, with the way back at its top.
 */
export function hubPage(
  request: FastifyRequest,
  reply: FastifyReply,
  c: PageCtx,
  o: { title: string; back?: { href: string; label: string }; body: Slot; status?: number },
): FastifyReply {
  const nonce = newNonce();
  const back =
    o.back === undefined
      ? ""
      : html`<a class="pizza-back" href="${o.back.href}">‹ ${o.back.label}</a>`;
  const doc = html`<!doctype html>
    <html lang="${c.lang}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${o.title}</title>
        <link rel="stylesheet" href="${PREFIX}static/ui.css" />
        <link rel="stylesheet" href="/theming/current/tokens.css" />
        <link rel="stylesheet" href="${PREFIX}static/pizza.css" />
      </head>
      <body class="canccu-page canccu-surface canccu-surface--hub pizza-hub">
        <header class="pizza-hub__head">
          ${back}
          <h1 class="pizza-hub__title">${o.title}</h1>
        </header>
        <main class="pizza-hub__main">${o.body}</main>
        <script src="${PREFIX}static/pizza.js" defer></script>
      </body>
    </html> `;
  return send(request, reply, doc, { status: o.status ?? 200, page: "surface", nonce });
}

/** The Food section's tabs, those the caller may open. */
export function foodTabs(c: PageCtx, current: "orders" | "pizzerias" | "settings"): Tab[] {
  const r = c.session.rights;
  const all: [string, string, string, boolean][] = [
    ["orders", `${PREFIX}crew`, c.t("tab.orders"), r.has(MANAGE)],
    ["pizzerias", `${PREFIX}crew/pizzerias`, c.t("tab.pizzerias"), r.has(MENU_WRITE)],
    ["settings", `${PREFIX}crew/settings`, c.t("tab.settings"), r.has(SETTINGS_WRITE)],
  ];
  return all
    .filter(([, , , may]) => may)
    .map(([id, href, label]) => ({ href, label, current: id === current }));
}

/** An organiser page in the shell: Run the event → Food. */
export async function organiserPage(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AppDeps,
  c: PageCtx,
  o: {
    title: string;
    tab?: "orders" | "pizzerias" | "settings";
    body: Slot;
    crumb?: { href: string; label: string };
    actions?: Slot;
    wide?: boolean;
    narrow?: boolean;
    status?: number;
  },
): Promise<FastifyReply> {
  const nonce = newNonce();
  const doc = shellPage({
    title: o.title,
    nonce,
    surface: "admin",
    cssHref: `${PREFIX}static/ui.css`,
    head: html`<link rel="stylesheet" href="${PREFIX}static/pizza.css" />`,
    event: await eventOf(request, deps),
    session: { userName: c.session.userName, rights: c.session.rights },
    current: "food",
    ...(o.crumb === undefined ? {} : { crumb: o.crumb }),
    ...(o.actions === undefined ? {} : { actions: o.actions }),
    ...(o.wide === true ? { width: "wide" as const } : {}),
    ...(o.narrow === true ? { width: "narrow" as const } : {}),
    ...(o.tab === undefined ? {} : { tabs: foodTabs(c, o.tab) }),
    body: html`<div lang="${c.lang}">${o.body}</div>
      <script src="${PREFIX}static/pizza.js" defer></script>`,
  });
  return send(request, reply, doc, { status: o.status ?? 200, page: "admin", nonce });
}

/** Pages answer pages: sign in when signed out, and a refusal in words. */
export function pageErrors(scope: FastifyInstance, deps: AppDeps): void {
  scope.setErrorHandler(async (err: FastifyError, request, reply) => {
    const back = `${PREFIX}${request.url.replace(/^\//, "")}`;
    if (err instanceof NotSignedIn)
      return reply.redirect(`${SIGN_IN}?next=${encodeURIComponent(back)}`, 303);
    const known = err instanceof KitError;
    if (known) deps.log.info({ code: err.code, msg: err.message }, "a Food page was refused");
    else deps.log.error({ err }, "a Food page failed");
    const pageErr = known
      ? { status: err.status, code: err.code, message: err.message }
      : { status: 500, code: "internal", message: "" };
    const { session } = await whoIs(deps, request).catch(() => ({ session: null }));
    const nonce = newNonce();
    const doc = shellPage({
      title: errorTitle(pageErr),
      nonce,
      cssHref: `${PREFIX}static/ui.css`,
      event: await eventOf(request, deps),
      ...(session === null
        ? {}
        : { session: { userName: session.userName, rights: session.rights } }),
      plain: true,
      body: errorView(pageErr, {
        ...(session === null
          ? {}
          : { session: { userName: session.userName, rights: session.rights } }),
        page: "Food",
        ...(request.method === "GET" ? { retry: back } : {}),
        back: { href: `${PREFIX}crew`, label: "Back to Food" },
      }),
    });
    return send(request, reply, doc, { status: pageErr.status, page: "admin", nonce });
  });
}

const TYPES: Record<string, string> = {
  "ui.css": "text/css; charset=utf-8",
  "pizza.css": "text/css; charset=utf-8",
  "pizza.js": "text/javascript; charset=utf-8",
};
const files = new Map<string, Promise<Buffer>>();

export function staticRoutes(app: FastifyInstance): void {
  app.get<{ Params: { name: string } }>("/static/:name", async (request, reply) => {
    const name = request.params.name;
    const type = TYPES[name];
    if (type === undefined) throw new KitError(undefined, { status: 404, code: "not_found" });
    let bytes = files.get(name);
    if (bytes === undefined) {
      // ui.css is packages/ui's own, so these pages look like every other platform page.
      const path =
        name === "ui.css"
          ? createRequire(import.meta.url).resolve("@canccu/ui/ui.css")
          : new URL(name, STATIC);
      bytes = readFile(path).catch((err: unknown) => {
        files.delete(name);
        throw err;
      });
      files.set(name, bytes);
    }
    return reply
      .type(type)
      .header("cache-control", "no-cache")
      .send(await bytes);
  });
}

export interface ApiAnswer {
  status: number;
  body: Record<string, unknown>;
  text: string;
}

/** A page's action, sent on to the API as the same person on the same event. */
export async function viaApi(
  app: FastifyInstance,
  request: FastifyRequest,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: Record<string, unknown> | string,
  /** One form that takes several API steps gives each its own key: the form's and a suffix. */
  part?: number,
): Promise<ApiAnswer> {
  const form = (request.body ?? {}) as Record<string, unknown>;
  const key =
    typeof form.idempotency_key === "string"
      ? `${form.idempotency_key}${part === undefined ? "" : `-${part}`}`
      : undefined;
  const csv = typeof payload === "string";
  const res = await app.inject({
    method,
    url,
    headers: {
      host: request.headers.host ?? "",
      cookie: request.headers.cookie ?? "",
      ...(payload === undefined ? {} : { "content-type": csv ? "text/csv" : "application/json" }),
      ...(request.headers["x-forwarded-for"] === undefined
        ? {}
        : { "x-forwarded-for": request.headers["x-forwarded-for"] }),
      ...(key === undefined || method === "GET" ? {} : { "idempotency-key": key }),
    },
    ...(payload === undefined ? {} : { payload: csv ? payload : JSON.stringify(payload) }),
  });
  let body: Record<string, unknown> = {};
  if (res.headers["content-type"]?.toString().startsWith("application/json") === true)
    body = JSON.parse(res.body) as Record<string, unknown>;
  return { status: res.statusCode, body, text: res.body };
}

/** The API's answer, or the error a page shows in words. */
export function must(a: ApiAnswer): Record<string, unknown> {
  if (a.status < 400) return a.body;
  const e = (a.body.error ?? {}) as { code?: string; message?: string };
  throw new KitError(e.message ?? "That did not work.", {
    status: a.status,
    code: e.code ?? "failed",
  });
}

/** The API's refusal in a sentence for the page's notice. */
export const refusal = (a: ApiAnswer): string =>
  ((a.body.error as { message?: string } | undefined)?.message ?? "That did not work.").replace(
    /`/g,
    "",
  );

/** Back to a page after a form, with a notice for it to show (`?done=` or `?error=`). */
export function back(reply: FastifyReply, path: string, a?: ApiAnswer): FastifyReply {
  const sep = path.includes("?") ? "&" : "?";
  const tail =
    a === undefined || a.status < 400 ? "" : `${sep}error=${encodeURIComponent(refusal(a))}`;
  return reply.redirect(`${PREFIX}${path}${tail}`, 303);
}

/** A form's text field, or null. */
export function formText(request: FastifyRequest, name: string): string | null {
  const v = ((request.body ?? {}) as Record<string, unknown>)[name];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
