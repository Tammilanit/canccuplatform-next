/**
 * What the Moments pages share (contracts/moments.md, Pages): the organiser shell with the Screen
 * studio's place in the menu and the pages' own tabs, the sign-in and refusal pages, the static
 * files, and form posts that run through the API itself, so a page action has the API's rights,
 * idempotency and audit and nothing of its own.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KitError, MissingRight, NotSignedIn, eventPageCsp, newNonce } from "@canccu/kit";
import type { EventInfo, Html, Slot } from "@canccu/ui";
import { errorTitle, errorView, html, shellPage } from "@canccu/ui";
import type { AppDeps } from "./http.js";

export const SIGN_IN = "/admin/sign-in";
/** Caddy strips this prefix (handle_path), so the module's own paths start at `/`. */
export const PREFIX = "/moments/";
const STATIC = new URL("../static/", import.meta.url);

export const TABS = [
  ["on-air", "On air"],
  ["priorities", "Priorities"],
  ["scenes", "Scenes"],
  ["history", "History"],
  ["cues", "Cues"],
] as const;

/** A fresh key in every form, so a resent form does nothing twice (E18). */
export const formKey = (): Html =>
  html`<input
    type="hidden"
    name="idempotency_key"
    value="${randomBytes(12).toString("base64url")}"
  />`;

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

export async function page(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AppDeps,
  o: {
    title: string;
    tab?: string;
    body: Slot;
    description?: Slot;
    status?: number;
    plain?: boolean;
  },
): Promise<FastifyReply> {
  const nonce = newNonce();
  const doc = shellPage({
    title: o.title,
    nonce,
    surface: "admin",
    cssHref: `${PREFIX}static/ui.css`,
    head: html`<link rel="stylesheet" href="${PREFIX}static/moments.css" />`,
    event: await eventOf(request, deps),
    session: request.session ?? undefined,
    // Studio → Moments is the Screen studio's Moments tab (mockups 03, 08, 09).
    current: "screen",
    crumb: { href: "/admin/screen/live", label: "Screen studio" },
    plain: o.plain ?? false,
    width: "wide",
    ...(o.description === undefined ? {} : { description: o.description }),
    ...(o.tab === undefined
      ? {}
      : {
          tabs: TABS.map(([path, label]) => ({
            href: PREFIX + path,
            label,
            current: path === o.tab,
          })),
        }),
    body: html`${o.body}
      <script src="${PREFIX}static/moments.js" defer></script>`,
  });
  return reply
    .type("text/html; charset=utf-8")
    .header("content-security-policy", eventPageCsp(nonce, request.hostname, { page: "admin" }))
    .header("cache-control", "no-store")
    .header("x-content-type-options", "nosniff")
    .status(o.status ?? 200)
    .send(doc.toString());
}

/** preHandler: the session first, so a refusal of someone with no role at all says what to do. */
export function pageNeeds(deps: AppDeps, right: string) {
  return async (request: FastifyRequest) => {
    const session = await deps.rights.session(request.headers.cookie);
    request.session = session;
    if (!session.rights.has(right)) throw new MissingRight(`needs right ${right}`);
  };
}

/** Pages answer pages: sign in when signed out, and a refusal in words. */
export function pageErrors(scope: FastifyInstance, deps: AppDeps): void {
  scope.setErrorHandler(async (err: FastifyError, request, reply) => {
    const back = `${PREFIX}${request.url.replace(/^\//, "")}`;
    if (err instanceof NotSignedIn)
      return reply.redirect(`${SIGN_IN}?next=${encodeURIComponent(back)}`, 303);
    const session = request.session;
    if (err instanceof MissingRight && session?.rights.size === 0 && !session.superadmin) {
      return reply.redirect(SIGN_IN, 303);
    }
    const known = err instanceof KitError;
    if (known) deps.log.info({ code: err.code, msg: err.message }, "a Moments page was refused");
    else deps.log.error({ err }, "a Moments page failed");
    const pageErr = known
      ? { status: err.status, code: err.code, message: err.message }
      : { status: 500, code: "internal", message: "" };
    const event = await eventOf(request, deps);
    const view = errorView(pageErr, {
      session: session ?? undefined,
      page: "Moments",
      event: event?.name,
      retry: back,
      back: { href: `${PREFIX}on-air`, label: "Back to On air" },
    });
    return page(request, reply, deps, {
      title: errorTitle(pageErr),
      body: view,
      status: pageErr.status,
      plain: true,
    });
  });
}

const TYPES: Record<string, string> = {
  "ui.css": "text/css; charset=utf-8",
  "moments.css": "text/css; charset=utf-8",
  "moments.js": "text/javascript; charset=utf-8",
};
const files = new Map<string, Promise<Buffer>>();

export function staticRoutes(app: FastifyInstance): void {
  app.get<{ Params: { name: string } }>("/static/:name", async (request, reply) => {
    const name = request.params.name;
    const type = TYPES[name];
    if (type === undefined) throw new KitError(undefined, { status: 404, code: "not_found" });
    let bytes = files.get(name);
    if (bytes === undefined) {
      // ui.css is packages/ui's own, so these pages look like every other organiser page.
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
}

/** A page's form, sent on to the API as the same person on the same event. */
export async function viaApi(
  app: FastifyInstance,
  request: FastifyRequest,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload: Record<string, unknown>,
): Promise<ApiAnswer> {
  const form = (request.body ?? {}) as Record<string, unknown>;
  const key = typeof form.idempotency_key === "string" ? form.idempotency_key : undefined;
  const res = await app.inject({
    method,
    url,
    headers: {
      host: request.headers.host ?? "",
      cookie: request.headers.cookie ?? "",
      ...(method === "GET" ? {} : { "content-type": "application/json" }),
      ...(request.headers["x-forwarded-for"] === undefined
        ? {}
        : { "x-forwarded-for": request.headers["x-forwarded-for"] }),
      ...(key === undefined ? {} : { "idempotency-key": key }),
    },
    ...(method === "GET" ? {} : { payload: JSON.stringify(payload) }),
  });
  const body = res.body === "" ? {} : (JSON.parse(res.body) as Record<string, unknown>);
  return { status: res.statusCode, body };
}

/** The API's refusal in a sentence for the page's notice. */
export const refusal = (a: ApiAnswer): string =>
  ((a.body.error as { message?: string } | undefined)?.message ?? "That did not work.").replace(
    /`/g,
    "",
  );
