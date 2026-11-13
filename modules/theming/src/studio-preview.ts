/**
 * The Studio's preview (plan issue-185 D9): sample surface pages that render the draft with
 * `?canccu_theme=draft` (else the current theme), the draft's CSS they link, and the demo themes as
 * starting points (D7). The hub does not exist yet; its sample needs only the stable classes, which
 * every later surface keeps (contracts/theming.md). The screen sample is only the fallback of the
 * brand kit's screen preview, which is screen's real player (studio-kit.ts).
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eventPageCsp, newNonce, requireTenant } from "@canccu/kit";
import type { Logger, RightsChecker, SqlClient, TenantResolver } from "@canccu/kit";
import { html, page, shellPage } from "@canccu/ui";
import type { EventInfo, Html, Surface } from "@canccu/ui";
import { isObject, list } from "./checks.js";
import { compiledCss } from "./compile.js";
import { StyleError } from "./css.js";
import { loadDraft } from "./drafts.js";
import type { Db } from "./db.js";
import type { FileStore } from "./files.js";
import { zipOf } from "./package-routes.js";
import type { ProfileSource } from "./profile.js";
import { WRITE, needs, noDraft, notFound, pageNeeds } from "./http.js";
import { resolvedRevision, revisionZero } from "./theme.js";
import { adminTokens, fillTokens, tokensCss } from "./tokens.js";
import { STARTERS, STUDIO, draftFileUrl } from "./studio-views.js";

const THEMES = fileURLToPath(new URL("../../../events/demo/themes/", import.meta.url));

export interface StudioDeps {
  db: Db;
  files: FileStore;
  rights: RightsChecker;
  profile: ProfileSource;
  log: Logger;
  /** Names the event in the shell's header. */
  tenants?: Pick<TenantResolver, "event">;
}

