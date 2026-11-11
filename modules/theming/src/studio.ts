/**
 * The Studio pages (plan issue-185 D8): the brand kit, advanced mode and history, under
 * `/theming/studio/`, linked from admin's "Event" menu. They only read; every change goes through
 * the JSON API from static/studio.js, so the pages hold no right the API does not check itself.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KitError, NotSignedIn, eventPageCsp, newNonce } from "@canccu/kit";
import { html, page } from "@canccu/ui";
import type { Slot } from "@canccu/ui";
import { EMBEDS, WRITE, pageNeeds, positiveInt } from "./http.js";
import { revisionList } from "./revision-routes.js";
import { draftCssRoutes, htmlHeaders, previewRoutes } from "./studio-preview.js";
import type { StudioDeps } from "./studio-preview.js";
import { advancedView, historyView } from "./studio-advanced.js";
import { STUDIO, brandKitView, studioState } from "./studio-views.js";

const SIGN_IN = "/admin/sign-in";
const HISTORY_PAGE = 20;
const STATIC = new URL("../static/", import.meta.url);

const MENU: [string, string][] = [
  ["", "Brand kit"],
  ["advanced", "Advanced"],
  ["history", "History"],
];

/** A Studio page: ui.css, the menu, the body, the script; an admin page that is never framed. */
function studioPage(
  request: FastifyRequest,
  reply: FastifyReply,
  title: string,
  body: Slot,
  status = 200,
): FastifyReply {
  const nonce = newNonce();
  const menu = MENU.map(([path, label]) => html`<a href="${STUDIO + path}">${label}</a>`);
  const doc = page({
    title,
    surface: "admin",
    nonce,
    cssHref: `${STUDIO}static/ui.css`,
    body: html`<link rel="stylesheet" href="${STUDIO}static/studio.css" />
      <nav class="canccu-studio-menu" aria-label="Theme">${menu}<a href="/admin/">Admin</a></nav>
      <h1>${title}</h1>
      <p class="canccu-studio-notice" role="alert" hidden></p>
      ${body}
      <script src="${STUDIO}static/studio.js" defer></script>`,
  });
  return htmlHeaders(reply, eventPageCsp(nonce, request.hostname, { page: "admin" }))
    .status(status)
    .send(doc.toString());
}

/** The way back after signing in: this page, with its query. */
function signIn(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.redirect(`${SIGN_IN}?next=${encodeURIComponent(request.url)}`, 303);
}

const STATIC_TYPES: Record<string, string> = {
  "ui.css": "text/css; charset=utf-8",
  "studio.css": "text/css; charset=utf-8",
  "preview.css": "text/css; charset=utf-8",
  "studio.js": "text/javascript; charset=utf-8",
};

const staticFiles = new Map<string, Promise<Buffer>>();
function staticFile(name: string): Promise<Buffer> {
  let bytes = staticFiles.get(name);
  if (bytes === undefined) {
    // ui.css is packages/ui's own, so the Studio looks like every other admin page.
    const path =
      name === "ui.css"
        ? createRequire(import.meta.url).resolve("@canccu/ui/ui.css")
        : new URL(name, STATIC);
    // A failed read is forgotten, so the next request tries again instead of failing forever.
    bytes = readFile(path).catch((err: unknown) => {
      staticFiles.delete(name);
      throw err;
    });
    staticFiles.set(name, bytes);
  }
  return bytes;
}

export function studioRoutes(app: FastifyInstance, deps: StudioDeps): void {
  void app.register((studio, _opts, done) => {
    // Pages answer pages: a browser without a session goes to sign in, a refusal is said in words.
    studio.setErrorHandler((err: FastifyError, request, reply) => {
      if (err instanceof NotSignedIn) return signIn(request, reply);
      if (err instanceof KitError) {
        const body = html`<p class="canccu-studio-problem canccu-studio-problem--error">
          ${err.message}
        </p>`;
        return studioPage(request, reply, "Not available", body, err.status);
      }
      deps.log.error({ err }, "a Studio page failed");
      const body = html`<p class="canccu-studio-problem canccu-studio-problem--error">
        Something went wrong. Try again.
      </p>`;
      return studioPage(request, reply, "Not available", body, 500);
    });
    const reader = { preHandler: pageNeeds(deps.rights, WRITE) };
    previewRoutes(studio, deps);

    studio.get(STUDIO, reader, async (request, reply) => {
      const state = await deps.db.tenant((c) => studioState(c, deps.files));
      // The page only offers; the package upload checks the embeds right itself.
      const embedsAllowed = request.session?.rights.has(EMBEDS) ?? false;
      return studioPage(request, reply, "Theme", brandKitView(state, embedsAllowed));
    });

    studio.get(`${STUDIO}advanced`, reader, async (request, reply) => {
      const state = await deps.db.tenant((c) => studioState(c, deps.files, false));
      return studioPage(request, reply, "Theme: advanced", advancedView(state));
    });

    studio.get<{ Querystring: { before?: string } }>(
      `${STUDIO}history`,
      reader,
      async (request, reply) => {
        const before = positiveInt(request.query.before, "before");
        // One row more than shown tells whether older revisions exist: retention keeps exactly a
        // page of them, so a full page alone says nothing.
        const list = await deps.db.tenant((c) => revisionList(c, before, HISTORY_PAGE + 1));
        return studioPage(
          request,
          reply,
          "Theme: history",
          historyView(list, HISTORY_PAGE, before),
        );
      },
    );

    // Static and public, as ui.css is on every module's pages: nothing in them is the event's.
    studio.get<{ Params: { name: string } }>(`${STUDIO}static/:name`, async (request, reply) => {
      // Own keys only: `constructor` and the like must be a 404, not a read of a missing file.
      const name = request.params.name;
      const type = Object.hasOwn(STATIC_TYPES, name) ? STATIC_TYPES[name] : undefined;
      if (type === undefined) throw new KitError("Not found.", { status: 404, code: "not_found" });
      return reply
        .type(type)
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "no-cache")
        .send(await staticFile(name));
    });
    done();
  });
  draftCssRoutes(app, deps);
}
