/** The current theme as GET /api/theming/current answers it (contracts/theming.md, Reading the current theme). */
import { requireTenant } from "@canccu/kit";
import type { SqlClient } from "@canccu/kit";
import type { Db } from "./db.js";
import { listEmbeds } from "./embeds.js";
import type { EmbedRef } from "./embeds.js";
import { fileName } from "./files.js";
import type { ProfileSource } from "./profile.js";
import { SANDBOX } from "./sandbox.js";
import { adminTokens, fillTokens, tokensCss } from "./tokens.js";
import type { PartialTokens, Tokens } from "./tokens.js";

export const THEMING_VERSION = 1;
export const SERVED = "/theming/a/";

export interface ResolvedTheme {
  revision: number | null;
  published_at?: string;
  theming_version: number;
  tokens: Tokens;
  tokens_css_url: string;
  admin_tokens_css_url: string;
  css_url?: string;
  logo_url?: string;
  logo_png_url?: string;
  icon_urls?: { "192": string; "512": string; maskable_512: string };
  embed_color: number;
  layouts: unknown[];
  templates: unknown[];
  embeds: EmbedRef[];
}

/** `#rrggbb[aa]` → the 24-bit Discord colour, alpha dropped (contracts/theming.md, Brand kit). */
export function colorInt(hex: string): number {
  return parseInt(hex.slice(1, 7), 16);
}

/** Revision 0 and the files it links, by served name. */
export interface RevisionZero {
  theme: ResolvedTheme;
  files: Map<string, Buffer>;
}

/**
 * Revision 0: the platform defaults with the profile's `theme` over them. Its token CSS is
 * generated on each read and never stored, so a read never writes and any container can serve the
 * addresses it links, by generating them again.
 */
export function revisionZero(profile: PartialTokens | undefined): RevisionZero {
  const tokens = fillTokens(profile ?? {});
  const css = Buffer.from(tokensCss(tokens));
  const admin = Buffer.from(tokensCss(adminTokens(tokens)));
  const cssName = fileName(css, "css");
  const adminName = fileName(admin, "css");
  return {
    files: new Map([
      [cssName, css],
      [adminName, admin],
    ]),
    theme: {
      revision: 0,
      theming_version: THEMING_VERSION,
      tokens,
      tokens_css_url: SERVED + cssName,
      admin_tokens_css_url: SERVED + adminName,
      embed_color: colorInt(tokens.colors.primary ?? "#000000"),
      layouts: [],
      templates: [],
      embeds: [],
    },
  };
}

interface RevisionRow {
  revision: number;
  published_at: Date;
  manifest: { layouts?: unknown[] };
  tokens: Tokens;
  tokens_css: string;
  admin_tokens_css: string;
  css: string | null;
  logo: string | null;
  logo_png: string | null;
  icon_192: string | null;
  icon_512: string | null;
  icon_maskable_512: string | null;
  embed_color: number;
  templates: unknown[];
}

function fromRevision(row: RevisionRow, embeds: EmbedRef[]): ResolvedTheme {
  return {
    revision: row.revision,
    published_at: row.published_at.toISOString(),
    theming_version: THEMING_VERSION,
    tokens: row.tokens,
    tokens_css_url: SERVED + row.tokens_css,
    admin_tokens_css_url: SERVED + row.admin_tokens_css,
    ...(row.css === null ? {} : { css_url: SERVED + row.css }),
    ...(row.logo === null ? {} : { logo_url: SERVED + row.logo }),
    ...(row.logo_png === null ? {} : { logo_png_url: SERVED + row.logo_png }),
    // A set, or none: an image too thin to draw at one of the sizes leaves the whole set out.
    ...(row.icon_192 === null || row.icon_512 === null || row.icon_maskable_512 === null
      ? {}
      : {
          icon_urls: {
            "192": SERVED + row.icon_192,
            "512": SERVED + row.icon_512,
            maskable_512: SERVED + row.icon_maskable_512,
          },
        }),
    embed_color: row.embed_color,
    layouts: row.manifest.layouts ?? [],
    templates: row.templates,
    embeds,
  };
}

/**
 * One revision resolved like the current one (`GET /internal/theming/revisions/{revision}`), or
 * without `revision` the highest: restore and clone publish a new one, never rewind.
 */
export async function resolvedRevision(
  client: SqlClient,
  revision?: number,
): Promise<ResolvedTheme | undefined> {
  const { rows } = await client.query(
    `SELECT revision, published_at, manifest, tokens, tokens_css, admin_tokens_css, css, logo,
            logo_png, icon_192, icon_512, icon_maskable_512, embed_color, templates
       FROM theming_revisions WHERE $1::integer IS NULL OR revision = $1
      ORDER BY revision DESC LIMIT 1`,
    [revision ?? null],
  );
  const row = rows[0] as RevisionRow | undefined;
  if (row === undefined) return undefined;
  const base = `${SANDBOX}${row.revision}/`;
  return fromRevision(row, await listEmbeds(client, `r:${row.revision}`, base));
}

/**
 * The current theme of the tenant in scope: the highest revision, else revision 0 from its
 * profile. The guests' read and the screens' read both answer through this one function, so a
 * screen never shows another look than the event's own pages; the callers do the access checks.
 * Both halves read the ambient tenant, so no caller can mix one event's revisions with another's
 * profile.
 */
export async function currentTheme(db: Db, profile: ProfileSource): Promise<ResolvedTheme> {
  return (
    (await db.tenant((c) => resolvedRevision(c))) ??
    revisionZero(await profile(requireTenant())).theme
  );
}
