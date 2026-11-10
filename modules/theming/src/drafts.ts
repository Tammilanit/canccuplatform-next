/** The one draft per event and its one write path (contracts/theming.md, Draft, preview, publish; plan D3). */
import { randomBytes } from "node:crypto";
import type { SqlClient } from "@canccu/kit";
import { COLOR_TOKENS } from "@canccu/ui";
import { checkManifest } from "./checks.js";
import type { Manifest, Problem } from "./checks.js";
import { draftExists, noDraft, notFound, versionConflict } from "./http.js";
import { fillTokens } from "./tokens.js";
import type { PartialTokens } from "./tokens.js";

export interface DraftRow {
  draft_version: number;
  created_from: number | null;
  manifest: Manifest;
  problems: Problem[];
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
    problems: row.problems,
    updated_at: row.updated_at.toISOString(),
    updated_by: row.updated_by,
  };
}

const COLUMNS = "draft_version, created_from, manifest, problems, updated_at, updated_by";

/** The draft key names draft embeds in the sandbox, so it is unguessable and new on every change. */
const newDraftKey = (): string => randomBytes(24).toString("base64url");

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
  return {
    schema_version: 1,
    name: "Default",
    mode: "simple",
    brand: { primary: COLOR_TOKENS.primary, accent: COLOR_TOKENS.accent, scheme: "dark" },
    tokens: { colors: { ...COLOR_TOKENS } },
  };
}

export type DraftSource =
  { from: "defaults" } | { from: "current" } | { from: "revision"; revision: number };

/**
 * Copies what `from` (`draft` or `r:<n>`) holds to `to`: its file references and embed files, the
 * one copy rule of draft creation, publish and restore. A revision's generated token CSS stays
 * behind: the next revision generates its own.
 */
export async function copyOwned(c: SqlClient, from: string, to: string): Promise<void> {
  await c.query(
    `INSERT INTO theming_file_refs (owner, file)
     SELECT $2, f.file FROM theming_file_refs f
       LEFT JOIN theming_revisions r ON 'r:' || r.revision = f.owner
      WHERE f.owner = $1
        AND (r.revision IS NULL OR f.file NOT IN (r.tokens_css, r.admin_tokens_css, coalesce(r.css, '')))
     ON CONFLICT DO NOTHING`,
    [from, to],
  );
  await c.query(
    `INSERT INTO theming_embed_files (owner, embed, path, file, bytes, entry)
     SELECT $2, embed, path, file, bytes, entry FROM theming_embed_files WHERE owner = $1`,
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
  const created = rows[0] as DraftRow | undefined;
  if (created === undefined) throw draftExists();
  if (base !== null) await copyOwned(c, `r:${base}`, "draft");
  return created;
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
  change: (manifest: Manifest) => Manifest,
): Promise<DraftRow> {
  const row = await lockDraft(c, version);
  const manifest = change(structuredClone(row.manifest));
  const { rows } = await c.query(
    `UPDATE theming_drafts
        SET draft_version = draft_version + 1, draft_key = $1, manifest = $2, problems = $3,
            updated_at = now(), updated_by = $4
      RETURNING ${COLUMNS}`,
    [newDraftKey(), JSON.stringify(manifest), JSON.stringify(checkManifest(manifest)), actor],
  );
  return rows[0] as unknown as DraftRow;
}

/**
 * Removes the draft and what refers to it. The files stay on the volume: another draft or a
 * revision may hold the same bytes, and retention (#246) deletes what nothing refers to.
 */
export async function removeDraft(c: SqlClient): Promise<void> {
  await c.query(`DELETE FROM theming_drafts`);
  await c.query(`DELETE FROM theming_file_refs WHERE owner = 'draft'`);
  await c.query(`DELETE FROM theming_embed_files WHERE owner = 'draft'`);
}
