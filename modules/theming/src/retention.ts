/**
 * Kept revisions (contracts/theming.md, Draft, preview, publish, Kept; plan D12): the newest 20,
 * plus the revision screens are pinned to and the one a timed pin restores (theming_pins, pins.ts).
 * A revision past them goes whole, and with it every file only it used, its bytes given back.
 * Pruning only deletes: the history's numbers keep growing from the newest, which is always kept.
 */
import { lockHistory } from "./publish.js";
import { writingFiles } from "./stored.js";
import type { StoredDeps, Unused } from "./stored.js";

export const KEPT_REVISIONS = 20;

/**
 * Prunes the current event's revisions past the kept ones; answers their numbers. Run after a
 * publish or restore, after a pin changes, and by the hourly upkeep, which catches up on one that
 * failed.
 */
export function pruneRevisions(deps: StoredDeps): Promise<number[]> {
  return writingFiles(deps, async (c) => {
    // The history lock: a restore or a draft made from a revision copies its files under it, so
    // none is pruned halfway through a copy, and pins.ts writes the pins under it.
    const current = await lockHistory(c);
    const { rows } = await c.query(
      `SELECT revision FROM theming_revisions r
        WHERE revision <= $1
          AND NOT EXISTS (SELECT 1 FROM theming_pins p
                           WHERE r.revision IN (p.theme_revision, p.restores_revision))
        ORDER BY revision`,
      [current - KEPT_REVISIONS],
    );
    const pruned = (rows as { revision: number }[]).map((r) => r.revision);
    if (pruned.length === 0) return { result: pruned, unused: [] };
    const owners = pruned.map((n) => `r:${String(n)}`);
    const refs = await c.query(
      `DELETE FROM theming_file_refs WHERE owner = ANY($1::text[]) RETURNING file`,
      [owners],
    );
    // An embed's files have no refs: their rows are all that keep them (stored.ts, `Unused`).
    const embeds = await c.query(
      `DELETE FROM theming_embed_files WHERE owner = ANY($1::text[]) RETURNING file, bytes`,
      [owners],
    );
    await c.query(`DELETE FROM theming_package_files WHERE owner = ANY($1::text[])`, [owners]);
    await c.query(`DELETE FROM theming_revisions WHERE revision = ANY($1::integer[])`, [pruned]);
    const unused: Unused[] = [
      ...(refs.rows as { file: string }[]).map((r) => r.file),
      ...(embeds.rows as { file: string; bytes: string }[]).map((r) => ({
        name: r.file,
        bytes: Number(r.bytes),
      })),
    ];
    return { result: pruned, unused };
  });
}

/** `pruneRevisions` after a change that may have let revisions go; a failure waits for the upkeep. */
export async function pruneQuietly(deps: StoredDeps): Promise<void> {
  try {
    await pruneRevisions(deps);
  } catch (err) {
    deps.log.warn({ err }, "pruning theme revisions failed; the upkeep tries again");
  }
}
