/**
 * The draft on a screen and the current tokens for pages (contracts/theming.md, Draft, preview,
 * publish: On a screen; Reading the current theme: The current tokens, for pages).
 */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isTenantId, requireTenant, withTenant } from "@canccu/kit";
import type { SqlClient, TenantResolver } from "@canccu/kit";
import { isObject, list } from "./checks.js";
import { compiledCss, parsedTemplates } from "./compile.js";
import { StyleError } from "./css.js";
import type { Db } from "./db.js";
import { loadDraft } from "./drafts.js";
import type { DraftRow } from "./drafts.js";
import { listEmbeds } from "./embeds.js";
import { FILE_NAME } from "./files.js";
import type { FileStore } from "./files.js";
import {
  WRITE,
  actorOf,
  assertWritable,
  invalidRequest,
  needs,
  noDraft,
  notFound,
} from "./http.js";
import type { ProfileSource } from "./profile.js";
import { onlyScreen } from "./revision-routes.js";
import { referenced, sendFile } from "./routes.js";
import { SANDBOX } from "./sandbox.js";
import { SERVED, THEMING_VERSION, colorInt, currentTheme, revisionZero } from "./theme.js";
import type { ResolvedTheme } from "./theme.js";
import { fillTokens, tokensCss } from "./tokens.js";
import type { RightsChecker } from "@canccu/kit";

export interface PreviewDeps {
  db: Db;
  files: FileStore;
  rights: RightsChecker;
  profile: ProfileSource;
  tenants: TenantResolver;
}

const LIFETIME_MS = 12 * 60 * 60 * 1000;
const KEY = /^[A-Za-z0-9_-]{32,64}$/;
const PREVIEW = "/theming/preview/";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The draft behind a live key of the tenant in scope, or undefined (unknown, expired, no draft). */
async function draftOfKey(c: SqlClient, key: string): Promise<DraftRow | undefined> {
  if (!KEY.test(key)) return undefined;
  const { rows } = await c.query(
    `SELECT 1 FROM theming_preview_keys WHERE key_sha256 = $1 AND expires_at > now()`,
    [sha256(key)],
  );
  return rows.length === 0 ? undefined : loadDraft(c);
}

/** The draft as `GET /api/theming/current` answers a revision, its addresses under the key's. */
async function resolvedDraft(
  c: SqlClient,
  files: FileStore,
  key: string,
  draft: DraftRow,
): Promise<ResolvedTheme> {
  const base = `${PREVIEW}${key}/`;
  // The version busts the screen's cached link: the address stays, the draft behind it changes.
  const v = `?v=${draft.draft_version}`;
  const m = draft.manifest;
  const tokens = fillTokens(m.tokens ?? {});
  let templates: unknown[] = [];
  try {
    templates = await parsedTemplates(c, files, "draft", m, base);
  } catch (err) {
    // The draft's problems already name it; the screen draws the widgets without templates.
    if (!(err instanceof StyleError)) throw err;
  }
  const brand = isObject(m.brand) ? m.brand : {};
  const images = isObject(m.images) ? m.images : {};
  const logo = await draftFile(c, images.logo);
  const { rows } = await c.query(`SELECT draft_key FROM theming_drafts`);
  const draftKey = (rows[0] as { draft_key: string }).draft_key;
  return {
    revision: null,
    theming_version: THEMING_VERSION,
    tokens,
    tokens_css_url: `${base}tokens.css${v}`,
    // A screen never draws an admin page; the same tokens keep the shape whole.
    admin_tokens_css_url: `${base}tokens.css${v}`,
    ...(list(m.css).length > 0 ? { css_url: `${base}theme.css${v}` } : {}),
    ...(logo === undefined ? {} : { logo_url: base + logo }),
    embed_color: colorInt(
      typeof brand.embed_color === "string"
        ? brand.embed_color
        : (tokens.colors.primary ?? "#000000"),
    ),
    layouts: Array.isArray(m.layouts) ? m.layouts : [],
    templates,
    embeds: await listEmbeds(c, "draft", `${SANDBOX}draft/${draftKey}/`),
  };
}

async function draftFile(c: SqlClient, path: unknown): Promise<string | undefined> {
  if (typeof path !== "string") return undefined;
  const { rows } = await c.query(
    `SELECT file FROM theming_package_files WHERE owner = 'draft' AND path = $1`,
    [path],
  );
  const file = (rows[0] as { file: string | null } | undefined)?.file;
  return typeof file === "string" && FILE_NAME.test(file) ? file : undefined;
}

