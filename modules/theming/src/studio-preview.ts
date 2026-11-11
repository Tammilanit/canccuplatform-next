/**
 * The Studio's preview (plan issue-185 D9): sample surface pages that render the draft with
 * `?canccu_theme=draft` (else the current theme), the draft's CSS they link, and the demo themes as
 * starting points (D7). The screen player and the hub do not exist yet; the preview needs only the
 * stable classes, which every later surface keeps (contracts/theming.md).
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eventPageCsp, newNonce, requireTenant } from "@canccu/kit";
import type { Logger, RightsChecker, SqlClient } from "@canccu/kit";
import { html, page } from "@canccu/ui";
import type { Html, Surface } from "@canccu/ui";
import { isObject, list } from "./checks.js";
import { compiledCss } from "./compile.js";
import { StyleError } from "./css.js";
import { loadDraft } from "./drafts.js";
import type { Db } from "./db.js";
import type { FileStore } from "./files.js";
import { zipOf } from "./package-routes.js";
import type { ProfileSource } from "./profile.js";
import { WRITE, needs, noDraft, notFound } from "./http.js";
import { resolvedRevision, revisionZero } from "./theme.js";
import { adminTokens, fillTokens, tokensCss } from "./tokens.js";
import { STARTERS, draftFileUrl } from "./studio-views.js";

const STUDIO = "/theming/studio/";
const THEMES = new URL("../../../events/demo/themes/", import.meta.url).pathname;

export interface StudioDeps {
  db: Db;
  files: FileStore;
  rights: RightsChecker;
  profile: ProfileSource;
  log: Logger;
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
          <h2 class="canccu-card__title">Now</h2>
          <p>Dinner, 15 minutes late</p>
          <p><span class="canccu-badge canccu-badge--ok">ok</span></p>
        </section>
        <p>
          <button class="canccu-button canccu-button--primary" type="button">Turn on alerts</button>
          <button class="canccu-button canccu-button--secondary" type="button">Agenda</button>
        </p>`,
  },
  admin: {
    title: "Demo Event · admin",
    surface: "admin",
    body: () =>
      html`<section class="canccu-card">
        <h2 class="canccu-card__title">Settings</h2>
        <div class="canccu-field">
          <label class="canccu-field__label" for="p-name">Event name</label
          ><input class="canccu-input" id="p-name" value="Demo Event" />
          <p class="canccu-field__hint">Shown on every page.</p>
        </div>
        <p>
          <button class="canccu-button canccu-button--primary" type="button">Save</button>
          <button class="canccu-button canccu-button--danger" type="button">Delete</button>
          <span class="canccu-badge canccu-badge--degraded">degraded</span>
        </p>
      </section>`,
  },
};

function discordCard(look: Look): Html {
  const logo =
    look.logo === undefined
      ? ""
      : html`<img class="canccu-preview-discord__logo" src="${look.logo}" alt="" />`;
  // An SVG bar, not a style attribute: the page policy allows no inline styles.
  return html`<div class="canccu-preview-discord">
    <svg
      class="canccu-preview-discord__bar"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect width="1" height="1" fill="${look.embedColor}" />
    </svg>
    <div class="canccu-preview-discord__body">
      ${logo}
      <p class="canccu-preview-discord__title">Dinner is 15 min late</p>
      <p>Pizza orders close at 20:00.</p>
    </div>
  </div>`;
}

function previewPage(
  request: FastifyRequest,
  reply: FastifyReply,
  surface: string,
  look: Look,
): FastifyReply {
  const nonce = newNonce();
  const base = [`${STUDIO}static/preview.css`];
  let body: Html;
  let title: string;
  let kind: Surface = "admin";
  let links: (string | undefined)[];
  if (surface === "discord") {
    title = "Discord";
    body = discordCard(look);
    links = base;
  } else {
    const sample = SAMPLES[surface];
    if (sample === undefined) throw notFound();
    title = sample.title;
    kind = sample.surface;
    body = sample.body();
    // Admin pages take the tokens only, never event CSS (contracts/theming.md, What applies where).
    links = kind === "admin" ? [...base, look.adminTokens] : [...base, look.tokens, look.css];
  }
  const doc = page({
    title,
    surface: kind,
    nonce,
    cssHref: `${STUDIO}static/ui.css`,
    ...(surface === "discord" || look.logo === undefined ? {} : { logoUrl: look.logo }),
    body: html`${links.map(stylesheet)}${body}`,
  });
  return htmlHeaders(reply, eventPageCsp(nonce, request.hostname, { page: "surface" })).send(
    doc.toString(),
  );
}

/** The preview surfaces, in the Studio pages' scope (their errors are pages). */
export function previewRoutes(app: FastifyInstance, deps: StudioDeps): void {
  app.get<{ Params: { surface: string }; Querystring: { canccu_theme?: string } }>(
    `${STUDIO}preview/:surface`,
    { preHandler: needs(deps.rights, WRITE) },
    async (request, reply) => {
      const look = await deps.db.tenant(
        async (c) =>
          (request.query.canccu_theme === "draft" ? await draftLook(c) : undefined) ??
          currentLook(c, deps),
      );
      return previewPage(request, reply, request.params.surface, look);
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
