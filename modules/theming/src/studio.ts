/**
 * The Studio pages (plan issue-185 D8, issue-784 D1): Pick a look, Make it yours, Advanced and
 * History, under `/theming/studio/`, linked from admin's "Event" menu. They only read; every change goes through
 * the JSON API from static/studio.js, so the pages hold no right the API does not check itself.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { KitError, MissingRight, NotSignedIn, eventPageCsp, newNonce } from "@canccu/kit";
import { attrs, cssVar, errorView, errorTitle, html, shellPage } from "@canccu/ui";
import { fillTokens } from "./tokens.js";
import type { Slot } from "@canccu/ui";
import { EMBEDS, WRITE, pageNeeds, positiveInt } from "./http.js";
import { revisionList } from "./revision-routes.js";
import { draftCssRoutes, eventOf, htmlHeaders, previewRoutes } from "./studio-preview.js";
import type { StudioDeps } from "./studio-preview.js";
import { advancedView, historyView } from "./studio-advanced.js";
import { depthFrame, discardView, previewColumn } from "./studio-column.js";
import { galleryView, presetOf } from "./studio-gallery.js";
import { yoursView } from "./studio-yours.js";
import { logoInfo } from "./logo-info.js";
import { STUDIO, studioState } from "./studio-views.js";
import type { StudioState } from "./studio-views.js";
import { FONT_PAIRS, pairFontFaces } from "./font-pairs.js";
import type { Html } from "@canccu/ui";

const SIGN_IN = "/admin/sign-in";
const HISTORY_PAGE = 20;
const STATIC = new URL("../static/", import.meta.url);

const TABS: [string, string][] = [
  ["", "Pick a look"],
  ["yours", "Make it yours"],
  ["advanced", "Advanced"],
  ["history", "History"],
];

/** A Studio page in the organiser shell, with its own tabs and script; never framed. */
async function studioPage(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: StudioDeps,
  o: {
    title: string;
    tab?: string;
    body: Slot;
    description?: Slot;
    actions?: Slot;
    status?: number;
    plain?: boolean;
  },
): Promise<FastifyReply> {
  const nonce = newNonce();
  const doc = shellPage({
    title: o.title,
    nonce,
    surface: "admin",
    cssHref: `${STUDIO}static/ui.css`,
    head: html`<link rel="stylesheet" href="${STUDIO}static/studio.css" />
      <link rel="stylesheet" href="${STUDIO}static/studio-previews.css" />
      <link rel="stylesheet" href="${STUDIO}static/studio-depths.css" />
      <link rel="stylesheet" href="${STUDIO}static/pairs.css" />`,
    event: await eventOf(request, deps.tenants),
    session: request.session ?? undefined,
    current: "theme",
    plain: o.plain ?? false,
    ...(o.description === undefined ? {} : { description: o.description }),
    ...(o.actions === undefined ? {} : { actions: o.actions }),
    ...(o.tab === undefined
      ? {}
      : {
          tabs: TABS.map(([path, label]) => ({
            href: STUDIO + path,
            label,
            current: path === o.tab,
          })),
        }),
    body: html`<p class="canccu-studio-notice" role="alert" hidden></p>
      ${o.body}
      <script src="${STUDIO}static/studio.js" defer></script>
      <script src="${STUDIO}static/studio-form.js" defer></script>
      <script src="${STUDIO}static/studio-live.js" defer></script>
      <script src="${STUDIO}static/studio-previews.js" defer></script>
      <script src="${STUDIO}static/studio-screen.js" defer></script>`,
  });
  return htmlHeaders(reply, eventPageCsp(nonce, request.hostname, { page: "admin" }))
    .status(o.status ?? 200)
    .send(doc.toString());
}

/**
 * A depth's page: its controls beside the live preview column (D2), in the root every page script
 * reads the draft's version and save state from.
 */
function depthBody(state: StudioState, controls: Html, extra: Html): Html {
  const from = presetOf(state);
  const m = state.draft?.manifest;
  // Work of the organiser's own that applying a preset would drop, so the page asks first (D11).
  const own =
    m !== undefined &&
    from === undefined &&
    ["css", "fonts", "templates", "embeds"].some((k) => m[k] !== undefined);
  // The colours as saved, which the live preview posts after each save (static/studio-live.js).
  const vars =
    m === undefined
      ? undefined
      : JSON.stringify(
          Object.fromEntries(
            Object.entries(fillTokens(m.tokens ?? {}).colors).map(([k, v]) => [
              cssVar("color", k),
              v,
            ]),
          ),
        );
  return html`<div${attrs({ class: "canccu-studio", "data-draft-version": state.draft?.draft_version, "data-save-state": "saved", "data-own-work": own ? "1" : undefined, "data-vars": vars })}>
    ${extra}
    <div class="canccu-studio-depth">${controls}${previewColumn(state)}</div>
    ${state.draft === undefined ? "" : discardView(state)}${replaceDialog}
  </div>`;
}

const replaceDialog = html`<dialog
  class="canccu-studio-dialog"
  id="canccu-studio-replace"
  aria-labelledby="canccu-studio-replace-title"
>
  <h2 id="canccu-studio-replace-title" class="canccu-card__title">Use this look instead?</h2>
  <p>
    Your draft has its own CSS, fonts, templates or embeds. The look you picked replaces them; your
    logo and its plate stay. Export the draft first to keep a copy.
  </p>
  <div class="canccu-studio-row canccu-studio-dialog__actions">
    <button type="button" class="canccu-button canccu-button--secondary" data-action="dialog-close">
      Keep my draft
    </button>
    <button type="button" class="canccu-button canccu-button--primary" data-action="replace">
      Use the look
    </button>
  </div>
</dialog>`;