function cssReply(reply: FastifyReply, text: string, cache: string): FastifyReply {
  return reply
    .type("text/css; charset=utf-8")
    .header("cache-control", cache)
    .header("x-content-type-options", "nosniff")
    .header("cross-origin-resource-policy", "same-origin")
    .send(text);
}

/** The key's routes on the event's hostname, and the current tokens for pages. */
export function keyRoutes(app: FastifyInstance, deps: PreviewDeps): void {
  app.post(
    "/api/theming/draft/preview-key",
    { preHandler: needs(deps.rights, WRITE) },
    async (request, reply) => {
      assertWritable(request);
      const key = randomBytes(32).toString("base64url");
      const expires = await deps.db.tenant(async (c) => {
        if ((await loadDraft(c)) === undefined) throw noDraft();
        const { rows } = await c.query(
          `INSERT INTO theming_preview_keys (key_sha256, expires_at, created_by)
         VALUES ($1, now() + $2 * interval '1 millisecond', $3) RETURNING expires_at`,
          [sha256(key), LIFETIME_MS, actorOf(request)],
        );
        // Expired keys go as new ones come: a key lives 12 hours, so the table stays small.
        await c.query(`DELETE FROM theming_preview_keys WHERE expires_at <= now()`);
        return (rows[0] as { expires_at: Date }).expires_at;
      });
      return reply
        .status(201)
        .header("cache-control", "no-store")
        .send({ preview_key: key, expires_at: expires.toISOString() });
    },
  );

  app.get<{ Params: { key: string; file: string } }>(
    `${PREVIEW}:key/:file`,
    async (request, reply) => {
      const { key, file } = request.params;
      if (file !== "tokens.css" && file !== "theme.css" && !FILE_NAME.test(file)) throw notFound();
      const found = await deps.db.tenant(async (c) => {
        const draft = await draftOfKey(c, key);
        if (draft === undefined) return undefined;
        if (file === "tokens.css") return tokensCss(fillTokens(draft.manifest.tokens ?? {}));
        if (file !== "theme.css") return null;
        try {
          const css = await compiledCss(
            c,
            deps.files,
            "draft",
            draft.manifest,
            `${PREVIEW}${key}/`,
          );
          return css?.toString("utf8") ?? "";
        } catch (err) {
          if (err instanceof StyleError) return "";
          throw err;
        }
      });
      if (found === undefined) throw notFound();
      if (found !== null) return cssReply(reply, found, "no-store");
      const bytes = (await referenced(deps.db, file, true))
        ? await deps.files.read(file)
        : undefined;
      if (bytes === undefined) throw notFound();
      return sendFile(reply, file, bytes, "no-store");
    },
  );

  // Public in every info-page mode: the sign-in page links them before anyone signs in.
  app.get<{ Params: { file: string } }>("/theming/current/:file", async (request, reply) => {
    const { file } = request.params;
    if (file !== "tokens.css" && file !== "admin-tokens.css") throw notFound();
    const theme = await currentTheme(deps.db, deps.profile);
    const url = file === "tokens.css" ? theme.tokens_css_url : theme.admin_tokens_css_url;
    const name = url.slice(SERVED.length);
    const etag = `"${name.slice(0, 64)}"`;
    void reply.header("etag", etag);
    if (request.headers["if-none-match"] === etag) {
      return reply.status(304).header("cache-control", "no-cache").send();
    }
    const bytes =
      revisionZero(await deps.profile(requireTenant())).files.get(name) ??
      (await deps.files.read(name));
    if (bytes === undefined) throw notFound();
    return cssReply(reply, bytes.toString("utf8"), "no-cache");
  });
}

/** Screen's read of the draft behind a key (`GET /internal/theming/previews/{preview_key}`). */
export function internalPreviewRoutes(app: FastifyInstance, deps: PreviewDeps): void {
  app.get<{ Params: { key: string }; Querystring: { tenant_id?: string } }>(
    "/internal/theming/previews/:key",
    async (
      request: FastifyRequest<{ Params: { key: string }; Querystring: { tenant_id?: string } }>,
      reply,
    ) => {
      onlyScreen(request);
      const tenant = request.query.tenant_id;
      if (tenant === undefined || !isTenantId(tenant))
        throw invalidRequest("A tenant_id is required.");
      if ((await deps.tenants.byId(tenant)) === null) throw notFound();
      const theme = await withTenant(tenant, () =>
        deps.db.tenant(async (c) => {
          const draft = await draftOfKey(c, request.params.key);
          return draft && resolvedDraft(c, deps.files, request.params.key, draft);
        }),
      );
      if (theme === undefined) throw notFound();
      void reply.header("cache-control", "no-store");
      return theme;
    },
  );
}
