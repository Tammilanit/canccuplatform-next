/** The current theme as GET /api/theming/current answers it (contracts/theming.md, Reading the current theme). */
import type { SqlClient } from "@canccu/kit";
import { fileName } from "./files.js";
import { adminTokens, platformTokens, tokensCss } from "./tokens.js";
import type { Tokens } from "./tokens.js";

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
  embeds: unknown[];
}

/** `#rrggbb[aa]` → the 24-bit Discord colour, alpha dropped (contracts/theming.md, Brand kit). */
export function colorInt(hex: string): number {
  return parseInt(hex.slice(1, 7), 16);
}

/**
 * Files every event serves without storing them: the platform defaults' token CSS. They are the
 * same for every event, so they live in memory and a read never writes.
 */
export interface Builtins {
  files: Map<string, Buffer>;
  defaults: ResolvedTheme;
}

export function builtins(): Builtins {
  const tokens = platformTokens();
  const css = Buffer.from(tokensCss(tokens));
  const admin = Buffer.from(tokensCss(adminTokens(tokens)));
  const files = new Map([
    [fileName(css, "css"), css],
    [fileName(admin, "css"), admin],
  ]);
  return {
    files,
    defaults: {
      revision: 0,
      theming_version: THEMING_VERSION,
      tokens,
      tokens_css_url: SERVED + fileName(css, "css"),
      admin_tokens_css_url: SERVED + fileName(admin, "css"),
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

// Templates are parsed by a later slice (#245) and embeds served by #186; until then a revision
// answers none, which the contract allows (a region without them shows its widget's default).
function fromRevision(row: RevisionRow): ResolvedTheme {
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
    embeds: [],
  };
}

/** The highest revision is current: restore and clone publish a new one, never rewind. */
export async function currentTheme(client: SqlClient, b: Builtins): Promise<ResolvedTheme> {
  const { rows } = await client.query(
    `SELECT revision, published_at, manifest, tokens, tokens_css, admin_tokens_css, css, logo,
            embed_color
       FROM revisions ORDER BY revision DESC LIMIT 1`,
  );
  const row = rows[0] as RevisionRow | undefined;
  return row === undefined ? b.defaults : fromRevision(row);
}