/** The shell's view of the event, from the tenants module's public answer. */
export async function eventOf(
  request: FastifyRequest,
  tenants: StudioDeps["tenants"],
): Promise<EventInfo | undefined> {
  const e = await tenants?.event(request.headers.host);
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

/** Security headers every Studio HTML response carries, the policy given. */
export function htmlHeaders(reply: FastifyReply, csp: string): FastifyReply {
  return reply
    .type("text/html; charset=utf-8")
    .header("content-security-policy", csp)
    .header("cache-control", "no-store")
    .header("x-content-type-options", "nosniff");
}

/** What one preview links: the token CSS, the event CSS, the logo and the Discord colour. */
interface Look {
  tokens: string;
  /** The organiser pages' tokens: the platform colours where the theme fails the contrast rules. */
  adminTokens: string;
  css: string | undefined;
  logo: string | undefined;
  embedColor: string;
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

async function draftLook(c: SqlClient): Promise<Look | undefined> {
  const draft = await loadDraft(c);
  if (draft === undefined) return undefined;
  const v = `?v=${draft.draft_version}`;
  const m = draft.manifest;
  const brand = isObject(m.brand) ? m.brand : {};
  const primary = fillTokens(m.tokens ?? {}).colors.primary ?? "#000000";
  const images = isObject(m.images) ? m.images : {};
  return {
    tokens: `${STUDIO}draft/tokens.css${v}`,
    adminTokens: `${STUDIO}draft/admin-tokens.css${v}`,
    css: list(m.css).length > 0 ? `${STUDIO}draft/theme.css${v}` : undefined,
    logo: await draftFileUrl(c, images.logo),
    // As publish sets it: the brand's own, else the primary, alpha dropped.
    embedColor: (typeof brand.embed_color === "string" ? brand.embed_color : primary).slice(0, 7),
  };
}

async function currentLook(c: SqlClient, deps: StudioDeps): Promise<Look> {
  const theme =
    (await resolvedRevision(c)) ?? revisionZero(await deps.profile(requireTenant())).theme;
  return {
    tokens: theme.tokens_css_url,
    adminTokens: theme.admin_tokens_css_url,
    css: theme.css_url,
    logo: theme.logo_url,
    embedColor: hex(theme.embed_color),
  };
}

const stylesheet = (href: string | undefined): Html | string =>
  href === undefined ? "" : html`<link rel="stylesheet" href="${href}" />`;

const widget = (type: string, title: string, body: Html | string, footer = ""): Html =>
  html`<article class="canccu-widget canccu-widget--${type}">
    <h2 class="canccu-widget__title">${title}</h2>
    <div class="canccu-widget__body">${body}</div>
    ${footer === "" ? "" : html`<footer class="canccu-widget__footer">${footer}</footer>`}
  </article>`;

const region = (id: string, content: Html): Html =>
  html`<section class="canccu-region canccu-region--${id}">${content}</section>`;

/** The sample content of each surface, in stable classes only. */
const SAMPLES: Record<string, { title: string; surface: Surface; body: () => Html }> = {
  screen: {
    title: "Demo Event",
    surface: "screen",
    body: () =>
      html`<div class="canccu-layout canccu-layout--preview">
        ${region(
          "hero",
          widget(
            "agenda",
            "Now",
            html`<p class="canccu-is-active">Dinner</p>
              <p>+15 min</p>`,
            "Next: Demo Game Cup, 21:00 · Stage",
          ),
        )}${region("side", widget("clock", "Time", html`<p>18:42</p>`))}${region(
          "ticker",
          widget("ticker", "Info", html`<p>Pizza orders close at 20:00</p>`),
        )}
      </div>`,
  },
  hub: {
    title: "Demo Event",
    surface: "hub",
    body: () =>
      html`<section class="canccu-card">
          <p class="canccu-overline">Now</p>
          <h2 class="canccu-card__title">
            Dinner <span class="canccu-badge canccu-badge--late">+15 min</span>
          </h2>
          <p>Café · until 19:15</p>
        </section>
        <button class="canccu-button canccu-button--primary canccu-button--block" type="button">
          Turn on alerts
        </button>`,
  },
};

/** A whole embed as the bot posts it: Discord's own look, the event's bar colour and logo. */
function discordCard(look: Look, event: string): Html {
  const logo =
    look.logo === undefined
      ? ""
      : html`<img class="canccu-preview-discord__logo" src="${look.logo}" alt="" />`;
  // An SVG bar, not a style attribute: the page policy allows no inline styles.
  return html`<div class="canccu-preview-discord">
    <div class="canccu-preview-discord__embed">
      <svg
        class="canccu-preview-discord__bar"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect width="1" height="1" fill="${look.embedColor}" />
      </svg>
      <div class="canccu-preview-discord__body">
        <p class="canccu-preview-discord__author">${logo}${event}</p>
        <p class="canccu-preview-discord__title">Dinner is 15 min late</p>
        <p>Now until 19:15 in the café. The semi-finals start at 19:45.</p>
      </div>
    </div>
  </div>`;
}

/**
 * The organiser pages as they are: the shell with the event's admin tokens, which every organiser
 * page links (UX audit C3: the preview shows what is). After the current tokens the shell links,
 * so the draft's win.
 */
function organiserPage(nonce: string, event: EventInfo | undefined, look: Look): Html {
  return shellPage({
    title: "Run of show",
    nonce,
    surface: "admin",
    cssHref: `${STUDIO}static/ui.css`,
    head: html`<link rel="stylesheet" href="${STUDIO}static/preview.css" />${stylesheet(
        look.adminTokens,
      )}`,
    event,
    tabs: [
      { href: "#", label: "Day", current: true },
      { href: "#", label: "Templates" },
    ],
    body: html`<section class="canccu-card">
      <h2 class="canccu-card__title">Dinner</h2>
      <p class="canccu-muted">Café · until 19:15</p>
      <p class="canccu-cluster">
        <button class="canccu-button canccu-button--primary" type="button">Save</button>
        <button class="canccu-button canccu-button--ghost" type="button">Undo</button>
        <a href="#">A link</a>
      </p>
      <p class="canccu-cluster">
        <span class="canccu-badge canccu-badge--ok">Running</span>
        <span class="canccu-badge canccu-badge--degraded">Slow</span>
        <span class="canccu-badge canccu-badge--down">Down</span>
      </p>
    </section>`,
  });
}

function previewPage(
  request: FastifyRequest,
  reply: FastifyReply,
  surface: string,
  look: Look,
  event: EventInfo | undefined,
): FastifyReply {
  const nonce = newNonce();
  const base = `${STUDIO}static/preview.css`;
  let doc: Html;
  if (surface === "admin") {
    doc = organiserPage(nonce, event, look);
  } else if (surface === "discord") {
    doc = page({
      title: "Discord",
      nonce,
      cssHref: `${STUDIO}static/ui.css`,
      body: html`${stylesheet(base)}${discordCard(look, event?.name ?? "Event")}`,
    });
  } else {
    // Own keys only: `toString` and the like are no surface.
    const sample = Object.hasOwn(SAMPLES, surface) ? SAMPLES[surface] : undefined;
    if (sample === undefined) throw notFound();
    doc = page({
      title: event?.name ?? sample.title,
      surface: sample.surface,
      nonce,
      cssHref: `${STUDIO}static/ui.css`,
      ...(look.logo === undefined ? {} : { logoUrl: look.logo }),
      body: html`${[base, look.tokens, look.css].map(stylesheet)}${sample.body()}`,
    });
  }
  return htmlHeaders(reply, eventPageCsp(nonce, request.hostname, { page: "surface" })).send(
    doc.toString(),
  );
}

/** The preview surfaces, in the Studio pages' scope (their errors are pages). */
export function previewRoutes(app: FastifyInstance, deps: StudioDeps): void {
  app.get<{ Params: { surface: string }; Querystring: { canccu_theme?: string } }>(
    `${STUDIO}preview/:surface`,
    { preHandler: pageNeeds(deps.rights, WRITE) },
    async (request, reply) => {
      const look = await deps.db.tenant(
        async (c) =>
          (request.query.canccu_theme === "draft" ? await draftLook(c) : undefined) ??
          currentLook(c, deps),
      );
      const event = await eventOf(request, deps.tenants);
      return previewPage(request, reply, request.params.surface, look, event);
    },
  );
}

async function starterZip(name: string): Promise<Buffer> {
  const root = join(THEMES, name);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const paths = entries
    .filter((e) => e.isFile())
    .map((e) => relative(root, join(e.parentPath, e.name)))
    .sort();
  return zipOf(
    await Promise.all(
      paths.map(async (p) => [p, await readFile(join(root, p))] as [string, Buffer]),
    ),
  );
}

/** The draft's CSS and the starting points: machine reads, so their errors stay JSON. */
export function draftCssRoutes(app: FastifyInstance, deps: StudioDeps): void {
  const writer = { preHandler: needs(deps.rights, WRITE) };
  const css = (reply: FastifyReply, text: string): FastifyReply =>
    reply
      .type("text/css; charset=utf-8")
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header("cross-origin-resource-policy", "same-origin")
      .send(text);

  app.get<{ Params: { name: string } }>(`${STUDIO}draft/:name`, writer, async (request, reply) => {
    const { name } = request.params;
    if (!["tokens.css", "admin-tokens.css", "theme.css"].includes(name)) throw notFound();
    const text = await deps.db.tenant(async (c) => {
      const draft = await loadDraft(c);
      if (draft === undefined) throw noDraft();
      const tokens = fillTokens(draft.manifest.tokens ?? {});
      if (name === "tokens.css") return tokensCss(tokens);
      if (name === "admin-tokens.css") return tokensCss(adminTokens(tokens));
      try {
        const compiled = await compiledCss(
          c,
          deps.files,
          "draft",
          draft.manifest,
          "/theming/draft/",
        );
        return compiled?.toString("utf8") ?? "";
      } catch (err) {
        // The draft's problems already name it; the preview shows the rest without it.
        if (err instanceof StyleError) return "";
        throw err;
      }
    });
    return css(reply, text);
  });

  app.get<{ Params: { name: string } }>(
    `${STUDIO}starters/:name`,
    writer,
    async (request, reply) => {
      const name = STARTERS.find((s) => `${s}.zip` === request.params.name);
      if (name === undefined) throw notFound();
      return reply
        .type("application/zip")
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff")
        .send(await starterZip(name));
    },
  );
}
