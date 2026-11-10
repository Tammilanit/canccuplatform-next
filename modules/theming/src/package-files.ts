/**
 * The package's files by path (migrations/004): a path holds a stored file, or the problem of an
 * upload that failed its checks. theming_file_refs keeps naming every file the draft refers to,
 * which `/theming/draft/` serves by.
 */
import type { SqlClient } from "@canccu/kit";
import type { Problem } from "./checks.js";
import { notFound } from "./http.js";

export type PathEntry = { file: string; bytes: number } | { problem: Problem };

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
    `INSERT INTO theming_package_files (owner, path, file, bytes, problem)
     VALUES ('draft', $1, $2, $3, $4)
     ON CONFLICT (tenant_id, owner, path)
       DO UPDATE SET file = EXCLUDED.file, bytes = EXCLUDED.bytes, problem = EXCLUDED.problem`,
    [
      path,
      file,
      "file" in entry ? entry.bytes : null,
      "problem" in entry ? JSON.stringify(entry.problem) : null,
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

/** The problems of the uploads the draft holds instead of files. */
export async function pathProblems(c: SqlClient): Promise<Problem[]> {
  const { rows } = await c.query(
    `SELECT problem FROM theming_package_files
      WHERE owner = 'draft' AND problem IS NOT NULL ORDER BY path`,
  );
  return (rows as { problem: Problem }[]).map((r) => r.problem);
}

/** Every file the draft refers to: what discarding it lets go. */
export async function draftFileNames(c: SqlClient): Promise<string[]> {
  const { rows } = await c.query(`SELECT file FROM theming_file_refs WHERE owner = 'draft'`);
  return (rows as { file: string }[]).map((r) => r.file);
}
