/**
 * The package's files by path (migrations/004): a path holds a stored file, or the problem of an
 * upload that failed its checks. theming_file_refs keeps naming every file the draft refers to,
 * which `/theming/draft/` serves by.
 */
import type { SqlClient } from "@canccu/kit";
import type { Problem } from "./checks.js";
import { CSS_LIMIT } from "./css.js";
import { notFound } from "./http.js";
import type { PackagePaths } from "./manifest.js";
import type { Dropped, Unused } from "./stored.js";

/**
 * A stored file, with what its checks found for the draft's checks (CSS and templates: the package
 * paths it names and its warnings), or the problem of an upload that failed.
 */
export type PathEntry =
  { file: string; bytes: number; refs?: string[]; warnings?: Problem[] } | { problem: Problem };

/**
 * The draft's file at `path` stops referring to `old`; answers it when the draft keeps no other
 * path with the same bytes, so the caller can let the file go if nothing else holds it.
 */
async function letGo(c: SqlClient, old: string | null, kept: string | null): Promise<string[]> {
  if (old === null || old === kept) return [];
  await c.query(
    `DELETE FROM theming_file_refs WHERE owner = 'draft' AND file = $1
       AND NOT EXISTS (SELECT 1 FROM theming_package_files WHERE owner = 'draft' AND file = $1)`,
    [old],
  );
  return [old];
}

