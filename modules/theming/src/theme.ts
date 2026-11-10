/** The current theme as GET /api/theming/current answers it (contracts/theming.md, Reading the current theme). */
import type { SqlClient } from "@canccu/kit";
import { listEmbeds } from "./embeds.js";
import type { EmbedRef } from "./embeds.js";
import { fileName } from "./files.js";
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
  embed_color: number;
}

// Templates are parsed by a later slice (#245); until then a revision answers none, which the
// contract allows (a region without them shows its widget's default).
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
    embed_color: row.embed_color,
    layouts: row.manifest.layouts ?? [],
    templates: [],
    embeds,
  };
}

/** The highest revision, or undefined: restore and clone publish a new one, never rewind. */
export async function latestRevision(client: SqlClient): Promise<ResolvedTheme | undefined> {
  const { rows } = await client.query(
    `SELECT revision, published_at, manifest, tokens, tokens_css, admin_tokens_css, css, logo,
            embed_color
       FROM theming_revisions ORDER BY revision DESC LIMIT 1`,
  );
  const row = rows[0] as RevisionRow | undefined;
  if (row === undefined) return undefined;
  const base = `${SANDBOX}${row.revision}/`;
  return fromRevision(row, await listEmbeds(client, `r:${row.revision}`, base));
}