/** The way back after signing in: this page, with its query. */
function signIn(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.redirect(`${SIGN_IN}?next=${encodeURIComponent(request.url)}`, 303);
}

const STATIC_TYPES: Record<string, string> = {
  "ui.css": "text/css; charset=utf-8",
  "studio.css": "text/css; charset=utf-8",
  "studio-previews.css": "text/css; charset=utf-8",
  "studio-depths.css": "text/css; charset=utf-8",
  "preview.css": "text/css; charset=utf-8",
  "studio.js": "text/javascript; charset=utf-8",
  "studio-previews.js": "text/javascript; charset=utf-8",
  "studio-screen.js": "text/javascript; charset=utf-8",
  "studio-live.js": "text/javascript; charset=utf-8",
  "studio-form.js": "text/javascript; charset=utf-8",
  "preview-live.js": "text/javascript; charset=utf-8",
  "pairs.css": "text/css; charset=utf-8",
};

/**
 * The font pairs' faces and a class per pair that draws its name in its heading font (pack sheet
 * 2): the page policy allows no style attribute, and the gallery's "Aa" uses the same faces.
 */
const PAIRS_CSS = Buffer.from(
  [...FONT_PAIRS.values()]
    .flatMap((pair) => [
      ...pairFontFaces(pair),
      `.canccu-studio-font--${pair.id} .canccu-studio-pair__name { font-family: "${pair.heading.family}", system-ui, sans-serif; }`,
    ])
    .join("\n"),
);

const staticFiles = new Map<string, Promise<Buffer>>();
function staticFile(name: string): Promise<Buffer> {
  if (name === "pairs.css") return Promise.resolve(PAIRS_CSS);
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
    studio.setErrorHandler(async (err: FastifyError, request, reply) => {
      if (err instanceof NotSignedIn) return signIn(request, reply);
      const session = request.session;
      if (err instanceof MissingRight && session?.rights.size === 0 && !session.superadmin) {
        return reply.redirect(SIGN_IN, 303); // admin's "No role yet" says what to do (sheet 3)
      }
      // Right ids and the module's words for a refused page go to the log, not the page (B3).
      const known = err instanceof KitError;
      if (known) deps.log.info({ code: err.code, msg: err.message }, "a Studio page was refused");
      else deps.log.error({ err }, "a Studio page failed");
      const pageErr = known
        ? { status: err.status, code: err.code, message: err.message }
        : { status: 500, code: "internal", message: "" };
      const event = await eventOf(request, deps.tenants);
      const view = errorView(pageErr, {
        session: request.session ?? undefined,
        page: "the Theme studio",
        event: event?.name,
        retry: request.url,
        back: { href: STUDIO, label: "Back to the Theme studio" },
      });
      return studioPage(request, reply, deps, {
        title: errorTitle(pageErr),
        body: view,
        status: pageErr.status,
        plain: true,
      });
    });
    const reader = { preHandler: pageNeeds(deps.rights, WRITE) };
    previewRoutes(studio, deps);

    const toGallery = (reply: FastifyReply): FastifyReply => reply.redirect(STUDIO, 303);

    studio.get(STUDIO, reader, async (request, reply) => {
      const state = await deps.db.tenant((c) => studioState(c, deps.files));
      // The page only offers; applying a preset checks the embeds right itself.
      const embedsAllowed = request.session?.rights.has(EMBEDS) ?? false;
      const frame = depthFrame(state, request.session?.userId);
      return studioPage(request, reply, deps, {
        title: "Theme studio",
        tab: "",
        description: frame.description,
        actions: frame.actions,
        body: depthBody(state, galleryView(state, embedsAllowed), frame.extra),
      });
    });

    studio.get(`${STUDIO}yours`, reader, async (request, reply) => {
      const page = await deps.db.tenant(async (c) => {
        const state = await studioState(c, deps.files);
        if (state.draft === undefined) return undefined;
        return { state, draft: state.draft, info: await logoInfo(c, deps.files, state.draft) };
      });
      if (page === undefined) return toGallery(reply);
      const frame = depthFrame(page.state, request.session?.userId);
      return studioPage(request, reply, deps, {
        title: "Theme studio",
        tab: "yours",
        description: frame.description,
        actions: frame.actions,
        body: depthBody(page.state, yoursView(page.state, page.draft, page.info), frame.extra),
      });
    });

    studio.get(`${STUDIO}advanced`, reader, async (request, reply) => {
      const state = await deps.db.tenant((c) => studioState(c, deps.files, false));
      if (state.draft === undefined) return toGallery(reply);
      const frame = depthFrame(state, request.session?.userId);
      return studioPage(request, reply, deps, {
        title: "Theme studio",
        tab: "advanced",
        description: frame.description,
        actions: frame.actions,
        body: advancedView(state),
      });
    });

    studio.get<{ Querystring: { before?: string } }>(
      `${STUDIO}history`,
      reader,
      async (request, reply) => {
        const before = positiveInt(request.query.before, "before");
        // One row more than shown tells whether older revisions exist: retention keeps exactly a
        // page of them, so a full page alone says nothing.
        const list = await deps.db.tenant((c) => revisionList(c, before, HISTORY_PAGE + 1));
        return studioPage(request, reply, deps, {
          title: "Theme studio",
          tab: "history",
          body: historyView(list, HISTORY_PAGE, before),
        });
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