/** Puts `entry` at the draft's `path`; answers the files the draft may no longer refer to. */
export async function setDraftPath(
  c: SqlClient,
  path: string,
  entry: PathEntry,
): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT file FROM theming_package_files WHERE owner = 'draft' AND path = $1 FOR UPDATE`,
    [path],
  );
  const old = (rows[0] as { file: string | null } | undefined)?.file ?? null;
  const file = "file" in entry ? entry.file : null;
  await c.query(
    `INSERT INTO theming_package_files (owner, path, file, bytes, problem, refs, warnings)
     VALUES ('draft', $1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, owner, path)
       DO UPDATE SET file = EXCLUDED.file, bytes = EXCLUDED.bytes, problem = EXCLUDED.problem,
                     refs = EXCLUDED.refs, warnings = EXCLUDED.warnings`,
    [
      path,
      file,
      "file" in entry ? entry.bytes : null,
      "problem" in entry ? JSON.stringify(entry.problem) : null,
      "file" in entry ? (entry.refs ?? []) : [],
      JSON.stringify("file" in entry ? (entry.warnings ?? []) : []),
    ],
  );
  if (file !== null) {
    await c.query(
      `INSERT INTO theming_file_refs (owner, file) VALUES ('draft', $1) ON CONFLICT DO NOTHING`,
      [file],
    );
  }
  return letGo(c, old, file);
}

/** Removes the draft's `path` (404 when it has none); answers as `setDraftPath`. */
export async function removeDraftPath(c: SqlClient, path: string): Promise<string[]> {
  const { rows } = await c.query(
    `DELETE FROM theming_package_files WHERE owner = 'draft' AND path = $1 RETURNING file`,
    [path],
  );
  const row = rows[0] as { file: string | null } | undefined;
  if (row === undefined) throw notFound();
  return letGo(c, row.file, null);
}

/**
 * The problems of the draft's package files: those of the uploads it holds instead of files, the
 * warnings of the files it holds, each package path a CSS file or template names that the package
 * does not hold (contracts/theming.md: a url() names a package file, an img src a package image),
 * and `css/` over its 256 KB together.
 */
export async function pathProblems(c: SqlClient, paths: PackagePaths): Promise<Problem[]> {
  const { rows } = await c.query(
    `SELECT path, problem, refs, warnings FROM theming_package_files
      WHERE owner = 'draft' ORDER BY path`,
  );
  const out: Problem[] = [];
  for (const row of rows as {
    path: string;
    problem: Problem | null;
    refs: string[];
    warnings: Problem[];
  }[]) {
    if (row.problem !== null) out.push(row.problem);
    out.push(...row.warnings);
    for (const ref of row.refs) {
      if (paths.present.has(ref) && !paths.failed.has(ref)) continue;
      out.push({
        severity: "error",
        code: row.path.startsWith("css/") ? "css_forbidden" : "template_forbidden",
        path: row.path,
        message: `${row.path} names ${ref}, which the package does not hold.`,
      });
    }
  }
  const { rows: sum } = await c.query(
    `SELECT coalesce(sum(bytes), 0) AS n FROM theming_package_files
      WHERE owner = 'draft' AND path LIKE 'css/%'`,
  );
  const css = Number((sum[0] as { n: string }).n);
  if (css > CSS_LIMIT) {
    out.push({
      severity: "error",
      code: "file_too_large",
      path: "css/",
      message: "The CSS files are at most 256 KB together.",
    });
  }
  return out;
}

/**
 * Every file the draft refers to, its embeds' too: what discarding or replacing it lets go. An
 * embed's file comes with its bytes, which only its rows record (stored.ts, `Unused`).
 */
export async function draftFileNames(c: SqlClient): Promise<Unused[]> {
  const refs = await c.query(`SELECT file FROM theming_file_refs WHERE owner = 'draft'`);
  return [...(refs.rows as { file: string }[]).map((r) => r.file), ...(await draftEmbedFiles(c))];
}

/** The draft's embed files, each once, with their bytes. */
export async function draftEmbedFiles(c: SqlClient): Promise<Dropped[]> {
  const { rows } = await c.query(
    `SELECT DISTINCT file, bytes FROM theming_embed_files WHERE owner = 'draft'`,
  );
  return (rows as { file: string; bytes: string }[]).map((r) => ({
    name: r.file,
    bytes: Number(r.bytes),
  }));
}

/** The draft's package paths, its embeds' files among them, for the reference checks (manifest.ts). */
export async function draftPaths(c: SqlClient): Promise<PackagePaths> {
  const { rows } = await c.query(
    `SELECT path, coalesce(problem ->> 'severity' = 'error', false) AS failed
       FROM theming_package_files
      WHERE owner = 'draft'
     UNION ALL SELECT 'embeds/' || embed || '/' || path, false FROM theming_embed_files
      WHERE owner = 'draft'`,
  );
  const all = rows as { path: string; failed: boolean }[];
  return {
    present: new Set(all.map((r) => r.path)),
    failed: new Set(all.filter((r) => r.failed).map((r) => r.path)),
  };
}

/**
 * Removes every draft path in `folders` (`css`, `fonts`, …) and every draft embed: the switch back
 * to simple. Answers the package paths removed, sorted, and the files the draft may no longer
 * refer to.
 */
export async function removeDraftFolders(
  c: SqlClient,
  folders: readonly string[],
): Promise<{ removed: string[]; unused: Unused[] }> {
  const paths = await c.query(
    `DELETE FROM theming_package_files
      WHERE owner = 'draft' AND split_part(path, '/', 1) = ANY($1::text[])
     RETURNING path, file`,
    [folders],
  );
  const embeds = await c.query(
    `DELETE FROM theming_embed_files WHERE owner = 'draft' RETURNING embed, path, file, bytes`,
  );
  const unused: Unused[] = [];
  for (const row of paths.rows as { file: string | null }[]) {
    unused.push(...(await letGo(c, row.file, null)));
  }
  // An embed's files have no refs of their own: their rows were all that kept them.
  for (const row of embeds.rows as { file: string; bytes: string }[]) {
    unused.push({ name: row.file, bytes: Number(row.bytes) });
  }
  const removed = [
    ...(paths.rows as { path: string }[]).map((r) => r.path),
    ...(embeds.rows as { embed: string; path: string }[]).map((r) => `embeds/${r.embed}/${r.path}`),
  ].sort();
  return { removed, unused };
}

/** The names of the embeds the draft holds files for. */
export async function draftEmbedNames(c: SqlClient): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT DISTINCT embed FROM theming_embed_files WHERE owner = 'draft' ORDER BY embed`,
  );
  return (rows as { embed: string }[]).map((r) => r.embed);
}
