/** The one draft per event and its one write path (contracts/theming.md, Draft, preview, publish; plan D3). */
import { randomBytes } from "node:crypto";
import type { SqlClient } from "@canccu/kit";
import { COLOR_TOKENS } from "@canccu/ui";
import { generateColors } from "./brand.js";
import type { Brand } from "./brand.js";
import { checkManifest } from "./checks.js";
import type { Manifest, Problem } from "./checks.js";
import { draftExists, noDraft, notFound, versionConflict } from "./http.js";
import { referenceProblems } from "./manifest.js";
import { draftPaths, pathProblems } from "./package-files.js";
import { lockHistory } from "./publish.js";
import { readabilityProblems } from "./readability.js";
import { fillTokens } from "./tokens.js";
import type { PartialTokens } from "./tokens.js";

export interface DraftRow {
  draft_version: number;
  created_from: number | null;
  manifest: Manifest;
  problems: Problem[];
  files: { path: string; bytes: number }[];
  updated_at: Date;
  updated_by: string | null;
}

/** The Draft of contracts/theming.openapi.yaml. */
export function draftBody(row: DraftRow): Record<string, unknown> {
  return {
    draft_version: row.draft_version,
    base_revision: row.created_from ?? 0,
    mode: row.manifest.mode === "advanced" ? "advanced" : "simple",
    manifest: row.manifest,
    files: row.files,
    problems: row.problems,
    updated_at: row.updated_at.toISOString(),
    updated_by: row.updated_by,
  };
}

const COLUMNS = `draft_version, created_from, manifest, problems, updated_at, updated_by,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('path', path, 'bytes', bytes) ORDER BY path), '[]')
     FROM (SELECT path, bytes FROM theming_package_files WHERE owner = 'draft' AND file IS NOT NULL
           UNION ALL SELECT 'embeds/' || embed || '/' || path, bytes FROM theming_embed_files
            WHERE owner = 'draft') held) AS files`;

/** The draft key names draft embeds in the sandbox, so it is unguessable and new on every change. */
export const newDraftKey = (): string => randomBytes(24).toString("base64url");

export async function loadDraft(c: SqlClient, forUpdate = false): Promise<DraftRow | undefined> {
  const { rows } = await c.query(
    `SELECT ${COLUMNS} FROM theming_drafts${forUpdate ? " FOR UPDATE" : ""}`,
  );
  return rows[0] as DraftRow | undefined;
}

/** The draft, locked, at `version`; 404 `no_draft` or 409 `version_conflict` otherwise. */
export async function lockDraft(c: SqlClient, version: number): Promise<DraftRow> {
  const row = await loadDraft(c, true);
  if (row === undefined) throw noDraft();
  if (row.draft_version !== version) throw versionConflict("draft");
  return row;
}

/** A valid simple-mode theme: the platform colours, with the brand they come from. */
export function defaultManifest(): Manifest {
  const brand: Brand = {
    primary: COLOR_TOKENS.primary,
    accent: COLOR_TOKENS.accent,
    scheme: "dark",
  };
  return {
    schema_version: 1,
    name: "Default",
    mode: "simple",
    brand,
    // The platform colours themselves: the default brand generates exactly them (test/brand.test.ts).
    tokens: { colors: generateColors(brand).colors },
  };
}

export type DraftSource =
  { from: "defaults" } | { from: "current" } | { from: "revision"; revision: number };

/**
 * The files a revision `r` generated at publish, as an SQL array: token CSS, compiled CSS, the
 * logo PNG and the icons. The next revision generates its own, so copies leave them behind.
 */
const GENERATED = `array_remove(ARRAY[r.tokens_css, r.admin_tokens_css, r.css, r.logo_png,
  r.icon_192, r.icon_512, r.icon_maskable_512], NULL)`;

/**
 * The file references `f` that owner `$1` passes on to a copy: all of them but a revision's
 * generated files, unless a package path holds the same bytes (a logo already 512 px wide can come
 * out of the PNG encoder identical to its own rendition). The one rule of copyOwned and publish's
 * comparison of what changed, so the two cannot drift apart.
 */
export const CARRIED_REFS = `FROM theming_file_refs f
   LEFT JOIN theming_revisions r ON 'r:' || r.revision = f.owner
  WHERE f.owner = $1
    AND (r.revision IS NULL OR f.file <> ALL (${GENERATED})
         OR EXISTS (SELECT 1 FROM theming_package_files p
                     WHERE p.owner = f.owner AND p.file = f.file))`;

/**
 * Copies what `from` (`draft` or `r:<n>`) holds to `to`: its file references and embed files, the
 * one copy rule of draft creation, publish and restore (CARRIED_REFS says which files go).
 */
export async function copyOwned(c: SqlClient, from: string, to: string): Promise<void> {
  await c.query(
    `INSERT INTO theming_file_refs (owner, file)
     SELECT $2, f.file ${CARRIED_REFS}
     ON CONFLICT DO NOTHING`,
    [from, to],
  );
  await c.query(
    `INSERT INTO theming_embed_files (owner, embed, path, file, bytes, entry)
     SELECT $2, embed, path, file, bytes, entry FROM theming_embed_files WHERE owner = $1`,
    [from, to],
  );
  await c.query(
    `INSERT INTO theming_package_files (owner, path, file, bytes, problem, refs, warnings,
                                        font_sizes)
     SELECT $2, path, file, bytes, problem, refs, warnings, font_sizes FROM theming_package_files
      WHERE owner = $1`,
    [from, to],
  );
}

