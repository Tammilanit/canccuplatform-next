/**
 * Writing a revision: publish and restore both end here (contracts/theming.md, Draft, preview,
 * publish; plan D4). History only grows: a revision row is never changed once written.
 */
import { isDeepStrictEqual } from "node:util";
import type { SqlClient } from "@canccu/kit";
import type { Manifest } from "./checks.js";
import { brandImages } from "./brand-images.js";
import { CARRIED_REFS, copyOwned } from "./drafts.js";
import { embedHoldings } from "./embeds.js";
import type { FileStore } from "./files.js";
import { SERVED, colorInt } from "./theme.js";
import { versionConflict } from "./http.js";
import { adminTokens, fillTokens, tokensCss } from "./tokens.js";
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
  return currentRevision(c);
}

export async function currentRevision(c: SqlClient): Promise<number> {
  const { rows } = await c.query(`SELECT coalesce(max(revision), 0) AS n FROM theming_revisions`);
  return (rows[0] as { n: number }).n;
}

/** What an owner holds, by part: its manifest's entries, its stored files and its embed files. */
interface Holdings {
  manifest: Manifest;
  tokens: RevisionTokens;
  files: string[];
  embeds: string[];
  /** `<path>=<file>` of every package file, so a file moved between paths is a change too. */
  paths: string[];
}

async function holdings(
  c: SqlClient,
  owner: string,
  manifest: Manifest,
  tokens: RevisionTokens,
): Promise<Holdings> {
  // As copyOwned leaves them behind: a revision's generated files are no part of what changed.
  const files = await c.query(`SELECT f.file ${CARRIED_REFS} ORDER BY f.file`, [owner]);
  const paths = await c.query(
    `SELECT path || '=' || coalesce(file, '') AS p FROM theming_package_files
      WHERE owner = $1 ORDER BY path`,
    [owner],
  );
  return {
    manifest,
    tokens,
    files: (files.rows as { file: string }[]).map((r) => r.file),
    embeds: await embedHoldings(c, owner),
    paths: (paths.rows as { p: string }[]).map((r) => r.p),
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
  // A path's folder is its part: `images/…`, `fonts/…`, `css/…`, `templates/…`.
  const pathsOf = (h: Holdings, part: Part): string[] =>
    h.paths.filter((p) => p.startsWith(`${part}/`));
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
      !isDeepStrictEqual(filesOf(before, part), filesOf(after, part)) ||
      !isDeepStrictEqual(pathsOf(before, part), pathsOf(after, part))
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
  /**
   * Whether the caller checked `theming.embeds.write` up front (`embedsDiffer`, before any lock).
   * Embeds that differ only under the lock changed meanwhile: 409, never a call to admin while
   * the event's history is locked.
   */
  embedsAllowed: boolean;
  /** Revision 0's tokens (the defaults with the profile's theme), for `changed` at the first publish. */
  zeroTokens: Tokens;
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

/**
 * Whether publishing `manifest` with the files and embeds of `source` changes the embeds of the
 * current revision. Read without locks, so the embeds right can be checked before any are taken.
 */
export async function embedsDiffer(
  c: SqlClient,
  source: string,
  manifest: Manifest,
): Promise<boolean> {
  const current = await currentRevision(c);
  const embedsOf = async (owner: string): Promise<string[]> =>
    (await holdings(c, owner, {}, {} as RevisionTokens)).embeds;
  let before: unknown = undefined;
  if (current > 0) {
    const { rows } = await c.query(`SELECT manifest FROM theming_revisions WHERE revision = $1`, [
      current,
    ]);
    before = (rows[0] as { manifest: Manifest }).manifest.embeds;
  }
  return (
    !isDeepStrictEqual(before, manifest.embeds) ||
    !isDeepStrictEqual(current > 0 ? await embedsOf(`r:${current}`) : [], await embedsOf(source))
  );
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
      ? { manifest: {}, tokens: input.zeroTokens, files: [], embeds: [], paths: [] }
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
  if (changed.includes("embeds") && !input.embedsAllowed) throw versionConflict("theme");

  const revision = current + 1;
  // Generated once here, so every later read of the revision is a pure read of addresses (D4).
  // Files land before the row; on a rollback they stay unreferenced and retention (#246) removes them.
  const tokensName = await files.put(c, Buffer.from(tokensCss(tokens)), "css");
  const adminName = await files.put(c, Buffer.from(tokensCss(adminTokens(tokens))), "css");
  // Rendered under the history lock, which a publish holds for a few image renders at most: the
  // images are part of the revision, written with it or not at all.
  const images = await brandImages(
    c,
    files,
    input.source,
    input.manifest,
    tokens.colors.background ?? "#000000",
  );
  const brand = (input.manifest.brand ?? {}) as { embed_color?: string };
  const embedColor = colorInt(brand.embed_color ?? tokens.colors.primary ?? "#000000");
  await c.query(
    `INSERT INTO theming_revisions (revision, manifest, tokens, tokens_css, admin_tokens_css,
                                    embed_color, restored_from, changed, actor_user_id, logo,
                                    logo_png, icon_192, icon_512, icon_maskable_512)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
      images.logo,
      images.logo_png,
      images.icon_192,
      images.icon_512,
      images.icon_maskable_512,
    ],
  );
  const owner = `r:${revision}`;
  const generated = [images.logo_png, images.icon_192, images.icon_512, images.icon_maskable_512];
  for (const file of [tokensName, adminName, ...generated.filter((f) => f !== null)]) {
    await c.query(
      `INSERT INTO theming_file_refs (owner, file) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [owner, file],
    );
  }
  await copyOwned(c, input.source, owner);
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
