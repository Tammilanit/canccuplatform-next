/**
 * Writing a revision: publish and restore both end here (contracts/theming.md, Draft, preview,
 * publish; plan D4). History only grows: a revision row is never changed once written.
 */
import { isDeepStrictEqual } from "node:util";
import type { SqlClient } from "@canccu/kit";
import type { Manifest } from "./checks.js";
import { copyOwned } from "./drafts.js";
import type { FileStore } from "./files.js";
import { SERVED, colorInt } from "./theme.js";
import { adminTokens, fillTokens, platformTokens, tokensCss } from "./tokens.js";
import type { PartialTokens, Tokens } from "./tokens.js";

/** The parts `theming.theme.published` names in `changed`, in the contract's order. */
const PARTS = ["tokens", "css", "fonts", "images", "layouts", "templates", "embeds"] as const;
type Part = (typeof PARTS)[number];

/** Stored tokens: every token filled in, plus `motion` when the theme sets it. */
export type RevisionTokens = Tokens & { motion?: string };

function revisionTokens(manifest: Manifest): RevisionTokens {
  const given = (manifest.tokens ?? {}) as PartialTokens & { motion?: unknown };
  const tokens: RevisionTokens = fillTokens(given);
  if (typeof given.motion === "string") tokens.motion = given.motion;
  return tokens;
}

/**
 * One lock per event's history, held to the end of the transaction, so two publishes or a publish
 * and a restore never take the same number, and restore's `current_revision` check stays true.
 */
export async function lockHistory(c: SqlClient): Promise<number> {
  await c.query(
    `SELECT pg_advisory_xact_lock(hashtext('canccu_theming_history:' || current_setting('canccu.tenant')))`,
  );
  const { rows } = await c.query(`SELECT coalesce(max(revision), 0) AS n FROM theming_revisions`);
  return (rows[0] as { n: number }).n;
}

/** What an owner holds, by part: its manifest's entries, its stored files and its embed files. */
interface Holdings {
  manifest: Manifest;
  tokens: RevisionTokens;
  files: string[];
  embeds: string[];
}

async function holdings(
  c: SqlClient,
  owner: string,
  manifest: Manifest,
  tokens: RevisionTokens,
): Promise<Holdings> {
  const generated = owner.startsWith("r:")
    ? `AND file NOT IN (SELECT unnest(ARRAY[tokens_css, admin_tokens_css, coalesce(css, '')])
                          FROM theming_revisions WHERE 'r:' || revision = $1)`
    : "";
  const files = await c.query(
    `SELECT file FROM theming_file_refs WHERE owner = $1 ${generated} ORDER BY file`,
    [owner],
  );
  const embeds = await c.query(
    `SELECT embed || '/' || path || '=' || file AS e FROM theming_embed_files WHERE owner = $1 ORDER BY 1`,
    [owner],
  );
  return {
    manifest,
    tokens,
    files: (files.rows as { file: string }[]).map((r) => r.file),
    embeds: (embeds.rows as { e: string }[]).map((r) => r.e),
  };
}

const EXTS: Record<string, Part> = {
  css: "css",
  woff2: "fonts",
  png: "images",
  jpg: "images",
  webp: "images",
  svg: "images",
};

function changedParts(before: Holdings, after: Holdings): Part[] {
  const filesOf = (h: Holdings, part: Part): string[] =>
    h.files.filter((f) => EXTS[f.slice(f.lastIndexOf(".") + 1)] === part);
  const differs = (part: Part): boolean => {
    if (part === "tokens") return !isDeepStrictEqual(before.tokens, after.tokens);
    if (part === "embeds") {
      return (
        !isDeepStrictEqual(before.manifest.embeds, after.manifest.embeds) ||
        !isDeepStrictEqual(before.embeds, after.embeds)
      );
    }
    return (
      !isDeepStrictEqual(before.manifest[part], after.manifest[part]) ||
      !isDeepStrictEqual(filesOf(before, part), filesOf(after, part))
    );
  };
  return PARTS.filter(differs);
}

export interface PublishInput {
  manifest: Manifest;
  /** Whose files and embeds the revision takes: `draft`, or `r:<n>` for a restore. */
  source: string;
  restoredFrom: number | null;
  actor: string;
  /** Called when the embeds differ from the current revision's, before anything is written. */
  embedsChanged: () => Promise<void>;
}

export interface Published {
  revision: number;
  previous: number;
  restoredFrom: number | null;
  changed: Part[];
  /** The embeds' names before and after, when they changed: every embed change is audited. */
  embeds?: { old: string[]; new: string[] };
  tokensCss: string;
  embedColor: number;
}

/** Writes the next revision in the caller's transaction, which must hold `lockHistory`. */
export async function writeRevision(
  c: SqlClient,
  files: FileStore,
  current: number,
  input: PublishInput,
): Promise<Published> {
  const tokens = revisionTokens(input.manifest);
  const before: Holdings =
    current === 0
      ? { manifest: {}, tokens: platformTokens(), files: [], embeds: [] }
      : await (async () => {
          const { rows } = await c.query(
            `SELECT manifest, tokens FROM theming_revisions WHERE revision = $1`,
            [current],
          );
          const row = rows[0] as { manifest: Manifest; tokens: RevisionTokens };
          return holdings(c, `r:${current}`, row.manifest, row.tokens);
        })();
  const after = await holdings(c, input.source, input.manifest, tokens);
  const changed = changedParts(before, after);
  if (changed.includes("embeds")) await input.embedsChanged();

  const revision = current + 1;
  // Generated once here, so every later read of the revision is a pure read of addresses (D4).
  // Files land before the row; on a rollback they stay unreferenced and retention (#246) removes them.
  const tokensName = await files.put(c, Buffer.from(tokensCss(tokens)), "css");
  const adminName = await files.put(c, Buffer.from(tokensCss(adminTokens(tokens))), "css");
  const brand = (input.manifest.brand ?? {}) as { embed_color?: string };
  const embedColor = colorInt(brand.embed_color ?? tokens.colors.primary ?? "#000000");
  await c.query(
    `INSERT INTO theming_revisions (revision, manifest, tokens, tokens_css, admin_tokens_css,
                                    embed_color, restored_from, changed, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      revision,
      JSON.stringify(input.manifest),
      JSON.stringify(tokens),
      tokensName,
      adminName,
      embedColor,
      input.restoredFrom,
      changed,
      input.actor,
    ],
  );
  const owner = `r:${revision}`;
  for (const file of [tokensName, adminName]) {
    await c.query(
      `INSERT INTO theming_file_refs (owner, file) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [owner, file],
    );
  }
  if (input.source === "draft") {
    await c.query(
      `INSERT INTO theming_file_refs (owner, file) SELECT $1, file FROM theming_file_refs WHERE owner = 'draft' ON CONFLICT DO NOTHING`,
      [owner],
    );
    await c.query(
      `INSERT INTO theming_embed_files (owner, embed, path, file, bytes, entry)
       SELECT $1, embed, path, file, bytes, entry FROM theming_embed_files WHERE owner = 'draft'`,
      [owner],
    );
  } else {
    await copyOwned(c, Number(input.source.slice(2)), owner);
  }
  const names = (h: Holdings): string[] => Object.keys(h.manifest.embeds ?? {}).sort();
  return {
    revision,
    previous: current,
    restoredFrom: input.restoredFrom,
    changed,
    ...(changed.includes("embeds") ? { embeds: { old: names(before), new: names(after) } } : {}),
    tokensCss: SERVED + tokensName,
    embedColor,
  };
}