/**
 * Revision 0 as a manifest: the defaults with the profile's `theme` over them, as
 * `GET /api/theming/current` shows it. Fonts or sizes are styling the simple mode cannot make, so
 * they make the draft advanced; colours stay simple, with the brand taken from them.
 */
export function profileManifest(profile: PartialTokens | undefined): Manifest {
  const manifest = defaultManifest();
  if (profile === undefined) return manifest;
  const filled = fillTokens(profile);
  const given = (group: "fonts" | "sizes"): Record<string, string> =>
    Object.fromEntries(
      Object.keys(profile[group] ?? {})
        .filter((k) => filled[group][k] !== undefined)
        .map((k) => [k, filled[group][k] as string]),
    );
  const [fonts, sizes] = [given("fonts"), given("sizes")];
  const advanced = Object.keys(fonts).length + Object.keys(sizes).length > 0;
  const brand = manifest.brand as Record<string, string>;
  return {
    ...manifest,
    mode: advanced ? "advanced" : "simple",
    brand: {
      ...brand,
      primary: filled.colors.primary ?? brand.primary,
      accent: filled.colors.accent ?? brand.accent,
    },
    tokens: {
      colors: filled.colors,
      ...(Object.keys(fonts).length > 0 ? { fonts } : {}),
      ...(Object.keys(sizes).length > 0 ? { sizes } : {}),
    },
  };
}

export async function createDraft(
  c: SqlClient,
  source: DraftSource,
  actor: string,
  /** The profile's `theme`, which revision 0 shows: a draft from current at revision 0 keeps it. */
  profile: PartialTokens | undefined,
): Promise<DraftRow> {
  let manifest = source.from === "current" ? profileManifest(profile) : defaultManifest();
  let base: number | null = null;
  if (source.from !== "defaults") {
    // Retention prunes under the same lock (retention.ts), so the revision copied stays whole.
    await lockHistory(c);
    const { rows } = await c.query(
      source.from === "current"
        ? `SELECT revision, manifest FROM theming_revisions ORDER BY revision DESC LIMIT 1`
        : `SELECT revision, manifest FROM theming_revisions WHERE revision = $1`,
      source.from === "current" ? [] : [source.revision],
    );
    const row = rows[0] as { revision: number; manifest: Manifest } | undefined;
    // Without a published revision, the current theme is revision 0, the profile's manifest.
    if (row === undefined && source.from === "revision") throw notFound();
    if (row !== undefined) [manifest, base] = [row.manifest, row.revision];
  }
  const { rows } = await c.query(
    `INSERT INTO theming_drafts (draft_key, created_from, manifest, problems, updated_by)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING ${COLUMNS}`,
    [newDraftKey(), base, JSON.stringify(manifest), JSON.stringify(checkManifest(manifest)), actor],
  );
  if (rows[0] === undefined) throw draftExists();
  if (base !== null) await copyOwned(c, `r:${base}`, "draft");
  // Checked again by publish's own check (with any files just copied), so the draft never shows
  // fewer problems than publish refuses with: revision 0's profile may name a font no package holds.
  await c.query(`UPDATE theming_drafts SET problems = $1`, [
    JSON.stringify(await draftProblems(c, manifest)),
  ]);
  return (await loadDraft(c)) as DraftRow;
}

/**
 * Every check on the draft: the manifest's, how it fits the draft's files (manifest.ts), the
 * problems of the uploads it holds instead of files (package-files.ts), and its CSS's small text
 * (readability.ts).
 */
export async function draftProblems(c: SqlClient, manifest: Manifest): Promise<Problem[]> {
  const paths = await draftPaths(c);
  return [
    ...checkManifest(manifest),
    ...referenceProblems(manifest, paths),
    ...(await pathProblems(c, paths)),
    ...(await readabilityProblems(c, manifest)),
  ];
}

/**
 * The one write path: lock the draft, check `version`, apply `change` to a copy of the manifest,
 * re-run every check on the result and store it with a new version and draft key, in the caller's
 * transaction.
 */
export async function editDraft(
  c: SqlClient,
  version: number,
  actor: string,
  change: (manifest: Manifest) => Manifest | Promise<Manifest>,
): Promise<DraftRow> {
  const row = await lockDraft(c, version);
  const manifest = await change(structuredClone(row.manifest));
  const { rows } = await c.query(
    `UPDATE theming_drafts
        SET draft_version = draft_version + 1, draft_key = $1, manifest = $2, problems = $3,
            updated_at = now(), updated_by = $4
      RETURNING ${COLUMNS}`,
    [
      newDraftKey(),
      JSON.stringify(manifest),
      JSON.stringify(await draftProblems(c, manifest)),
      actor,
    ],
  );
  return rows[0] as unknown as DraftRow;
}

/**
 * Removes the draft and what refers to it, its preview keys too. The files stay: a revision may hold the same bytes, so
 * the caller lets go of those nothing else holds (stored.ts, `writingFiles`), or publish has just
 * copied them all to the revision.
 */
export async function removeDraft(c: SqlClient): Promise<void> {
  await c.query(`DELETE FROM theming_drafts`);
  // A preview key dies with its draft (publish or discard): a screen then draws what is in effect.
  await c.query(`DELETE FROM theming_preview_keys`);
  await removeDraftPaths(c);
  await c.query(`DELETE FROM theming_embed_files WHERE owner = 'draft'`);
}

/** Removes the draft's package paths and its refs, its embeds kept: a package upload replaces them. */
export async function removeDraftPaths(c: SqlClient): Promise<void> {
  await c.query(`DELETE FROM theming_file_refs WHERE owner = 'draft'`);
  await c.query(`DELETE FROM theming_package_files WHERE owner = 'draft'`);
}
