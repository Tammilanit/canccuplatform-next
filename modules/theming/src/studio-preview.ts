/**
 * The Studio's preview (plan issue-185 D9): sample surface pages that render the draft with
 * `?canccu_theme=draft` (else the current theme), the draft's CSS they link, and the demo themes as
 * starting points (D7). The hub does not exist yet; its sample needs only the stable classes, which
 * every later surface keeps (contracts/theming.md). The screen sample is only the fallback of the
 * preview column's screen, which is screen's real player (studio-column.ts).
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eventPageCsp, newNonce, requireTenant } from "@canccu/kit";
import type { Logger, RightsChecker, SqlClient, TenantResolver } from "@canccu/kit";
import { html, page } from "@canccu/ui";
import type { EventInfo, Html } from "@canccu/ui";
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
import { adminTokens, fillTokens, manifestCss, manifestTokens } from "./tokens.js";
import { STARTERS, STUDIO, draftFileUrl } from "./studio-views.js";
import { LIVE_SCRIPT, SAMPLES, discordCard, organiserPage } from "./preview-samples.js";
import type { Look } from "./preview-samples.js";

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
  const e = await tenants?.event(request.headers.host, request.headers.cookie);
  if (!e) return undefined;
  return {
    name: e.name,
    status: e.status,
    timeZone: e.time_zone ?? "UTC",
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    venue: e.venue?.name,
    shortName: e.short_name,
    description: e.description,
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
    doc = organiserPage(nonce, event, look, stylesheet);
  } else if (surface === "discord") {
    doc = page({
      title: "Discord",
      nonce,
      cssHref: `${STUDIO}static/ui.css`,
      body: html`${stylesheet(base)}${discordCard(look, event?.name ?? "Event")}${LIVE_SCRIPT}`,
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
      body: html`${[base, look.tokens, look.css].map(stylesheet)}${sample.body()}${LIVE_SCRIPT}`,
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
      const tokens = manifestTokens(draft.manifest);
      if (name === "tokens.css") return manifestCss(draft.manifest, tokens);
      if (name === "admin-tokens.css") return manifestCss(draft.manifest, adminTokens(tokens));
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
